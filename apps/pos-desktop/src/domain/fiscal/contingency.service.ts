/**
 * Contingency mode lifecycle service.
 *
 * Contingency is the Colombian DIAN "modo de contingencia": when the terminal
 * cannot reach DIAN (network lost, server unreachable, or DIAN maintenance),
 * the POS continues issuing provisional fiscal documents locally and queues
 * them for transmission once connectivity returns.
 *
 * This service owns the authoritative ContingencyEvent rows in the local
 * database and keeps the reactive `useContingencyStore` in sync. It is the
 * only place that creates or ends contingency events.
 *
 * ## State observation, not assertion
 *
 * The sale flow observes contingency state at confirm time; it does not
 * assert that the state remains unchanged during a long-running sale. If a
 * sale starts online and network drops while items are being entered, the
 * eventual confirm simply uses whatever the current contingency state is.
 */

import type { PrismaClient, Prisma } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import { useContingencyStore } from './contingency.store';
import type { ContingencyTrigger, ContingencyEventSummary } from './fiscal-types';
import { NoActiveContingencyException } from './exceptions';

export interface ContingencyServiceConfig {
  prisma: PrismaClient;
  workstationId: string;
  enterDebounceMs?: number;
  exitDebounceMs?: number;
}

export interface ContingencyService {
  /** True if there is an active ContingencyEvent in the database. */
  isInContingency(): Promise<boolean>;

  /**
   * Enter contingency mode. Idempotent: if already in contingency, returns
   * the active event without creating a duplicate.
   */
  enterContingency(
    trigger: ContingencyTrigger,
    reason: string,
  ): Promise<ContingencyEventSummary>;

  /**
   * End the active contingency event, computing summary counts from the
   * database.
   */
  exitContingency(): Promise<ContingencyEventSummary>;

  /**
   * Increment the generated-invoice counter for the active event.
   * No-op if there is no active event.
   */
  incrementGenerated(eventId: string, tx?: Prisma.TransactionClient): Promise<void>;

  /**
   * Increment the transmitted-invoice counter for the active event.
   * No-op if the event has already ended.
   */
  incrementTransmitted(eventId: string): Promise<void>;

  /**
   * Increment the expired-invoice counter for the active event.
   * No-op if the event has already ended.
   */
  incrementExpired(eventId: string): Promise<void>;

  /**
   * Hydrate the reactive store from the database. Call once at startup.
   */
  hydrateStore(): Promise<void>;

  /**
   * Start listening to browser online/offline events and automatically
   * transition contingency state after the configured debounce periods.
   */
  startNetworkMonitor(): void;

  /**
   * Stop listening to browser online/offline events.
   */
  stopNetworkMonitor(): void;

  /** List past contingency events for the manager audit page. */
  listHistory(limit?: number): Promise<ContingencyEventSummary[]>;
}

export const createContingencyService = (
  config: ContingencyServiceConfig,
): ContingencyService => {
  return new ContingencyServiceImpl(config);
};

class ContingencyServiceImpl implements ContingencyService {
  private readonly prisma: PrismaClient;
  private readonly workstationId: string;
  private readonly enterDebounceMs: number;
  private readonly exitDebounceMs: number;
  private enterTimer: ReturnType<typeof setTimeout> | null = null;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(config: ContingencyServiceConfig) {
    this.prisma = config.prisma;
    this.workstationId = config.workstationId;
    this.enterDebounceMs = config.enterDebounceMs ?? 30_000;
    this.exitDebounceMs = config.exitDebounceMs ?? 10_000;
  }

  async isInContingency(): Promise<boolean> {
    const active = await this.prisma.contingencyEvent.findFirst({
      where: { workstationId: this.workstationId, endedAt: null },
    });
    return active !== null;
  }

