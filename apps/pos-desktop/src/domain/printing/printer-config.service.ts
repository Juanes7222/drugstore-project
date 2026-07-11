/**
 * Printer configuration service.
 *
 * Full CRUD for the local PrinterConfig table, plus job-type assignment
 * resolution, fallback chain configuration, and status updates driven by
 * the external health check loop.
 *
 * All reads/write go through the local PGlite-backed Prisma client. The
 * printer health status is updated by PrinteHealthService — this service
 * only stores whatever status is passed to it.
 */

import type { PrismaClient } from '@pharmacy/database/local';
import {
  JobTypeAlreadyAssignedException,
  PrinterNotConfiguredException,
  FallbackCycleException,
} from './exceptions';
import type {
  PrinterConfigRecord,
  PrinterConfigInput,
  PrinterStatusCode,
  PrintJobType,
} from './printing-types';

export interface PrinterConfigService {
  /** List all configured printers, ordered by friendly name. */
  listAll(): Promise<PrinterConfigRecord[]>;

  /** Get a single printer by its ID. */
  getById(printerId: string): Promise<PrinterConfigRecord>;

  /** Create a new printer configuration. */
  create(input: PrinterConfigInput): Promise<PrinterConfigRecord>;

  /** Update an existing printer configuration. */
  update(
    printerId: string,
    input: Partial<PrinterConfigInput>,
  ): Promise<PrinterConfigRecord>;

  /** Remove a printer configuration. */
  delete(printerId: string): Promise<void>;

  /** Get the primary printer assigned to a specific job type. */
  getPrinterForJobType(jobType: PrintJobType): Promise<PrinterConfigRecord | null>;

  /**
   * Resolve the best available printer for a job type, walking the fallback
   * chain. Returns the first ONLINE printer in the chain, or null if none
   * are available.
   */
  resolvePrinterWithFallback(
    jobType: PrintJobType,
    activeOnlinePrinterIds?: string[],
  ): Promise<{ printer: PrinterConfigRecord; usedFallback: boolean } | null>;

  /**
   * Atomically update the assigned jobs for a single printer. Validates
   * that each job type has at most one primary assignment.
   */
  updatePrinterAssignments(
    printerId: string,
    jobTypes: string[],
  ): Promise<PrinterConfigRecord>;

  /**
   * Set the fallback chain for a printer: a fallback printer (UUID) and/or
   * a server-side fallback flag. Validates there are no cycles.
   */
  setFallbackChain(
    printerId: string,
    fallbackPrinterId: string | null,
    serverFallbackEnabled: boolean,
  ): Promise<PrinterConfigRecord>;

  /**
   * Update the status of a printer (called by the health check loop).
   */
  updateStatus(
    printerId: string,
    status: PrinterStatusCode,
    errorMessage?: string | null,
  ): Promise<void>;

  /** Check if any printer is configured at all. */
  hasAnyConfigured(): Promise<boolean>;

  /**
   * Find a printer by its OS system name.
   * Used during import to match exported configs to discovered printers.
   */
  findBySystemName(systemName: string): Promise<PrinterConfigRecord | null>;
}

export const createPrinterConfigService = (
  prisma: PrismaClient,
): PrinterConfigService => {
  return new PrinterConfigServiceImpl(prisma);
};

class PrinterConfigServiceImpl implements PrinterConfigService {
  constructor(private readonly prisma: PrismaClient) {}

  async listAll(): Promise<PrinterConfigRecord[]> {
    const printers = await this.prisma.printerConfig.findMany({
      orderBy: { friendlyName: 'asc' as const },
      include: { fallbackPrinter: true },
    });
    return printers as unknown as PrinterConfigRecord[];
  }

  async getById(printerId: string): Promise<PrinterConfigRecord> {
    const printer = await this.prisma.printerConfig.findUnique({
      where: { id: printerId },
    });
    if (!printer) {
      throw new PrinterNotConfiguredException(printerId);
    }
    return printer as unknown as PrinterConfigRecord;
  }

  async create(input: PrinterConfigInput): Promise<PrinterConfigRecord> {
    // Validate fallback chain doesn't form a cycle
    if (input.fallbackPrinterId) {
      await this.validateFallbackNoCycle(input.fallbackPrinterId, null);
    }

    const printer = await this.prisma.printerConfig.create({
      data: {
        id: crypto.randomUUID(),
        friendlyName: input.friendlyName,
        systemName: input.systemName,
        printerType: input.printerType,
        connection: input.connection,
        paperSize: input.paperSize,
        supportsColor: input.supportsColor,
        assignedJobs: input.assignedJobs,
        fallbackPrinterId: input.fallbackPrinterId ?? null,
        serverFallbackEnabled: input.serverFallbackEnabled ?? false,
        status: 'UNKNOWN',
      },
    });
    return printer as unknown as PrinterConfigRecord;
  }

