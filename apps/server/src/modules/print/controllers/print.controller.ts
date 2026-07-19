/**
 * Print Controller
 *
 * Exposes endpoints for POS workstation print fallback. The POS calls
 * POST /print/fallback when local printers are offline and server fallback
 * is configured in the printer settings.
 */
import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { PrintService } from '../services/print.service';
import {
  PrintFallbackSchema,
  type PrintFallbackDto,
} from '../dto/print-fallback.dto';

@Controller('print')
@UseGuards(JwtAuthGuard)
export class PrintController {
  constructor(private readonly printService: PrintService) {}

  /**
   * Accept a print job from a workstation when local printing failed.
   *
   * The POS calls this endpoint as a last-resort fallback after exhausting
   * the local fallback printer chain. The server acknowledges receipt and
   * may queue the job for server-attached printer processing.
   *
   * Returns 201 Accepted to signal the workstation it can mark the job as
   * handled.
   */
  @Post('fallback')
  @HttpCode(201)
  async fallback(
    @Body(new ZodValidationPipe(PrintFallbackSchema)) dto: PrintFallbackDto,
  ): Promise<{ accepted: boolean }> {
    await this.printService.handleFallback(dto);
    return { accepted: true };
  }
}