  async enterContingency(
    trigger: ContingencyTrigger,
    reason: string,
  ): Promise<ContingencyEventSummary> {
    const existing = await this.prisma.contingencyEvent.findFirst({
      where: { workstationId: this.workstationId, endedAt: null },
    });

    if (existing) {
      return this.mapContingencyEvent(existing);
    }

    const event = await this.prisma.contingencyEvent.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        startedAt: new Date(),
        workstationId: this.workstationId,
        trigger,
        triggerReason: reason,
        invoicesGenerated: 0,
        invoicesTransmitted: 0,
        invoicesExpired: 0,
        notifiedDian: false,
      },
    });

    useContingencyStore.getState().enter(
      event.id,
      event.triggerReason,
      event.startedAt,
    );

    return this.mapContingencyEvent(event);
  }

  async exitContingency(): Promise<ContingencyEventSummary> {
    const active = await this.prisma.contingencyEvent.findFirst({
      where: { workstationId: this.workstationId, endedAt: null },
    });

    if (!active) {
      throw new NoActiveContingencyException();
    }

    const counts = await this.computeEventCounts(active.id);

    const updated = await this.prisma.contingencyEvent.update({
      where: { id: active.id },
      data: {
        endedAt: new Date(),
        invoicesGenerated: counts.generated,
        invoicesTransmitted: counts.transmitted,
        invoicesExpired: counts.expired,
      },
    });

    useContingencyStore.getState().exit();
    return this.mapContingencyEvent(updated);
  }

  async incrementGenerated(
    eventId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const executor = tx ?? this.prisma;
    await executor.contingencyEvent.updateMany({
      where: { id: eventId, endedAt: null },
      data: { invoicesGenerated: { increment: 1 } },
    });

    if (!tx) {
      const event = await this.prisma.contingencyEvent.findUnique({
        where: { id: eventId },
      });
      if (event && event.endedAt === null) {
        useContingencyStore
          .getState()
          .updateCounts({ invoicesGenerated: event.invoicesGenerated + 1 });
      }
    }
  }

  async incrementTransmitted(eventId: string): Promise<void> {
    await this.prisma.contingencyEvent.updateMany({
      where: { id: eventId, endedAt: null },
      data: { invoicesTransmitted: { increment: 1 } },
    });

    const event = await this.prisma.contingencyEvent.findUnique({
      where: { id: eventId },
    });
    if (event && event.endedAt === null) {
      useContingencyStore
        .getState()
        .updateCounts({ invoicesTransmitted: event.invoicesTransmitted + 1 });
    }
  }

  async incrementExpired(eventId: string): Promise<void> {
    await this.prisma.contingencyEvent.updateMany({
      where: { id: eventId, endedAt: null },
      data: { invoicesExpired: { increment: 1 } },
    });

    const event = await this.prisma.contingencyEvent.findUnique({
      where: { id: eventId },
    });
    if (event && event.endedAt === null) {
      useContingencyStore
        .getState()
        .updateCounts({ invoicesExpired: event.invoicesExpired + 1 });
    }
  }

  async hydrateStore(): Promise<void> {
    const active = await this.prisma.contingencyEvent.findFirst({
      where: { workstationId: this.workstationId, endedAt: null },
    });

    if (active) {
      useContingencyStore
        .getState()
        .enter(active.id, active.triggerReason, active.startedAt);
      useContingencyStore.getState().updateCounts({
        invoicesGenerated: active.invoicesGenerated,
        invoicesTransmitted: active.invoicesTransmitted,
        invoicesExpired: active.invoicesExpired,
      });
    } else {
      useContingencyStore.getState().exit();
    }
  }

  startNetworkMonitor(): void {
    this.stopNetworkMonitor();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const handleOffline = () => {
      if (this.exitTimer) {
        clearTimeout(this.exitTimer);
        this.exitTimer = null;
      }
      if (this.enterTimer) return;
      this.enterTimer = setTimeout(() => {
        this.enterTimer = null;
        void this.enterContingency(
          'NETWORK_LOST',
          'Network connection lost for more than the configured debounce period.',
        );
      }, this.enterDebounceMs);
    };

    const handleOnline = () => {
      if (this.enterTimer) {
        clearTimeout(this.enterTimer);
        this.enterTimer = null;
      }
      if (this.exitTimer) return;
      this.exitTimer = setTimeout(() => {
        this.exitTimer = null;
        void this.exitContingency();
      }, this.exitDebounceMs);
    };

    window.addEventListener('offline', handleOffline, { signal });
    window.addEventListener('online', handleOnline, { signal });

    if (!isOnline()) {
      handleOffline();
    }
  }

  stopNetworkMonitor(): void {
    if (this.enterTimer) {
      clearTimeout(this.enterTimer);
      this.enterTimer = null;
    }
    if (this.exitTimer) {
      clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async listHistory(limit = 50): Promise<ContingencyEventSummary[]> {
    const events = await this.prisma.contingencyEvent.findMany({
      where: { workstationId: this.workstationId },
      orderBy: { startedAt: 'desc' as const },
      take: limit,
    });
    return events.map((e) => this.mapContingencyEvent(e));
  }

  private async computeEventCounts(eventId: string): Promise<{
    generated: number;
    transmitted: number;
    expired: number;
  }> {
    const [generated, transmitted, expired] = await Promise.all([
      this.prisma.invoice.count({ where: { contingencyEventId: eventId } }),
      this.prisma.invoice.count({
        where: {
          contingencyEventId: eventId,
          status: 'TRANSMITTED_AUTHORIZED',
        },
      }),
      this.prisma.invoice.count({
        where: {
          contingencyEventId: eventId,
          status: 'EXPIRED_CONTINGENCY',
        },
      }),
    ]);
    return { generated, transmitted, expired };
  }

  private mapContingencyEvent(event: {
    id: string;
    startedAt: Date;
    endedAt: Date | null;
    workstationId: string;
    trigger: string;
    triggerReason: string;
    invoicesGenerated: number;
    invoicesTransmitted: number;
    invoicesExpired: number;
    notifiedDian: boolean;
  }): ContingencyEventSummary {
    return {
      id: event.id,
      startedAt: event.startedAt.toISOString(),
      endedAt: event.endedAt?.toISOString() ?? null,
      workstationId: event.workstationId,
      trigger: event.trigger as ContingencyTrigger,
      triggerReason: event.triggerReason,
      invoicesGenerated: event.invoicesGenerated,
      invoicesTransmitted: event.invoicesTransmitted,
      invoicesExpired: event.invoicesExpired,
      notifiedDian: event.notifiedDian,
    };
  }
}
