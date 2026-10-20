import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  UsePipes,
  UploadedFile,
  UseInterceptors,
  ParseFilePipe,
  FileTypeValidator,
  MaxFileSizeValidator,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UpdatesService } from '../updates.service';
import { TelemetryService } from '../telemetry.service';
import { SignatureService } from '../signature.service';
import { PublishVersionSchema, UpdateChannelOptInSchema } from '../dto';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { RoleType } from '@pharmacy/shared-types';

/**
 * Admin endpoints for managing the auto-update system.
 *
 * All endpoints require SAAS_ADMIN role.
 */
@Controller('admin/updates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.SAAS_ADMIN)
export class AdminUpdatesController {
  constructor(
    private readonly updatesService: UpdatesService,
    private readonly telemetryService: TelemetryService,
    private readonly signatureService: SignatureService,
  ) {}

  // -------------------------------------------------------------------
  // Version management
  // -------------------------------------------------------------------

  /**
   * Publish a new update version.
   * Accepts a multipart upload with the binary file and metadata as a JSON field.
   */
  @Post('versions')
  @UseInterceptors(FileInterceptor('binary'))
  async publishVersion(
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [
          new FileTypeValidator({
            // Installers reach us as a variety of mime types depending on the
            // browser and the packaging format, and Nest validates by magic
            // number. Only the platform admin can upload here, and the binary
            // is signed server-side before it is ever served.
            fileType:
              /^application\/(octet-stream|x-msdownload|x-msdos-program|vnd\.microsoft\.portable-executable|x-msi|zip|x-executable|x-sh)$/,
            fallbackToMimetype: true,
          }),
          new MaxFileSizeValidator({ maxSize: 500 * 1024 * 1024 }), // 500 MB
        ],
      }),
    )
    binary: any, // Uploaded file, typed as Express.Multer.File at runtime
    @Body('metadata') metadataRaw: string,
  ) {
    let metadata: unknown;
    try {
      metadata = JSON.parse(metadataRaw);
    } catch {
      throw new BadRequestException('The metadata field must be a JSON object.');
    }

    const validated = PublishVersionSchema.parse(metadata);

    return this.updatesService.publishVersion({
      ...validated,
      binaryFilename: binary.originalname,
      binaryBuffer: binary.buffer,
    });
  }

  /**
   * Activate a draft version.
   */
  @Post('versions/:id/activate')
  @HttpCode(HttpStatus.OK)
  async activateVersion(@Param('id') id: string) {
    return this.updatesService.activateVersion(id);
  }

  /**
   * Pause a rolling-out version.
   */
  @Post('versions/:id/pause')
  @HttpCode(HttpStatus.OK)
  async pauseRollout(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.updatesService.pauseRollout(id, reason);
  }

  /**
   * Resume a paused rollout.
   */
  @Post('versions/:id/resume')
  @HttpCode(HttpStatus.OK)
  async resumeRollout(@Param('id') id: string) {
    return this.updatesService.resumeRollout(id);
  }

  /**
   * Mark a version as rolled back (forces all workstations to revert).
   */
  @Post('versions/:id/rollback')
  @HttpCode(HttpStatus.OK)
  async rollbackVersion(@Param('id') id: string) {
    return this.updatesService.rollbackVersion(id);
  }

  /**
   * List all published versions with summary status.
   */
  @Get('versions')
  async listVersions() {
    return this.updatesService.listVersions();
  }

  /**
   * Get detailed version info including telemetry aggregates.
   */
  @Get('versions/:id')
  async getVersionDetails(@Param('id') id: string) {
    return this.updatesService.getVersionDetails(id);
  }

  // -------------------------------------------------------------------
  // Channel opt-in
  // -------------------------------------------------------------------

  /**
   * Set the update channel for a location (STABLE or BETA).
   */
  @Post('channels')
  @HttpCode(HttpStatus.OK)
  async setChannelOptIn(
    @Body(new ZodValidationPipe(UpdateChannelOptInSchema)) body: any,
    @Body('userId') userId: string,
  ) {
    return this.updatesService.setChannelOptIn(body.locationId, body.channel, userId);
  }

  /**
   * List all location channel overrides.
   */
  @Get('channels')
  async listChannelOptIns() {
    return this.updatesService.getChannelOptIns();
  }

  // -------------------------------------------------------------------
  // Telemetry aggregates
  // -------------------------------------------------------------------

  /**
   * Get aggregate telemetry counters for the admin dashboard.
   */
  @Get('telemetry/summary')
  async getTelemetrySummary() {
    return this.telemetryService.getAggregates();
  }
}
