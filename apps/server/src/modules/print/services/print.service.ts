/**
 * Print Service
 *
 * Handles server-side print job processing. Currently acts as a fallback
 * receiver for POS workstations — accepts print job metadata and logs it.
 * Future iterations will queue jobs via BullMQ for server-attached printers.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { PrintFallbackDto } from '../dto/print-fallback.dto';

@Injectable()
export class PrintService {
  private readonly logger = new Logger(PrintService.name);

  /**
   * Accept and acknowledge a fallback print job from a workstation.
   *
   * Currently acknowledges and logs the request. The payload file lives on
   * the workstation filesystem and is not transferred to the server yet.
   * A future enhancement should accept the base64-encoded payload data or
   * stream the file via multipart upload.
   */
  async handleFallback(dto: PrintFallbackDto): Promise<void> {
    this.logger.log(
      `Print fallback accepted: jobType=${dto.jobType}, ` +
        `payloadPath=${dto.payloadPath}, ` +
        `payloadType=${dto.payloadType}` +
        (dto.saleId ? `, saleId=${dto.saleId}` : ''),
    );

    // Future: enqueue job via BullMQ for server-attached printer processing.
    // Future: persist to a server-side PrintJob table.
  }
}
