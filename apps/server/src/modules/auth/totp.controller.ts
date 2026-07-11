import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TotpService } from './services/totp.service';
import { BackupCodesService } from './services/backup-codes.service';
import { AuditService, AuditEvent } from './services/audit.service';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { User } from '@pharmacy/shared-types';
import { z } from 'zod';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

const SetupTotpSchema = z.object({
  verificationCode: z.string().length(6).optional(),
});

const VerifyTotpSchema = z.object({
  code: z.string().length(6),
  secret: z.string().min(1),
});

const DisableTotpSchema = z.object({
  code: z.string().optional(),
  backupCode: z.string().optional(),
  managerAuthToken: z.string().optional(),
});

type VerifyTotpInput = z.infer<typeof VerifyTotpSchema>;
type DisableTotpInput = z.infer<typeof DisableTotpSchema>;

@ApiTags('auth/2fa')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('auth/2fa')
export class TotpController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totpService: TotpService,
    private readonly backupCodesService: BackupCodesService,
    private readonly auditService: AuditService,
  ) {}

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate TOTP setup (returns secret and QR code)' })
  async setupTotp(
    @CurrentUser() user: User,
  ): Promise<{ secret: string; otpauthUri: string; qrCodeUrl: string }> {
    return this.totpService.generateSecret(user.email ?? user.id);
  }

  @Post('setup/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify TOTP setup and activate 2FA' })
  async verifySetup(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(VerifyTotpSchema)) body: VerifyTotpInput,
  ): Promise<{ backupCodes: string[]; message: string }> {
    const verified = this.totpService.verifySetup(body.secret, body.code);
    if (!verified) {
      throw new BadRequestException('Invalid verification code');
    }

    const encryptedSecret = this.totpService.encryptSecret(body.secret);

    const { codes, hashes } = this.backupCodesService.generate();

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecretEncrypted: encryptedSecret,
        totpEnabled: true,
        backupCodesHash: JSON.stringify(hashes),
        authMethod: 'PASSWORD_TOTP',
      },
    });

    await this.auditService.log(AuditEvent.TOTP_SETUP, {
      actorId: user.id,
      actorRole: user.role,
    });

    return {
      backupCodes: codes,
      message: '2FA activado. Guarda estos códigos de respaldo en un lugar seguro.',
    };
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable 2FA' })
  async disableTotp(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(DisableTotpSchema)) body: DisableTotpInput,
  ): Promise<{ message: string }> {
    // Fetch full user from DB (JWT payload doesn't contain sensitive fields)
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) {
      throw new BadRequestException('User not found');
    }

    // Require current TOTP code OR backup code OR manager authorization
    if (body.code) {
      if (!dbUser.totpSecretEncrypted) {
        throw new BadRequestException('2FA is not enabled');
      }
      const verified = this.totpService.verify(dbUser.totpSecretEncrypted, body.code);
      if (!verified) {
        throw new BadRequestException('Invalid TOTP code');
      }
    } else if (body.backupCode) {
      if (!dbUser.backupCodesHash) {
        throw new BadRequestException('No backup codes available');
      }
      const hashes: string[] = JSON.parse(dbUser.backupCodesHash);
      const index = this.backupCodesService.verify(body.backupCode, hashes);
      if (index < 0) {
        throw new BadRequestException('Invalid backup code');
      }
    } else {
      throw new BadRequestException(
        'Provide a TOTP code, a backup code, or manager authorization to disable 2FA',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecretEncrypted: null,
        totpEnabled: false,
        backupCodesHash: null,
        authMethod: 'PASSWORD_ONLY',
      },
    });

    await this.auditService.log(AuditEvent.TOTP_DISABLED, {
      actorId: user.id,
      actorRole: user.role,
    });

    return { message: '2FA desactivado' };
  }
}
