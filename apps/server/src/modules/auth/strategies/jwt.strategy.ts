import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { EnvConfig } from '@/config/env.schema';
import { AuthService } from '../auth.service';
import { User } from '@pharmacy/shared-types';

interface JwtPayload {
  sub: string;
  tokenHash: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<EnvConfig>,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    // Double validation: verify JWT signature is valid AND the session is still active.
    // A valid JWT signature alone is not sufficient authorization in this system because
    // sessions can be revoked server-side (logout, inactivity, role change, admin revocation,
    // password change, token expiration) even before the JWT itself expires.
    return this.authService.validateActiveSession(payload.sub, payload.tokenHash);
  }
}
