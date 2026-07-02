import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PasswordHasherService } from './services/password-hasher.service';
import { SessionService } from './services/session.service';
import { EnvConfig } from '@/config/env.schema';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService<EnvConfig>) => ({
        secret: configService.get('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_ACCESS_TTL_SECONDS'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    PasswordHasherService,
    SessionService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
