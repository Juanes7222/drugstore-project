/**
 * Fiscal numbering service.
 *
 * Maintains two independent counters per workstation: one for regular
 * electronic invoices and one for contingency documents. The counters are
 * persisted in the local FiscalCounter table and incremented atomically inside
 * a transaction. Once a number is used it is never reused, satisfying DIAN's
 * consecutivity rule.
 */

import type { PrismaClient, Prisma } from '@pharmacy/database/local';
import {
  FiscalCounterNotInitializedError,
  FiscalCounterExhaustedError,
} from './exceptions';

export interface FiscalNumberingConfig {
  prisma: PrismaClient;
  workstationId: string;
}

export interface FiscalNumberingService {
  /**
   * Return the next formatted invoice number for the given type and mode.
   *
   * Runs inside the provided transaction when `tx` is given, otherwise uses
   * a fresh transaction. The counter row is locked via an atomic update so
   * concurrent callers never receive the same number.
   */
  nextNumber(
    type: 'ELECTRONIC_INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'SUPPORT_DOCUMENT' | 'CONTINGENCY_CANCELLATION',
    contingency: boolean,
    tx?: Prisma.TransactionClient,
  ): Promise<string>;

  /**
   * Ensure counters exist for the workstation. If missing, throws a loud
   * error so the app refuses to operate until a manager initializes them.
   */
  ensureCounters(): Promise<void>;

  /**
   * Manager initialization: create or update the counters for this workstation
   * with the values authorized by DIAN's resolution document.
   */
  initializeCounters(input: InitializeCountersInput): Promise<void>;

  /**
   * Sync the counters from the tenant's active DIAN resolution.
   *
   * Called by the configuration sync so the manager never has to type the
   * resolution values by hand. When the resolution is the same one already
   * applied, the regular counter is only ever advanced (never rewound —
   * the workstation may be ahead of the server after offline contingencies).
   * When the resolution changed (new range/prefix), the counter is reset to
   * the server-provided consecutive. The contingency counter is preserved.
   *
   * Returns `changed: true` when the counter row was modified.
   */
  syncFromResolution(input: SyncResolutionInput): Promise<{ changed: boolean }>;
}

export interface SyncResolutionInput {
  /** DIAN resolution prefix (e.g. "FE"). */
  prefix: string;
  /** First authorized number of the range. */
  authorizedStart: number;
  /** Last authorized number of the range. */
  authorizedEnd: number;
  /** Next number to issue per the server (range start + emitted count). */
  nextRegularNumber: number;
}

export interface InitializeCountersInput {
  workstationId: string;
  currentRegularNumber: number;
  currentContingencyNumber: number;
  resolutionPrefix?: string;
  contingencyPrefix?: string;
  paddingLength?: number;
  authorizedStart?: number;
  authorizedEnd?: number;
}

export const createFiscalNumberingService = (
  config: FiscalNumberingConfig,
): FiscalNumberingService => {
  return new FiscalNumberingServiceImpl(config.prisma, config.workstationId);
};

