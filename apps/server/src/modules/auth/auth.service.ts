import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { EnvConfig } from '@/config/env.schema';
import { User } from '@pharmacy/shared-types';
import * as crypto from 'crypto';
import { PasswordHasherService } from './services/password-hasher.service';
import { SessionService } from './services/session.service';
import { InvalidCredentialsException } from './exceptions/invalid-credentials.exception';
import { AccountLockedException } from './exceptions/account-locked.exception';
import { AccountInactiveException } from './exceptions/account-inactive.exception';
import { SessionExpiredException } from './exceptions/session-expired.exception';
import { SessionRevokedException } from './exceptions/session-revoked.exception';
import { MAX_FAILED_LOGIN_ATTEMPTS, ACCOUNT_LOCK_DURATION_MINUTES } from './constants/auth.constants';
import { AuthResponseDto } from './dto/auth-response.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService<EnvConfig>,
    private passwordHasher: PasswordHasherService,
    private sessionService: SessionService,
  ) {}

  async validateCredentials(username: string, password: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { username },
    });

    this.assertAccountIsUsable(user);

    const isPasswordValid = await this.passwordHasher.verify(
      user!.passwordHash,
      password,
    );

    if (!isPasswordValid) {
      await this.handleFailedLoginAttempt(user!.id);
      throw new InvalidCredentialsException();
    }

    await this.resetFailedLoginAttempts(user!.id);

    return this.mapUserToDto(user!);
  }

  async validateActiveSession(userId: string, tokenHash: string): Promise<User> {
    const session = await this.sessionService.findActiveSessionByTokenHash(tokenHash);

    if (!session) {
      throw new SessionExpiredException();
    }

    if (session.revokedAt !== null) {
      throw new SessionRevokedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new InvalidCredentialsException();
    }

    return this.mapUserToDto(user);
  }

  async issueSession(params: {
    userId: string;
    workstationId: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
    });

    if (!user) {
      throw new InvalidCredentialsException();
    }

    const accessTokenTtl = this.configService.get('JWT_ACCESS_TTL_SECONDS')!;
    const refreshTokenTtl = this.configService.get('JWT_REFRESH_TTL_SECONDS')!;

    const tokenHash = this.hashToken(crypto.randomBytes(32).toString('hex'));
    const refreshTokenHash = this.hashToken(crypto.randomBytes(32).toString('hex'));

    const now = new Date();
    const expiresAt = new Date(now.getTime() + accessTokenTtl * 1000);

    const accessToken = this.jwtService.sign(
      { sub: user.id, tokenHash },
      { expiresIn: accessTokenTtl },
    );

    const refreshToken = this.jwtService.sign(
      { sub: user.id, refreshTokenHash },
      { expiresIn: refreshTokenTtl },
    );

    await this.sessionService.createSession({
      userId: user.id,
      workstationId: params.workstationId,
      tokenHash,
      refreshTokenHash,
      expiresAt,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: now,
        lastLoginWorkstationId: params.workstationId,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresAt,
      user: this.mapUserToDto(user),
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.sessionService.revokeSession(sessionId, 'LOGOUT');
  }

  private async handleFailedLoginAttempt(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return;
    }

    const newFailedAttempts = (user.failedLoginAttempts || 0) + 1;



    if (newFailedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      const lockedUntil = new Date(
        Date.now() + ACCOUNT_LOCK_DURATION_MINUTES * 60 * 1000,
      );

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: newFailedAttempts,
          lockedUntil,
        },
      });

      throw new AccountLockedException(lockedUntil);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: newFailedAttempts },
    });
  }

  private async resetFailedLoginAttempts(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0 },
    });
  }

  private assertAccountIsUsable(user: { isActive: boolean; lockedUntil: Date | null } | null): void {
    if (!user) {
      throw new InvalidCredentialsException();
    }

    if (!user.isActive) {
      throw new AccountInactiveException();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new AccountLockedException(user.lockedUntil);
    }
  }

  private mapUserToDto(user: any): Omit<User, 'passwordHash' | 'passwordAlgorithm'> {
    const { passwordHash, passwordAlgorithm, ...userWithoutSensitiveData } = user;
    return userWithoutSensitiveData;
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
