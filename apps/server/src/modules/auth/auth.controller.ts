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
  Param,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ExtractJwt } from 'passport-jwt';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService, AuthResponseData } from './auth.service';
import { SessionService } from './services/session.service';
import { SessionRevocationReason, UserSession as UserSessionModel } from '@pharmacy/database';
import { LoginDto, LoginSchema, TwoFactorLoginDto, TwoFactorLoginSchema } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangePinDto } from './dto/change-pin.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { User, RoleType } from '@pharmacy/shared-types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private sessionService: SessionService,
    private jwtService: JwtService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with identifier (email/username) and secret (password/PIN)' })
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
      hardwareFingerprint: dto.hardwareFingerprint,
      deviceInfo: dto.deviceInfo,
      ipAddress: clientIp,
      userAgent,
    });

    return new AuthResponseDto(result);
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
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Refresh access and refresh tokens' })
  async refresh(
    @Req() req: any,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const rawToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (!rawToken) {
      throw new UnauthorizedException('Missing or malformed authorization header');
    }
    const payload = this.jwtService.decode(rawToken) as {
      sub: string;
      tokenHash: string;
    };

    return this.authService.refreshSession(payload.tokenHash);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke current session' })
  async logout(@Req() req: any): Promise<void> {
    const rawToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (!rawToken) {
      throw new UnauthorizedException('Missing or malformed authorization header');
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

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset link' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete password reset with token' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password reset successfully' };
  }

  // ---------------------------------------------------------------------------
  // Session management (own sessions)
  // ---------------------------------------------------------------------------

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List current user\'s active sessions' })
  async listMySessions(
    @CurrentUser() user: User,
  ): Promise<UserSessionModel[]> {
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

    await this.sessionService.revokeSession(sessionId, SessionRevocationReason.LOGOUT);
    return { message: 'Session revoked' };
  }
}