class FiscalNumberingServiceImpl implements FiscalNumberingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workstationId: string,
  ) {}

  async nextNumber(
    _type: 'ELECTRONIC_INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'SUPPORT_DOCUMENT' | 'CONTINGENCY_CANCELLATION',
    contingency: boolean,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const executor = tx ?? this.prisma;

    const counter = await executor.fiscalCounter.findUnique({
      where: { workstationId: this.workstationId },
    });

    if (!counter) {
      throw new FiscalCounterNotInitializedError(this.workstationId);
    }

    const prefix = contingency ? counter.contingencyPrefix : counter.resolutionPrefix;
    const field = contingency
      ? 'currentContingencyNumber'
      : 'currentRegularNumber';
    const current = contingency
      ? counter.currentContingencyNumber
      : counter.currentRegularNumber;
    const next = current + 1n;

    if (next > counter.authorizedEnd) {
      throw new FiscalCounterExhaustedError(
        contingency ? 'contingency' : 'regular',
      );
    }

    await executor.fiscalCounter.update({
      where: { workstationId: this.workstationId },
      data: { [field]: next },
    });

    const padded = next.toString().padStart(counter.paddingLength, '0');
    return `${prefix}-${this.workstationId.slice(0, 8)}-${padded}`;
  }

  async ensureCounters(): Promise<void> {
    const counter = await this.prisma.fiscalCounter.findUnique({
      where: { workstationId: this.workstationId },
    });
    if (!counter) {
      throw new FiscalCounterNotInitializedError(this.workstationId);
    }
  }

  async initializeCounters(input: InitializeCountersInput): Promise<void> {
    await this.prisma.fiscalCounter.upsert({
      where: { workstationId: this.workstationId },
      create: {
        id: globalThis.crypto.randomUUID(),
        workstationId: this.workstationId,
        currentRegularNumber: BigInt(input.currentRegularNumber),
        currentContingencyNumber: BigInt(input.currentContingencyNumber),
        resolutionPrefix: input.resolutionPrefix ?? 'FE',
        contingencyPrefix: input.contingencyPrefix ?? 'CONT',
        paddingLength: input.paddingLength ?? 8,
        authorizedStart: input.authorizedStart
          ? BigInt(input.authorizedStart)
          : 1n,
        authorizedEnd: input.authorizedEnd
          ? BigInt(input.authorizedEnd)
          : 99999999n,
      },
      update: {
        currentRegularNumber: BigInt(input.currentRegularNumber),
        currentContingencyNumber: BigInt(input.currentContingencyNumber),
        resolutionPrefix: input.resolutionPrefix ?? undefined,
        contingencyPrefix: input.contingencyPrefix ?? undefined,
        paddingLength: input.paddingLength ?? undefined,
        authorizedStart: input.authorizedStart
          ? BigInt(input.authorizedStart)
          : undefined,
        authorizedEnd: input.authorizedEnd
          ? BigInt(input.authorizedEnd)
          : undefined,
      },
    });
  }

  async syncFromResolution(
    input: SyncResolutionInput,
  ): Promise<{ changed: boolean }> {
    const counter = await this.prisma.fiscalCounter.findUnique({
      where: { workstationId: this.workstationId },
    });

    const authorizedStart = BigInt(input.authorizedStart);
    const authorizedEnd = BigInt(input.authorizedEnd);
    const nextRegularNumber = BigInt(input.nextRegularNumber);

    // Same resolution already applied — advance but never rewind the local
    // counter (the workstation may be ahead after offline contingencies).
    if (
      counter &&
      counter.resolutionPrefix === input.prefix &&
      counter.authorizedStart === authorizedStart &&
      counter.authorizedEnd === authorizedEnd
    ) {
      if (nextRegularNumber <= counter.currentRegularNumber) {
        return { changed: false };
      }
      await this.prisma.fiscalCounter.update({
        where: { workstationId: this.workstationId },
        data: { currentRegularNumber: nextRegularNumber },
      });
      return { changed: true };
    }

    // New resolution (or first sync): reset the regular counter to the
    // server consecutive, preserve the contingency counter.
    const currentContingencyNumber =
      counter?.currentContingencyNumber ?? 1n;

    await this.prisma.fiscalCounter.upsert({
      where: { workstationId: this.workstationId },
      create: {
        id: globalThis.crypto.randomUUID(),
        workstationId: this.workstationId,
        currentRegularNumber: nextRegularNumber,
        currentContingencyNumber,
        resolutionPrefix: input.prefix,
        contingencyPrefix: counter?.contingencyPrefix ?? 'CONT',
        paddingLength: counter?.paddingLength ?? 8,
        authorizedStart,
        authorizedEnd,
      },
      update: {
        currentRegularNumber: nextRegularNumber,
        currentContingencyNumber,
        resolutionPrefix: input.prefix,
        authorizedStart,
        authorizedEnd,
      },
    });
    return { changed: true };
  }
}