  async update(
    printerId: string,
    input: Partial<PrinterConfigInput>,
  ): Promise<PrinterConfigRecord> {
    const existing = await this.getById(printerId);

    // Validate fallback if changing it
    const newFallback = input.fallbackPrinterId ?? existing.fallbackPrinterId;
    if (newFallback && newFallback !== existing.fallbackPrinterId) {
      await this.validateFallbackNoCycle(newFallback, printerId);
    }

    // Validate job assignments if provided
    if (input.assignedJobs) {
      // Check no other printer has these job types as primary
      for (const jobType of input.assignedJobs) {
        const currentHolder = await this.prisma.printerConfig.findFirst({
          where: {
            assignedJobs: { has: jobType },
            id: { not: printerId },
          },
        });
        if (currentHolder) {
          throw new JobTypeAlreadyAssignedException(
            jobType,
            currentHolder.friendlyName,
          );
        }
      }
    }

    const updateData: Record<string, unknown> = {};
    if (input.friendlyName !== undefined) updateData.friendlyName = input.friendlyName;
    if (input.systemName !== undefined) updateData.systemName = input.systemName;
    if (input.printerType !== undefined) updateData.printerType = input.printerType;
    if (input.connection !== undefined) updateData.connection = input.connection;
    if (input.paperSize !== undefined) updateData.paperSize = input.paperSize;
    if (input.supportsColor !== undefined) updateData.supportsColor = input.supportsColor;
    if (input.assignedJobs !== undefined) updateData.assignedJobs = input.assignedJobs;
    if (input.fallbackPrinterId !== undefined) updateData.fallbackPrinterId = input.fallbackPrinterId;
    if (input.serverFallbackEnabled !== undefined) updateData.serverFallbackEnabled = input.serverFallbackEnabled;

    const printer = await this.prisma.printerConfig.update({
      where: { id: printerId },
      data: updateData,
    });
    return printer as unknown as PrinterConfigRecord;
  }

  async delete(printerId: string): Promise<void> {
    // Remove this printer as a fallback for others
    await this.prisma.printerConfig.updateMany({
      where: { fallbackPrinterId: printerId },
      data: { fallbackPrinterId: null },
    });

    // Unassign print jobs from this printer
    await this.prisma.printJob.updateMany({
      where: { printerConfigId: printerId },
      data: { printerConfigId: null },
    });

    await this.prisma.printerConfig.delete({
      where: { id: printerId },
    });
  }

  async getPrinterForJobType(
    jobType: PrintJobType,
  ): Promise<PrinterConfigRecord | null> {
    const printer = await this.prisma.printerConfig.findFirst({
      where: {
        assignedJobs: { has: jobType },
      },
    });
    return printer as unknown as PrinterConfigRecord | null;
  }

  async resolvePrinterWithFallback(
    jobType: PrintJobType,
    activeOnlinePrinterIds?: string[],
  ): Promise<{ printer: PrinterConfigRecord; usedFallback: boolean } | null> {
    const primary = await this.getPrinterForJobType(jobType);
    if (!primary) return null;

    const onlineIds = new Set(activeOnlinePrinterIds ?? []);

    // Check primary
    if (onlineIds.size === 0 || onlineIds.has(primary.id)) {
      return { printer: primary, usedFallback: false };
    }

    // Walk fallback chain
    const visited = new Set<string>();
    let current = primary;

    while (current.fallbackPrinterId && !visited.has(current.fallbackPrinterId)) {
      visited.add(current.fallbackPrinterId);

      const fallback = await this.prisma.printerConfig.findUnique({
        where: { id: current.fallbackPrinterId },
      });

      if (!fallback) break;

      if (onlineIds.size === 0 || onlineIds.has(fallback.id)) {
        return { printer: fallback as unknown as PrinterConfigRecord, usedFallback: true };
      }

      current = fallback as unknown as PrinterConfigRecord;
    }

    // No fallback printer is online
    return null;
  }

  async updatePrinterAssignments(
    printerId: string,
    jobTypes: string[],
  ): Promise<PrinterConfigRecord> {
    // Validate each job type is only assigned to one printer
    for (const jobType of jobTypes) {
      const existingHolder = await this.prisma.printerConfig.findFirst({
        where: {
          assignedJobs: { has: jobType },
          id: { not: printerId },
        },
      });
      if (existingHolder) {
        throw new JobTypeAlreadyAssignedException(
          jobType,
          existingHolder.friendlyName,
        );
      }
    }

    return this.update(printerId, { assignedJobs: jobTypes });
  }

  async setFallbackChain(
    printerId: string,
    fallbackPrinterId: string | null,
    serverFallbackEnabled: boolean,
  ): Promise<PrinterConfigRecord> {
    if (fallbackPrinterId) {
      await this.validateFallbackNoCycle(fallbackPrinterId, printerId);
    }

    return this.update(printerId, {
      fallbackPrinterId,
      serverFallbackEnabled,
    });
  }

  async updateStatus(
    printerId: string,
    status: PrinterStatusCode,
    errorMessage?: string | null,
  ): Promise<void> {
    await this.prisma.printerConfig.update({
      where: { id: printerId },
      data: {
        status,
        lastStatusCheck: new Date(),
        lastErrorMessage: errorMessage ?? null,
      },
    });
  }

  async hasAnyConfigured(): Promise<boolean> {
    const count = await this.prisma.printerConfig.count();
    return count > 0;
  }

  async findBySystemName(systemName: string): Promise<PrinterConfigRecord | null> {
    const printer = await this.prisma.printerConfig.findFirst({
      where: { systemName },
    });
    return printer as unknown as PrinterConfigRecord | null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Validate that a fallback assignment does not create a cycle.
   * Walks the chain starting from `fallbackCandidate` and checks that
   * we never encounter `printerId`.
   */
  private async validateFallbackNoCycle(
    fallbackCandidateId: string,
    printerId: string | null,
  ): Promise<void> {
    const visited = new Set<string>();
    let current: string | null = fallbackCandidateId;

    while (current) {
      if (printerId && current === printerId) {
        throw new FallbackCycleException(printerId);
      }
      if (visited.has(current)) {
        throw new FallbackCycleException(current);
      }
      visited.add(current);

      const p = await this.prisma.printerConfig.findUnique({
        where: { id: current },
        select: { fallbackPrinterId: true },
      });
      current = p?.fallbackPrinterId ?? null;
    }
  }
}
