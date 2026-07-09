import {
  BadRequestException,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { RoleType, AuditAction, SystemModule } from '@pharmacy/shared-types';
import { TerminalBackupService } from '../services/terminal-backup.service';
import {
  BackupUploadHeadersSchema,
  BackupUploadParamsSchema,
} from '../dto/backup-upload.schema';

@Controller('terminals')
export class TerminalsController {
  constructor(private terminalBackupService: TerminalBackupService) {}

  @Post(':id/backup-upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.SYNC,
    entityType: 'TerminalBackup',
  })
  async uploadBackup(
    @Param('id') id: string,
    @Headers('x-backup-id') backupIdHeader: string | undefined,
    @Headers('x-backup-created-at') backupCreatedAtHeader: string | undefined,
    @Headers('x-backup-sha256') backupSha256Header: string | undefined,
    @Req() req: Request,
  ): Promise<{ uploadId: string; workstationId: string; createdAt: string }> {
    const paramsResult = BackupUploadParamsSchema.safeParse({ id });
    if (!paramsResult.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: paramsResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const headersResult = BackupUploadHeadersSchema.safeParse({
      'x-backup-id': backupIdHeader,
      'x-backup-created-at': backupCreatedAtHeader,
      'x-backup-sha256': backupSha256Header,
    });
    if (!headersResult.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: headersResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const workstationId = paramsResult.data.id;
    const { 'x-backup-id': uploadId, 'x-backup-created-at': createdAtIso } =
      headersResult.data;

    return this.terminalBackupService.storeBackup({
      workstationId,
      uploadId,
      createdAt: new Date(createdAtIso),
      payload: req,
    });
  }
}
