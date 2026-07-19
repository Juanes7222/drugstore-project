/**
 * Print router — the single entry point for all printing in the app.
 *
 * Every domain service (SalesPosService, InvoiceService, CashShiftService)
 * calls `print(jobType, payload)` instead of directly invoking a printer.
 * The router:
 *
 * 1. Resolves the assigned printer for the job type.
 * 2. Attempts to print directly if the printer is online.
 * 3. Walks the fallback chain if the primary is offline or fails.
 * 4. Falls back to the server print endpoint (if configured and network is up).
 * 5. Enqueues the job locally as a last resort.
 *
 * Every step is logged into the job's routingLog for the audit trail.
 */

import { PrintPayloadType, type PrintJobType, type PrintJobRecord, type PrintJobInput } from './printing-types';
import type { PrinterConfigService } from './printer-config.service';
import type { PrintQueueService } from './print-queue.service';
import type { PrinterConfigRecord } from './printing-types';

/**
 * Configuration for the server-side print fallback.
 * If configured, the workstation can send print jobs to the server as a
 * last-resort fallback.
 *
 * NOTE: The server endpoint (`POST /print/fallback`) exists to prevent a 404,
 * but the actual payload transfer is a future enhancement — the current
 * implementation only sends a local filesystem path that the server cannot
 * access. The server print fallback is disabled by default as a result.
 * See https://github.com/orgs/pharmacy/projects/XX (PAYLOAD-TRANSFER).
 */
export interface ServerPrintConfig {
  /** Base URL of the server API. */
  baseUrl: string;
  /** Whether server-side print fallback is enabled. Defaults to `false`. */
  enabled?: boolean;
  /** Optional auth token for the server endpoint. */
  authToken?: string;
}

export interface PrintRouter {
  /**
   * Print a document.
   *
   * This is the single entry point for all printing in the app.
   * It enqueues the job, resolves the printer (with fallback), and attempts
   * to print immediately. The job is always persisted in the queue regardless
   * of whether printing succeeds immediately.
   *
   * @returns The created print job record.
   */
  print(jobType: PrintJobType, payload: PrintInput): Promise<PrintJobRecord>;

  /**
   * Attempt server-side print fallback.
   *
   * DISABLED BY DEFAULT — only sends a local filesystem path that the server
   * cannot access. The job is already persisted in the local queue and will
   * retry when a printer comes back online.
   *
   * Remove this guard and implement base64 payload transfer once the server
   * endpoint can accept actual file data (see PAYLOAD-TRANSFER).
   */
  tryServerFallback(
    jobType: PrintJobType,
    payload: PrintInput,
  ): Promise<boolean>;
}

/** Input for a print request. */
export interface PrintInput {
  /** Full local path to the printable document. */
  payloadPath: string;
  /** Type of payload (PDF, ESC_POS, etc.). */
  payloadType?: PrintPayloadType;
  /** Optional sale ID for traceability. */
  saleId?: string | null;
  /** Optional user ID for traceability. */
  userId?: string | null;
}

export const createPrintRouter = (
  printerConfigService: PrinterConfigService,
  printQueueService: PrintQueueService,
  serverConfig?: ServerPrintConfig,
): PrintRouter => {
  return new PrintRouterImpl(
    printerConfigService,
    printQueueService,
    serverConfig,
  );
};

class PrintRouterImpl implements PrintRouter {
  constructor(
    private readonly printerConfigService: PrinterConfigService,
    private readonly printQueueService: PrintQueueService,
    private readonly serverConfig?: ServerPrintConfig,
  ) {}

  async print(jobType: PrintJobType, payload: PrintInput): Promise<PrintJobRecord> {
    // Step 1: Enqueue the job (always - ensures durability)
    const jobInput: PrintJobInput = {
      jobType,
      payloadPath: payload.payloadPath,
      payloadType: payload.payloadType ?? PrintPayloadType.PDF,
      createdBySaleId: payload.saleId ?? null,
      createdByUserId: payload.userId ?? null,
    };

    const job = await this.printQueueService.enqueueJob(jobInput);

    // Step 2: Try to find a printer for this job type
    let printer: PrinterConfigRecord | null = null;

    try {
      const resolved = await this.printerConfigService.resolvePrinterWithFallback(
        jobType,
      );
      if (resolved) {
        printer = resolved.printer;
      }
    } catch {
      // No printer configured - the job is already queued
    }

    if (!printer) {
      // Step 3: Try server fallback if explicitly enabled
      // NOTE: Disabled by default — the server cannot access a local path.
      // Job is already queued and will retry when a printer comes back online.
      if (this.serverConfig?.enabled) {
        const serverSuccess = await this.tryServerFallback(jobType, payload);
        if (serverSuccess) {
          return job;
        }
      }

      // No printer available at all - job is already queued, will be
      // processed when the health check detects a printer
      return job;
    }

    // Step 4: Try to print on the resolved printer
    const printerOnline = printer.status === 'ONLINE';

    if (printerOnline) {
      // The queue service will attempt to process this job
      // We don't await it here - printing is fire-and-forget from the
      // caller's perspective
      this.printQueueService.processNextJob().catch(() => {
        /* logged in the queue service */
      });
    }

    return job;
  }

  async tryServerFallback(
    jobType: PrintJobType,
    payload: PrintInput,
  ): Promise<boolean> {
    if (!this.serverConfig) return false;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.serverConfig.authToken) {
        headers['Authorization'] = `Bearer ${this.serverConfig.authToken}`;
      }

      const normalizedBase = this.serverConfig.baseUrl.replace(/\/+$/, '');
      const response = await fetch(`${normalizedBase}/print/fallback`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jobType,
          payloadPath: payload.payloadPath,
      payloadType: payload.payloadType ?? PrintPayloadType.PDF,
        }),
      });

      return response.ok;
    } catch {
      // Network error or server not reachable - fallback failed
      return false;
    }
  }
}
