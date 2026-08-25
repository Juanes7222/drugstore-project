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
import {
  UpdateCheckQuerySchema,
  UpdateTelemetryRequestSchema,
  type UpdateTelemetryRequestInput,
} from './dto';
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
   * Accepts either a single event or a batch envelope ({ events: [...] })
   * from the offline-queue flush, capped at MAX_TELEMETRY_BATCH_SIZE.
   * Each body includes an HMAC signature for verification; in a batch,
   * events are verified independently and reported per-event.
   * Returns 202 Accepted after persisting.
   */
  @Post('telemetry')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async telemetry(
    @Body(new ZodValidationPipe(UpdateTelemetryRequestSchema))
    body: UpdateTelemetryRequestInput,
  ) {
    if ('events' in body) {
      const results = await this.telemetryService.ingestTelemetryBatch(
        body.events,
      );
      return { accepted: true, results };
    }

    await this.telemetryService.ingestTelemetry(body);
    return { accepted: true };
  }
}
