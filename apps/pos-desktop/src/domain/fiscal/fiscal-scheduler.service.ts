/**
 * Fiscal transmission window enforcement scheduler.
 *
 * Runs periodic checks to:
 * - Warn when contingency invoices approach the 48h transmission deadline.
 * - Transition invoices to EXPIRED_CONTINGENCY when the deadline is reached.
 * - Emit manager alerts for invoices about to expire or already expired.
 */

import type { InvoiceService } from './invoice.service';
import type { ContingencyService } from './contingency.service';

export interface FiscalSchedulerConfig {
  invoiceService: InvoiceService;
  contingencyService: ContingencyService;
  /** Warning threshold in hours before expiry. Default: 4. */
  warnBeforeHours?: number;
  /** Check interval in milliseconds. Default: 1 hour. */
  checkIntervalMs?: number;
}

export interface FiscalScheduler {
  start(): void;
  stop(): void;
  /** Run a single check now (for testing or immediate invocation). */
  checkNow(): Promise<FiscalCheckResult>;
}

export interface FiscalCheckResult {
  expiredCount: number;
  warnedCount: number;
  warningMessages: string[];
}

export const createFiscalScheduler = (
  config: FiscalSchedulerConfig,
): FiscalScheduler => {
  return new FiscalSchedulerImpl(config);
};

class FiscalSchedulerImpl implements FiscalScheduler {
  private readonly invoiceService: InvoiceService;
  private readonly warnBeforeHours: number;
  private readonly checkIntervalMs: number;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(config: FiscalSchedulerConfig) {
    this.invoiceService = config.invoiceService;
    this.warnBeforeHours = config.warnBeforeHours ?? 4;
    this.checkIntervalMs = config.checkIntervalMs ?? 60 * 60 * 1000; // 1 hour
  }

  start(): void {
    if (this.timerId !== null) return;
    void this.checkNow();
    this.timerId = setInterval(() => {
      void this.checkNow();
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  async checkNow(): Promise<FiscalCheckResult> {
    const warningMessages: string[] = [];
    let expiredCount = 0;
    let warnedCount = 0;

    // 1. Find invoices expiring within the warning window
    try {
      const expiring = await this.invoiceService.findExpiringWithin(
        this.warnBeforeHours,
      );

      if (expiring.length > 0) {
        warnedCount = expiring.length;
        const message = `${expiring.length} contingency invoice(s) expire within ${this.warnBeforeHours}h — restore connectivity or contact support.`;
        warningMessages.push(message);
        console.warn(`[FiscalScheduler] ${message}`);
      }
    } catch (err) {
      console.error('[FiscalScheduler] Warning check failed:', err);
    }

    // 2. Find already-expired invoices and transition them
    try {
      const expired = await this.invoiceService.findExpired();

      for (const invoice of expired) {
        await this.invoiceService.markInvoiceAsExpired(invoice.id);
        expiredCount++;
      }

      if (expiredCount > 0) {
        const message = `${expiredCount} contingency invoice(s) expired — critical: contact manager immediately.`;
        warningMessages.push(message);
        console.error(`[FiscalScheduler] ${message}`);
      }
    } catch (err) {
      console.error('[FiscalScheduler] Expiry transition failed:', err);
    }

    return { expiredCount, warnedCount, warningMessages };
  }
}
