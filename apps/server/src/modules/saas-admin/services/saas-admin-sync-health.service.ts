/**
 * SaaS-admin cross-tenant sync health — one aggregate row per subscription
 * with any server-side sync activity, worst first. The metric definitions
 * are the tenant-facing ones from modules/sync's SyncHealthService, regrouped
 * by subscriptionId instead of workstationId: PENDING rows on SyncQueue,
 * FAILED outcomes on SyncOperationOutcome (the declared server-side source
 * of truth), oldest pending taken from SyncQueue.receivedAt. Both tables
 * carry subscriptionId and are read unscoped there, so no RLS-scoped
 * per-tenant transactions are needed.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

/** One row of GET /saas-admin/sync-health. */
export interface SaasAdminSyncHealthRow {
  subscriptionId: string;
  customerName: string;
  pendingOperations: number;
  permanentFailures: number;
  /** Oldest PENDING operation's receivedAt (server-side clock), null if none. */
  oldestPendingAt: string | null;
  /** Latest SyncOperationOutcome.createdAt for any of the tenant's operations. */
  lastSyncAt: string | null;
}

/** Hard cap on returned rows regardless of how many tenants have activity. */
const SYNC_HEALTH_LIMIT = 100;

@Injectable()
export class SaasAdminSyncHealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Subscriptions with pending or processed sync activity, ordered by
   * permanent failures desc, then pending operations desc, then oldest
   * pending first (never-sold-style nulls last), capped at
   * SYNC_HEALTH_LIMIT.
   */
  async getSyncHealth(): Promise<SaasAdminSyncHealthRow[]> {
    // Same grouped queries as the tenant-facing health payload, just keyed
    // by subscription instead of workstation and without its time window.
    const [pendingGroups, oldestPendingGroups, failureGroups, lastSyncGroups] =
      await Promise.all([
        this.prisma.syncQueue.groupBy({
          by: ['subscriptionId'],
          where: { status: 'PENDING' },
          _count: true,
        }),
        this.prisma.syncQueue.groupBy({
          by: ['subscriptionId'],
          where: { status: 'PENDING' },
          _min: { receivedAt: true },
        }),
        this.prisma.syncOperationOutcome.groupBy({
          by: ['subscriptionId'],
          where: { outcome: 'FAILED' },
          _count: true,
        }),
        this.prisma.syncOperationOutcome.groupBy({
          by: ['subscriptionId'],
          _max: { createdAt: true },
        }),
      ]);

    const pendingBySubscription = new Map(
      pendingGroups.map((group) => [group.subscriptionId, group._count]),
    );
    const oldestPendingBySubscription = new Map(
      oldestPendingGroups.map((group) => [
        group.subscriptionId,
        group._min.receivedAt,
      ]),
    );
    const failuresBySubscription = new Map(
      failureGroups.map((group) => [group.subscriptionId, group._count]),
    );
    const lastSyncBySubscription = new Map(
      lastSyncGroups.map((group) => [
        group.subscriptionId,
        group._max.createdAt,
      ]),
    );

    // Any sync activity = appears in a pending group or has any outcome row
    // (failure counts and last-sync timestamps both come from outcomes).
    const subscriptionIds = [
      ...new Set([
        ...pendingBySubscription.keys(),
        ...failuresBySubscription.keys(),
        ...lastSyncBySubscription.keys(),
      ]),
    ];
    if (subscriptionIds.length === 0) {
      return [];
    }

    const subscriptions = await this.prisma.subscription.findMany({
      where: { id: { in: subscriptionIds } },
      select: { id: true, customerName: true },
    });
    const nameById = new Map(
      subscriptions.map((subscription) => [
        subscription.id,
        subscription.customerName,
      ]),
    );

    return subscriptionIds
      .map((subscriptionId) => ({
        subscriptionId,
        customerName: nameById.get(subscriptionId) ?? '',
        pendingOperations: pendingBySubscription.get(subscriptionId) ?? 0,
        permanentFailures: failuresBySubscription.get(subscriptionId) ?? 0,
        oldestPendingAt:
          oldestPendingBySubscription.get(subscriptionId)?.toISOString() ??
          null,
        lastSyncAt:
          lastSyncBySubscription.get(subscriptionId)?.toISOString() ?? null,
      }))
      .sort(byWorstFirst)
      .slice(0, SYNC_HEALTH_LIMIT);
  }
}

/** Worst first: most permanent failures, then deepest backlog, then stalest pending op. */
function byWorstFirst(a: SaasAdminSyncHealthRow, b: SaasAdminSyncHealthRow): number {
  if (b.permanentFailures !== a.permanentFailures) {
    return b.permanentFailures - a.permanentFailures;
  }
  if (b.pendingOperations !== a.pendingOperations) {
    return b.pendingOperations - a.pendingOperations;
  }
  if (a.oldestPendingAt !== b.oldestPendingAt) {
    // ISO-8601 UTC strings compare chronologically as plain strings;
    // nulls (no pending ops) sort after every timestamp.
    if (a.oldestPendingAt === null) {
      return 1;
    }
    if (b.oldestPendingAt === null) {
      return -1;
    }
    return a.oldestPendingAt.localeCompare(b.oldestPendingAt);
  }
  return a.subscriptionId.localeCompare(b.subscriptionId);
}
