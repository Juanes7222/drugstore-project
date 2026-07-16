import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { StepUpController } from './step-up.controller';
import { TotpController } from './totp.controller';
import { AuditController } from './audit.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PasswordHasherService } from './services/password-hasher.service';
import { PinService } from './services/pin.service';
import { TotpService } from './services/totp.service';
import { BackupCodesService } from './services/backup-codes.service';
import { SessionService } from './services/session.service';
import { StepUpService } from './services/step-up.service';
import { AuditService } from './services/audit.service';
import { OfflineTokenService } from './offline/offline-token.service';
import { CredentialCacheService } from './offline/credential-cache.service';
import { BlessingService } from './offline/blessing.service';
import { BlessingController } from './offline/blessing.controller';
import { RevocationListService } from './offline/revocation-list.service';
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
  controllers: [
    AuthController,
    UsersController,
    StepUpController,
    TotpController,
    AuditController,
    BlessingController,
  ],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    PasswordHasherService,
    PinService,
    TotpService,
    BackupCodesService,
    SessionService,
    StepUpService,
    AuditService,
    OfflineTokenService,
    CredentialCacheService,
    BlessingService,
    RevocationListService,
  ],
  exports: [
    AuthService,
    SessionService,
    AuditService,
    StepUpService,
    OfflineTokenService,
    CredentialCacheService,
    BlessingService,
    RevocationListService,
  ],
})
export class AuthModule {}
