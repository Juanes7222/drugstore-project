/**
 * Print job queue service.
 *
 * Manages the lifecycle of print jobs: enqueue, process, retry, discard.
 * Integrates with the printer health loop to auto-process jobs when a
 * printer transitions back to ONLINE.
 *
 * ## Retry policy
 * Failed jobs use exponential backoff: 30s, 2min, 5min, 10min, 30min.
 * After 10 attempts, the job transitions to FAILED permanently.
 */

import type { PrismaClient } from '@pharmacy/database/local';
import {
  PrintJobNotFoundException,
  PrintPayloadNotFoundException,
} from './exceptions';
import {
  PrintJobStatus,
  PrintPayloadType,
  type PrintJobRecord,
  type PrintJobInput,
  type PrintJobType,
  type PrinterConfigRecord,
  type PrintQueueSummary,
} from './printing-types';

/** Exponential backoff schedule (in milliseconds). */
const RETRY_DELAYS_MS = [
  30_000,    // 30 seconds
  120_000,   // 2 minutes
  300_000,   // 5 minutes
  600_000,   // 10 minutes
  1_800_000, // 30 minutes
];

const MAX_ATTEMPTS = 10;

export interface PrintQueueService {
  /**
   * Add a job to the print queue.
   * If the assigned printer is ONLINE, the job is processed immediately;
   * otherwise it sits in PENDING until the next health check.
   */
  enqueueJob(input: PrintJobInput): Promise<PrintJobRecord>;

  /**
   * Internal method called by the health check and manual retry trigger.
   * Pulls the next PENDING job (oldest first) and attempts to process it.
   */
  processNextJob(): Promise<void>;

  /**
   * Process all pending jobs in the queue.
   * Called when a printer transitions from OFFLINE/ERROR back to ONLINE.
   */
  processAllPending(): Promise<{ processed: number; failed: number }>;

  /** Manual retry from the UI. */
  retryJob(jobId: string): Promise<PrintJobRecord>;

  /** Manager-only: discard a job with a recorded reason. */
  discardJob(jobId: string, reason: string): Promise<PrintJobRecord>;

