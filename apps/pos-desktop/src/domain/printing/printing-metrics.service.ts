/**
 * Read-only local metrics aggregator for the printing subsystem.
 *
 * All methods are offline-safe — they read from local Prisma only.
 * Provides summaries for observability integration: print queue health,
 * printer status distribution, and historical success rates.
 */

import type { PrismaClient } from '@pharmacy/database/local';
import type { PrintQueueSummary, PrinterStatusSummary } from './printing-types';

export interface PrintingMetricsService {
  /** Summary of the current print queue state. */
  getPrintQueueSummary(): Promise<PrintQueueSummary>;

  /** Count of printers by status. */
  getPrinterStatusSummary(): Promise<PrinterStatusSummary>;

  /** Get the count of printers that are not ONLINE. */
  getNonOnlinePrinterCount(): Promise<number>;

  /** Get a human-readable summary line for the observability surface. */
  getHealthLine(): Promise<string>;
}

export const createPrintingMetricsService = (
  prisma: PrismaClient,
): PrintingMetricsService => {
  return new PrintingMetricsServiceImpl(prisma);
};

class PrintingMetricsServiceImpl implements PrintingMetricsService {
  constructor(private readonly prisma: PrismaClient) {}

  async getPrintQueueSummary(): Promise<PrintQueueSummary> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      pending,
      printing,
      failed,
      discarded,
      completed24h,
    ] = await Promise.all([
      this.prisma.printJob.count({ where: { status: 'PENDING' } }),
      this.prisma.printJob.count({ where: { status: 'PRINTING' } }),
      this.prisma.printJob.count({ where: { status: 'FAILED' } }),
      this.prisma.printJob.count({ where: { status: 'DISCARDED' } }),
      this.prisma.printJob.count({
        where: {
          status: 'COMPLETED',
          completedAt: { gte: twentyFourHoursAgo },
        },
      }),
    ]);

    // Average attempts before success
    const recentCompleted = await this.prisma.printJob.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: twentyFourHoursAgo },
      },
      select: { attempts: true },
    });

    const averageAttemptsBeforeSuccess =
      recentCompleted.length > 0
        ? recentCompleted.reduce((sum, j) => sum + j.attempts, 0) /
          recentCompleted.length
        : 0;

    return {
      pending,
      printing,
      failed,
      discarded,
      completed24h,
      averageAttemptsBeforeSuccess,
    };
  }

  async getPrinterStatusSummary(): Promise<PrinterStatusSummary> {
    const printers = await this.prisma.printerConfig.findMany({
      select: { status: true },
    });

    const summary: PrinterStatusSummary = {
      online: 0,
      offline: 0,
      error: 0,
      noPaper: 0,
      unknown: 0,
    };

    for (const printer of printers) {
      const status = (printer.status ?? 'UNKNOWN') as string;
      switch (status) {
        case 'ONLINE':
          summary.online++;
          break;
        case 'OFFLINE':
          summary.offline++;
          break;
        case 'ERROR':
          summary.error++;
          break;
        case 'NO_PAPER':
          summary.noPaper++;
          break;
        default:
          summary.unknown++;
          break;
      }
    }

    return summary;
  }

  async getNonOnlinePrinterCount(): Promise<number> {
    const count = await this.prisma.printerConfig.count({
      where: {
        status: {
          not: 'ONLINE' as any,
        },
      },
    });
    return count;
  }

  async getHealthLine(): Promise<string> {
    const queueSummary = await this.getPrintQueueSummary();
    const printerSummary = await this.getPrinterStatusSummary();

    const parts: string[] = [];

    if (printerSummary.online > 0) {
      parts.push(`${printerSummary.online} impresora(s) en línea`);
    }
    if (printerSummary.offline > 0) {
      parts.push(`${printerSummary.offline} offline`);
    }
    if (printerSummary.error > 0) {
      parts.push(`${printerSummary.error} con error`);
    }
    if (printerSummary.noPaper > 0) {
      parts.push(`${printerSummary.noPaper} sin papel`);
    }

    if (queueSummary.pending > 0) {
      parts.push(`${queueSummary.pending} trabajo(s) pendiente(s)`);
    }
    if (queueSummary.failed > 0) {
      parts.push(`${queueSummary.failed} fallido(s)`);
    }

    return parts.length > 0 ? parts.join(' · ') : 'Sin problemas de impresión';
  }
}
