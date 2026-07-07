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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ExtractJwt } from 'passport-jwt';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserLoginSchema } from '@pharmacy/shared-validation';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { User } from '@pharmacy/shared-types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
  ) {}

  @Post('login')
  @UseGuards(AuthGuard('local'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with username and password' })
  async login(
    @Body(new ZodValidationPipe(UserLoginSchema)) _loginDto: LoginDto,
    @CurrentUser() user: User,
    @Headers('x-workstation-id') workstationId: string,
    @Headers('x-client-ip') clientIp?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthResponseDto> {
    return this.authService.issueSession({
      userId: user.id,
      workstationId,
      ipAddress: clientIp,
      userAgent,
    });
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Refresh access and refresh tokens' })
  async refresh(
    @Req() req: any,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    // Extract the raw JWT from the Authorization header. JwtAuthGuard already
    // verified the token signature and expiration, so we only decode it here
    // to obtain the current tokenHash for session lookup.
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
}