  /** List jobs with optional filters and pagination. */
  listJobs(filters?: {
    status?: PrintJobStatus | PrintJobStatus[];
    jobType?: PrintJobType;
    printerId?: string;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ items: PrintJobRecord[]; total: number }>;

  /** Get a single job by ID. */
  getJob(jobId: string): Promise<PrintJobRecord>;

  /** Get queue summary metrics. */
  getQueueSummary(): Promise<PrintQueueSummary>;

  /** Count pending jobs for a specific printer. */
  countPendingForPrinter(printerId: string): Promise<number>;
}

export const createPrintQueueService = (
  prisma: PrismaClient,
  /**
   * External printer resolution callback.
   * Given a job type, returns the printer to use (possibly walking the
   * fallback chain). Called by processNextJob.
   */
  resolvePrinter: (jobType: PrintJobType) => Promise<PrinterConfigRecord | null>,
  /**
   * External print execution callback.
   * Given a printer system name, payload path, and payload type, sends
   * the document to the printer. Returns Ok on success or an error message.
   */
  executePrint: (
    printerSystemName: string,
    payloadPath: string,
    payloadType: PrintPayloadType,
  ) => Promise<{ success: boolean; errorMessage?: string; paperOut?: boolean }>,
): PrintQueueService => {
  return new PrintQueueServiceImpl(prisma, resolvePrinter, executePrint);
};

class PrintQueueServiceImpl implements PrintQueueService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly resolvePrinter: (
      jobType: PrintJobType,
    ) => Promise<PrinterConfigRecord | null>,
    private readonly executePrint: (
      printerSystemName: string,
      payloadPath: string,
      payloadType: PrintPayloadType,
    ) => Promise<{
      success: boolean;
      errorMessage?: string;
      paperOut?: boolean;
    }>,
  ) {}

  async enqueueJob(input: PrintJobInput): Promise<PrintJobRecord> {
    // Verify payload exists
    if (!(await this.fileExists(input.payloadPath))) {
      throw new PrintPayloadNotFoundException(input.payloadPath);
    }

    const id = crypto.randomUUID();
    const jobType = input.jobType;
    const payloadType = input.payloadType ?? 'PDF';

    // Try to resolve a printer immediately
    let printerConfigId: string | null = null;
    try {
      const printer = await this.resolvePrinter(jobType);
      if (printer) {
        printerConfigId = printer.id;
      }
    } catch {
      // If resolution fails (no printer configured), just queue without a printer
    }

    const job = await this.prisma.printJob.create({
      data: {
        id,
        jobType,
        printerConfigId,
        payloadPath: input.payloadPath,
        payloadType,
        status: 'PENDING',
        attempts: 0,
        createdBySaleId: input.createdBySaleId ?? null,
        createdByUserId: input.createdByUserId ?? null,
      },
    });

    // If we have a printer that's ONLINE, try to process immediately
    if (printerConfigId) {
      const printer = await this.prisma.printerConfig.findUnique({
        where: { id: printerConfigId },
      });
      if (printer && printer.status === 'ONLINE') {
        // Fire-and-forget processing
        this.processNextJob().catch(() => {
          /* log silently - errors are recorded on the job */
        });
      }
    }

    return job as unknown as PrintJobRecord;
  }

  async processNextJob(): Promise<void> {
    // Find the oldest PENDING job
    const job = await this.prisma.printJob.findFirst({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' as const },
    });

    if (!job) return;

    await this.processJob(job as unknown as PrintJobRecord);
  }

  async processAllPending(): Promise<{ processed: number; failed: number }> {
    const pending = await this.prisma.printJob.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' as const },
    });

    let processed = 0;
    let failed = 0;

    for (const job of pending) {
      try {
        await this.processJob(job as unknown as PrintJobRecord);
        processed++;
      } catch {
        failed++;
      }
    }

    return { processed, failed };
  }

  async retryJob(jobId: string): Promise<PrintJobRecord> {
    const job = await this.prisma.printJob.findUnique({
      where: { id: jobId },
    });

    if (!job) throw new PrintJobNotFoundException(jobId);

    // Determine if we should reset the attempt counter
    // For transient failures (paper out, offline), keep the counter
    // For persistent failures (driver error), keep the existing state
    const shouldResetAttempts =
      job.lastError &&
      (job.lastError.toLowerCase().includes('paper') ||
        job.lastError.toLowerCase().includes('out of'));

    const updated = await this.prisma.printJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        nextRetryAt: null,
        lastError: null,
        attempts: shouldResetAttempts ? 0 : job.attempts,
      },
    });

    return updated as unknown as PrintJobRecord;
  }

  async discardJob(jobId: string, reason: string): Promise<PrintJobRecord> {
    const job = await this.prisma.printJob.findUnique({
      where: { id: jobId },
    });

    if (!job) throw new PrintJobNotFoundException(jobId);

    const updated = await this.prisma.printJob.update({
      where: { id: jobId },
      data: {
        status: 'DISCARDED',
        lastError: reason,
        completedAt: new Date(),
      },
    });

    return updated as unknown as PrintJobRecord;
  }

  async listJobs(filters?: {
    status?: PrintJobStatus | PrintJobStatus[];
    jobType?: PrintJobType;
    printerId?: string;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ items: PrintJobRecord[]; total: number }> {
    const where: Record<string, unknown> = {};

    if (filters?.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }
    if (filters?.jobType) where.jobType = filters.jobType;
    if (filters?.printerId) where.printerConfigId = filters.printerId;
    if (filters?.since || filters?.until) {
      const createdAt: Record<string, Date> = {};
      if (filters.since) createdAt.gte = filters.since;
      if (filters.until) createdAt.lte = filters.until;
      where.createdAt = createdAt;
    }

    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.printJob.findMany({
        where,
        orderBy: { createdAt: 'desc' as const },
        take: limit,
        skip: offset,
      }),
      this.prisma.printJob.count({ where }),
    ]);

    return {
      items: items as unknown as PrintJobRecord[],
      total,
    };
  }

  async getJob(jobId: string): Promise<PrintJobRecord> {
    const job = await this.prisma.printJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new PrintJobNotFoundException(jobId);
    return job as unknown as PrintJobRecord;
  }

  async getQueueSummary(): Promise<PrintQueueSummary> {
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

    // Calculate average attempts before success for recently completed jobs
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

  async countPendingForPrinter(printerId: string): Promise<number> {
    return this.prisma.printJob.count({
      where: {
        printerConfigId: printerId,
        status: 'PENDING',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Process a single print job.
   * Updates the job status to PRINTING, calls the executePrint callback,
   * and updates the job status to COMPLETED or FAILED.
   */
  private async processJob(job: PrintJobRecord): Promise<void> {
    const attemptCount = job.attempts + 1;

    // Check max attempts
    if (attemptCount > MAX_ATTEMPTS) {
      await this.prisma.printJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          attempts: attemptCount,
          lastError: `Se superó el máximo de ${MAX_ATTEMPTS} intentos.`,
          completedAt: new Date(),
        },
      });
      return;
    }

    // Update to PRINTING
    await this.prisma.printJob.update({
      where: { id: job.id },
      data: {
        status: 'PRINTING',
        attempts: attemptCount,
        routingLog: this.appendRoutingLog(
          job.routingLog,
          `Intento #${attemptCount}: Iniciando impresión...`,
        ),
      },
    });

    // Resolve which printer to use
    let printer: PrinterConfigRecord | null = null;
    if (job.printerConfigId) {
      const p = await this.prisma.printerConfig.findUnique({
        where: { id: job.printerConfigId },
      });
      printer = p as unknown as PrinterConfigRecord | null;
    }

    if (!printer) {
      // Try to resolve a printer for this job type
      const resolved = await this.resolvePrinter(job.jobType);
      if (!resolved) {
        await this.markJobFailed(
          job.id,
          attemptCount,
          'No hay impresora configurada para este tipo de trabajo.',
        );
        return;
      }
      printer = resolved;

      // Assign the printer
      await this.prisma.printJob.update({
        where: { id: job.id },
        data: { printerConfigId: printer.id },
      });
    }

    // Check if the payload file still exists
    if (!(await this.fileExists(job.payloadPath))) {
      await this.markJobFailed(
        job.id,
        attemptCount,
        `Archivo no encontrado: ${job.payloadPath}`,
      );
      return;
    }

    // Call the print execution callback
    const result = await this.executePrint(
      printer.systemName,
      job.payloadPath,
      job.payloadType,
    );

    if (result.success) {
      await this.prisma.printJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          lastError: null,
          nextRetryAt: null,
          routingLog: this.appendRoutingLog(
            job.routingLog,
            `Intento #${attemptCount}: Impresión exitosa en "${printer.friendlyName}".`,
          ),
        },
      });
    } else {
      const errorMsg =
        result.errorMessage ?? 'Error desconocido al imprimir.';
      const isPaperOut = result.paperOut ?? false;

      // Schedule retry
      const delayIndex = Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1);
      const nextRetryAt = new Date(Date.now() + RETRY_DELAYS_MS[delayIndex]);

      const newStatus: PrintJobStatus =
        attemptCount >= MAX_ATTEMPTS ? PrintJobStatus.FAILED : PrintJobStatus.RETRYING;

      await this.prisma.printJob.update({
        where: { id: job.id },
        data: {
          status: newStatus,
          lastError: errorMsg,
          nextRetryAt: attemptCount < MAX_ATTEMPTS ? nextRetryAt : null,
          completedAt: newStatus === 'FAILED' ? new Date() : null,
          routingLog: this.appendRoutingLog(
            job.routingLog,
            `Intento #${attemptCount}: Falló - ${errorMsg}` +
              (isPaperOut ? ' (sin papel)' : '') +
              (attemptCount < MAX_ATTEMPTS
                ? `. Reintento en ${RETRY_DELAYS_MS[delayIndex] / 1000}s`
                : '. Sin más reintentos.'),
          ),
        },
      });
    }
  }

  private async markJobFailed(
    jobId: string,
    attemptCount: number,
    errorMessage: string,
  ): Promise<void> {
    await this.prisma.printJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        attempts: attemptCount,
        lastError: errorMessage,
        completedAt: new Date(),
        routingLog: this.appendRoutingLog(
          null,
          `Intento #${attemptCount}: ${errorMessage}`,
        ),
      },
    });
  }

  /**
   * Append a log entry to the routing log.
   */
  private appendRoutingLog(
    existingLog: string | null,
    entry: string,
  ): string {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${entry}`;
    return existingLog
      ? `${existingLog}\n${logLine}`
      : logLine;
  }

  /**
   * Check if a file exists at the given path.
   *
   * In Tauri mode, delegates to the Rust `file_exists` command which
   * checks the filesystem directly. In browser dev mode, falls back to
   * a fetch-based check. Returns `true` if the file can be read.
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<boolean>('file_exists', { path });
    } catch {
      try {
        const response = await fetch(path);
        return response.ok;
      } catch {
        return false;
      }
    }
  }
}
