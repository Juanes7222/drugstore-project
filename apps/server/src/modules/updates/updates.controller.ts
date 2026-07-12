import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UsePipes,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UpdatesService } from './updates.service';
import { TelemetryService } from './telemetry.service';
import { UpdateCheckQuerySchema, UpdateTelemetrySchema } from './dto';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { Public } from '@/common/decorators/public.decorator';

/**
 * Public endpoints for the auto-update system.
 *
 * - GET /updates/check — unauthenticated, rate-limited per IP
 * - POST /updates/telemetry — unauthenticated, signature-verified
 *
 * Rate limiting should be configured at the infrastructure level (API gateway,
 * reverse proxy, or @nestjs/throttler on the module).
 */
@Controller('updates')
export class UpdatesController {
  constructor(
    private readonly updatesService: UpdatesService,
    private readonly telemetryService: TelemetryService,
  ) {}

  /**
   * Check whether an update is available for the given workstation.
   * This endpoint is intentionally unauthenticated so the check works even
   * for unlicensed workstations. The license is enforced at install time.
   */
  @Get('check')
  @Public()
  async check(
    @Query(new ZodValidationPipe(UpdateCheckQuerySchema)) query: {
      currentVersion: string;
      workstationId: string;
      channel?: 'STABLE' | 'BETA';
      licensePlanCode?: string;
    },
  ) {
    return this.updatesService.checkForUpdate({
      currentVersion: query.currentVersion,
      workstationId: query.workstationId,
      channel: query.channel ?? 'STABLE',
      licensePlanCode: query.licensePlanCode,
    });
  }

  /**
   * Ingest telemetry from a workstation after an update attempt.
   * The body includes an HMAC signature for verification.
   * Returns 202 Accepted after persisting the event.
   */
  @Post('telemetry')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async telemetry(
    @Body(new ZodValidationPipe(UpdateTelemetrySchema)) body: any,
  ) {
    await this.telemetryService.ingestTelemetry(body);
    return { accepted: true };
  }
}
