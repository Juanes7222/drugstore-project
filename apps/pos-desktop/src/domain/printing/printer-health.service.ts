/**
 * Printer health check loop.
 *
 * Runs every 30 seconds during normal operation. For each configured printer,
 * calls the Rust `get_printer_status` command and updates the local database.
 *
 * On status transitions from OFFLINE/ERROR to ONLINE, automatically triggers
 * the print queue to process pending jobs.
 *
 * Pauses during network changes (is-online) to avoid wasting calls when the
 * workstation is in contingency mode. Printing itself does not require
 * network (unless using server fallback), but we still pause the health
 * check to reduce CPU usage during contingency.
 */

import type { PrinterConfigService } from './printer-config.service';
import type { PrintQueueService } from './print-queue.service';
import { PrinterStatusCode, type PrinterConfigRecord } from './printing-types';

/** Interval between health check cycles. */
const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds

export interface PrinterHealthService {
  /** Start the periodic health check loop. */
  start(): void;

  /** Stop the periodic health check loop. */
  stop(): void;

  /** Manually trigger a single health check cycle. */
  runHealthCheck(): Promise<HealthCheckReport>;

  /** Whether the health check loop is currently running. */
  isRunning(): boolean;
}

export interface HealthCheckReport {
  checkedCount: number;
  statusChanges: Array<{
    printerId: string;
    friendlyName: string;
    previousStatus: PrinterStatusCode;
    newStatus: PrinterStatusCode;
  }>;
  pendingJobsProcessed: number;
}

export const createPrinterHealthService = (
  printerConfigService: PrinterConfigService,
  printQueueService: PrintQueueService,
  /** Optional external online check. If false, health check still runs. */
  isOnline: () => boolean,
): PrinterHealthService => {
  return new PrinterHealthServiceImpl(
    printerConfigService,
    printQueueService,
    isOnline,
  );
};

class PrinterHealthServiceImpl implements PrinterHealthService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _isRunning = false;

  constructor(
    private readonly printerConfigService: PrinterConfigService,
    private readonly printQueueService: PrintQueueService,
    private readonly isOnline: () => boolean,
  ) {}

  start(): void {
    if (this.intervalId) return;

    this._isRunning = true;

    // Run immediately on start
    this.runHealthCheck().catch(() => {
      /* health check errors are non-fatal */
    });

    // Then every 30 seconds
    this.intervalId = setInterval(async () => {
      try {
        await this.runHealthCheck();
      } catch {
        // Non-fatal: health check failures should not crash the loop
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._isRunning = false;
  }

  isRunning(): boolean {
    return this._isRunning;
  }

  async runHealthCheck(): Promise<HealthCheckReport> {
    const printers = await this.printerConfigService.listAll();
    const statusChanges: HealthCheckReport['statusChanges'] = [];
    let pendingJobsProcessed = 0;

    for (const printer of printers) {
      try {
        const previousStatus = printer.status;
        const newStatus = await this.checkPrinterStatus(printer);

        if (newStatus !== previousStatus) {
          statusChanges.push({
            printerId: printer.id,
            friendlyName: printer.friendlyName,
            previousStatus,
            newStatus,
          });

          // If transitioning from OFFLINE/ERROR to ONLINE, process pending jobs
          if (
            (previousStatus === 'OFFLINE' ||
              previousStatus === 'ERROR' ||
              previousStatus === 'NO_PAPER' ||
              previousStatus === 'UNKNOWN') &&
            newStatus === 'ONLINE'
          ) {
            const result = await this.printQueueService.processAllPending();
            pendingJobsProcessed += result.processed;
          }
        }
      } catch {
        // Individual printer check failure should not block other printers
        try {
          await this.printerConfigService.updateStatus(
            printer.id,
            PrinterStatusCode.UNKNOWN,
            'Error al verificar estado',
          );
        } catch {
          // Ignore update failures
        }
      }
    }

    return {
      checkedCount: printers.length,
      statusChanges,
      pendingJobsProcessed,
    };
  }

  /**
   * Check a single printer's status by calling the Rust `get_printer_status`
   * command via the Tauri `invoke` bridge.
   */
  private async checkPrinterStatus(
    printer: PrinterConfigRecord,
  ): Promise<PrinterStatusCode> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<{ status: string; statusMessage?: string }>(
        'get_printer_status',
        {
          printerSystemName: printer.systemName,
        },
      );

      const mappedStatus = this.mapStatus(result.status);

      // Update the database
      await this.printerConfigService.updateStatus(
        printer.id,
        mappedStatus,
        result.statusMessage ?? null,
      );

      return mappedStatus;
    } catch (err) {
      // If the Tauri invoke fails (e.g., not running in Tauri), mark as UNKNOWN
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to check printer status';

      await this.printerConfigService.updateStatus(
        printer.id,
        PrinterStatusCode.UNKNOWN,
        errorMessage,
      );

      return PrinterStatusCode.UNKNOWN;
    }
  }

  /**
   * Map the string status from the Rust backend to the PrinterStatusCode enum.
   */
  private mapStatus(status: string): PrinterStatusCode {
    switch (status) {
      case 'ONLINE':
        return PrinterStatusCode.ONLINE;
      case 'OFFLINE':
        return PrinterStatusCode.OFFLINE;
      case 'ERROR':
        return PrinterStatusCode.ERROR;
      case 'NO_PAPER':
        return PrinterStatusCode.NO_PAPER;
      default:
        return PrinterStatusCode.UNKNOWN;
    }
  }
}
