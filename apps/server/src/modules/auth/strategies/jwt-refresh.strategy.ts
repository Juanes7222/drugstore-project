/**
 * Refresh-token strategy.
 *
 * Accepts an access token whose signature is valid even when it has
 * already expired — the standard JwtStrategy rejects expired tokens, which
 * made POST /auth/refresh useless exactly when it is needed. Authorization
 * still requires the backing session to be ACTIVE and within its refresh
 * lifetime (session.expiresAt is the refresh TTL, set at issue time).
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { EnvConfig } from '@/config/env.schema';
import { SessionService } from '../services/session.service';

interface JwtRefreshPayload {
  sub: string;
  tokenHash: string;
  sessionId?: string;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    configService: ConfigService<EnvConfig>,
    private readonly sessionService: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: true,
      secretOrKey: configService.get('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: JwtRefreshPayload) {
    if (!payload?.sub || !payload?.tokenHash) {
      throw new UnauthorizedException('Malformed token');
    }

    const session = await this.sessionService.findActiveSessionByTokenHash(
      payload.tokenHash,
    );

    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException('Session is not active');
    }

    return {
      userId: payload.sub,
      tokenHash: payload.tokenHash,
      sessionId: payload.sessionId,
    };
  }
}
