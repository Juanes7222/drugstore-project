import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
  UnauthorizedException,
  NotFoundException,
  Param,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ExtractJwt } from 'passport-jwt';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import {
  AuthService,
  AuthResponseData,
  BootstrapSaasAdminResult,
} from './auth.service';
import { SessionService } from './services/session.service';
import { FirebaseAuthService } from './services/firebase-auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangePinDto } from './dto/change-pin.dto';
import {
  ForgotPasswordSchema,
  ForgotPasswordDto,
  ResetPasswordSchema,
  ResetPasswordDto,
} from './dto/password-reset.dto';
import {
  ResendVerificationSchema,
  ResendVerificationDto,
  VerifyEmailSchema,
  VerifyEmailDto,
} from './dto/email-verification.dto';
import {
  LoginDto,
  LoginSchema,
  TwoFactorLoginDto,
  TwoFactorLoginSchema,
} from './dto/login.dto';
import {
  FirebaseLoginDto,
  FirebaseLoginSchema,
} from './dto/firebase-login.dto';
import { BootstrapDto, BootstrapSchema } from './dto/bootstrap.dto';
import { FirebaseNotConfiguredException } from './exceptions/firebase-not-configured.exception';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { EnvConfig } from '@/config/env.schema';
import { User, RoleType } from '@pharmacy/shared-types';
import {
  SessionRevocationReason,
  UserSession as UserSessionModel,
} from '@pharmacy/database';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private sessionService: SessionService,
    private jwtService: JwtService,
    private firebaseAuth: FirebaseAuthService,
    private configService: ConfigService<EnvConfig>,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with identifier (email/username) and secret (password/PIN)',
  })
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
    @Headers('x-client-ip') clientIp?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.login({
      identifier: dto.identifier,
      secret: dto.secret,
      sessionType: dto.sessionType,
      workstationId: dto.workstationId,
      workstationName: dto.workstationName,
      hardwareFingerprint: dto.hardwareFingerprint,
      deviceInfo: dto.deviceInfo,
      ipAddress: clientIp,
      userAgent,
    });

    return new AuthResponseDto(result);
  }

  // ---------------------------------------------------------------------------
  // Firebase (Google) authentication
  // ---------------------------------------------------------------------------

  @Get('firebase/config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Public Firebase web config for client SDK initialization',
  })
  async firebaseConfig(): Promise<{
    apiKey: string | null;
    authDomain: string | null;
    projectId: string | null;
    storageBucket: string | null;
    messagingSenderId: string | null;
    appId: string | null;
    measurementId: string | null;
  }> {
    return {
      apiKey: this.configService.get('FIREBASE_API_KEY') ?? null,
      authDomain: this.configService.get('FIREBASE_AUTH_DOMAIN') ?? null,
      projectId: this.configService.get('FIREBASE_PROJECT_ID') ?? null,
      storageBucket: this.configService.get('FIREBASE_STORAGE_BUCKET') ?? null,
      messagingSenderId:
        this.configService.get('FIREBASE_MESSAGING_SENDER_ID') ?? null,
      appId: this.configService.get('FIREBASE_APP_ID') ?? null,
      measurementId: this.configService.get('FIREBASE_MEASUREMENT_ID') ?? null,
    };
  }

  @Post('login/firebase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login or register with a Firebase (Google) ID token',
  })
  async loginWithFirebase(
    @Body(new ZodValidationPipe(FirebaseLoginSchema)) dto: FirebaseLoginDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    if (!this.firebaseAuth.isConfigured) {
      throw new FirebaseNotConfiguredException();
    }

    const claims = await this.firebaseAuth.verifyIdToken(dto.idToken);

    const result = await this.authService.loginWithFirebase({
      firebaseUid: claims.uid,
      email: claims.email,
      emailVerified: claims.emailVerified,
      displayName: claims.displayName,
      photoURL: claims.photoURL,
      workstationId: dto.workstationId,
      workstationName: dto.workstationName,
      hardwareFingerprint: dto.hardwareFingerprint,
      deviceInfo: dto.deviceInfo,
      ipAddress:
        (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0] ??
        req.ip,
      userAgent: req.headers['user-agent'],
    });

    return new AuthResponseDto(result);
  }

  // ---------------------------------------------------------------------------
  // Bootstrap (one-time SAAS_ADMIN provisioning)
  // ---------------------------------------------------------------------------

  @Post('bootstrap')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Provision the first SAAS_ADMIN account (gated by BOOTSTRAP_TOKEN)',
  })
  async bootstrap(
    @Body(new ZodValidationPipe(BootstrapSchema)) dto: BootstrapDto,
    @Headers('x-bootstrap-token') bootstrapToken?: string,
  ): Promise<BootstrapSaasAdminResult> {
    this.assertBootstrapEnabled(bootstrapToken);
    // Cheap, idempotent, and free of heavy work — safe under rate limiting.
    return this.authService.bootstrapSaasAdmin({
      email: dto.email,
      displayName: dto.displayName,
    });
  }

  @Post('login/2fa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete two-factor authentication' })
  async completeTwoFactor(
    @Body(new ZodValidationPipe(TwoFactorLoginSchema)) dto: TwoFactorLoginDto,
    @Headers('x-client-ip') clientIp?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.completeTwoFactorLogin({
      challengeToken: dto.challengeToken,
      totpCode: dto.totpCode,
      backupCode: dto.backupCode,
      ipAddress: clientIp,
      userAgent,
    });

    return new AuthResponseDto(result);
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Refresh access and refresh tokens' })
  async refresh(
    @Req() req: any,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const rawToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (!rawToken) {
      throw new UnauthorizedException(
        'Missing or malformed authorization header',
      );
    }
    const payload = this.jwtService.decode(rawToken) as {
      sub: string;
      tokenHash: string;
    };

    return this.authService.refreshSession(payload.tokenHash, payload.sub);
  }

  @Post('token/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Exchange an offline token for fresh credentials (no valid access token required)',
  })
  async exchangeOfflineToken(@Body() dto: { offlineToken: string }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    offlineToken: { token: string; expiresAt: string };
  }> {
    const result = await this.authService.exchangeOfflineToken(
      dto.offlineToken,
    );

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt.toISOString(),
      offlineToken: {
        token: result.offlineToken.token,
        expiresAt: result.offlineToken.expiresAt.toISOString(),
      },
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke current session' })
  async logout(@Req() req: any): Promise<void> {
    const rawToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (!rawToken) {
      throw new UnauthorizedException(
        'Missing or malformed authorization header',
      );
    }
    const payload = this.jwtService.decode(rawToken) as {
      sub: string;
      tokenHash: string;
    };

    await this.authService.logoutSession(payload.tokenHash);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  async getCurrentUser(@CurrentUser() user: User): Promise<User> {
    return user;
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change current user password' })
  async changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
    return { message: 'Password changed successfully' };
  }

  @Post('change-pin')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change current user PIN' })
  async changePin(
    @CurrentUser() user: User,
    @Body() dto: ChangePinDto,
  ): Promise<{ message: string }> {
    await this.authService.changePin(user.id, dto.currentPin, dto.newPin);
    return { message: 'PIN changed successfully' };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  // 10 attempts/minute/IP. A wrong token is a client mistake or a guess; the
  // ceiling exists to stop bulk guessing and stays well above human retry rates.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Redeem an account-verification link',
    description:
      'Consumes the single-use token and stamps emailVerifiedAt. The emailed ' +
      'link targets the web backoffice, which calls this endpoint only after the ' +
      'user confirms — never on page load, so mail-client link scanners cannot ' +
      'consume the token first.',
  })
  async verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailSchema)) dto: VerifyEmailDto,
  ): Promise<{ verified: true; email: string }> {
    const { email } = await this.authService.verifyEmail({
      token: dto.token,
    });
    return { verified: true, email };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  // 3/hour/IP on top of the per-account cooldown enforced in the service. This
  // is the endpoint that spends the mail provider's daily quota, so it carries
  // the tightest bound of the unauthenticated routes.
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Send a new account-verification email',
    description:
      'Always answers the same way whether or not the address belongs to an ' +
      'account awaiting verification.',
  })
  async resendVerification(
    @Body(new ZodValidationPipe(ResendVerificationSchema))
    dto: ResendVerificationDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.authService.requestEmailVerification({
      email: dto.email,
      requestIp: this.clientIp(req),
    });

    return {
      message:
        'If the address matches an account needing this email, a message has been sent.',
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  // 3/hour/IP: same rationale as resend-verification — it triggers outbound mail
  // for an unauthenticated caller.
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Request password reset link',
    description:
      'Always answers the same way whether or not the address is registered and ' +
      'verified.',
  })
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordSchema)) dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    return this.authService.forgotPassword({
      email: dto.email,
      requestIp: this.clientIp(req),
    });
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Complete password reset with token' })
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordSchema)) dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password reset successfully' };
  }

  /**
   * First client IP from the forwarding chain, falling back to the socket
   * address. Recorded on verification tokens for abuse tracing only.
   */
  private clientIp(req: Request): string | undefined {
    return (
      (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]
        ?.trim() || req.ip
    );
  }

  // ---------------------------------------------------------------------------
  // Session management (own sessions)
  // ---------------------------------------------------------------------------

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List current user's active sessions" })
  async listMySessions(@CurrentUser() user: User): Promise<UserSessionModel[]> {
    return this.sessionService.findActiveSessionsByUser(user.id);
  }

  @Post('sessions/:sessionId/revoke')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a specific session' })
  async revokeMySession(
    @CurrentUser() user: User,
    @Param('sessionId') sessionId: string,
  ): Promise<{ message: string }> {
    const session = await this.sessionService.findSessionById(sessionId);
    if (!session || session.userId !== user.id) {
      throw new BadRequestException('Session not found or not owned by you');
    }

    await this.sessionService.revokeSession(
      sessionId,
      SessionRevocationReason.LOGOUT,
    );
    return { message: 'Session revoked' };
  }

  /**
   * Verify the x-bootstrap-token header against BOOTSTRAP_TOKEN. The
   * endpoint is never enabled by default: without a configured token it
   * returns 404 so the route is indistinguishable from a missing one.
   * Comparison is timing-safe to avoid leaking the token via timing.
   */
  private assertBootstrapEnabled(token: string | undefined): void {
    const expectedToken = this.configService.get('BOOTSTRAP_TOKEN');
    if (!expectedToken) {
      throw new NotFoundException('Bootstrap endpoint is not enabled');
    }
    if (!token) {
      throw new UnauthorizedException('Missing bootstrap token');
    }

    const expectedHash = crypto
      .createHash('sha256')
      .update(expectedToken)
      .digest();
    const providedHash = crypto.createHash('sha256').update(token).digest();
    if (!crypto.timingSafeEqual(expectedHash, providedHash)) {
      throw new UnauthorizedException('Invalid bootstrap token');
    }
  }
}
