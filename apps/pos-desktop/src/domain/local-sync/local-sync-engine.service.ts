/**
 * Local network sync engine — automatic LAN relay of SyncQueue operations.
 *
 * ## What it does
 *
 * Runs a periodic cycle that keeps every workstation's local outbox
 * replicated across the store's LAN while the internet is unavailable:
 *
 * 1. **Push** — reads `SyncQueue` entries not yet relayed to the LAN and
 *    hands them to the hub via the `push_to_hub` Tauri command. Entries the
 *    hub durably accepts are stamped with `lanRelayedAt`; anything else
 *    (transport error, disk-full rejection on the hub) stays eligible so
 *    the next cycle retries it.
 * 2. **Pull** — fetches operations buffered by the hub from other
 *    workstations and adopts them into our own `SyncQueue` as PENDING.
 *    Adoption is idempotent: `operationUuid` is unique, and re-adopting an
 *    already-known operation is a no-op.
 *
 * ## Why relay instead of applying locally
 *
 * The payload is forwarded byte-for-byte and the SERVER remains the only
 * component that replays business logic (stock, fiscal numbering, DIAN,
 * credit balances). The server deduplicates by `operationUuid`
 * (`ALREADY_ACCEPTED`), so an operation adopted by several stations and
 * pushed by each of them is applied exactly once. No business rule is ever
 * re-implemented client-side, which is what makes relaying safe for sales.
 *
 * A station that never sees the internet still ends up holding a full copy
 * of every other terminal's pending operations, so no sale is lost even if
 * the originating terminal dies before connectivity returns.
 */

import { invoke } from '@tauri-apps/api/core';
import {
  Prisma,
  SyncOperationType,
  SyncStatus,
  type PrismaClient,
} from '@pharmacy/database/local';

import type {
  PushResponse,
  PullResponse,
} from '../../renderer/services/local-sync/local-sync.service';
import { OPERATION_PRIORITY } from '../sync/sync-push.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How often the engine runs a push+pull cycle. */
const DEFAULT_CYCLE_INTERVAL_MS = 15_000;

/** Delay before the first cycle (lets mDNS + election settle after boot). */
const FIRST_CYCLE_DELAY_MS = 8_000;

/** Maximum entries relayed per cycle. */
const RELAY_BATCH_SIZE = 25;

/**
 * Queue statuses that must never be relayed: PERMANENT_FAILURE entries were
 * rejected by the server (relaying would poison peers) and DISCARDED entries
 * were explicitly written off by a manager.
 */
const NON_RELAYABLE_STATUSES: SyncStatus[] = [
  'PERMANENT_FAILURE' as SyncStatus,
  'DISCARDED' as SyncStatus,
];

const DEFAULT_OPERATION_PRIORITY = 99;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocalSyncEngineConfig {
  prisma: PrismaClient;
  /** This workstation's ID — used to skip our own operations when pulling. */
  workstationId: string;
  intervalMs?: number;
  /** Called after every cycle with its outcome (for stores / UI surfacing). */
  onCycleResult?: (result: LocalSyncCycleResult) => void;
}

export interface LocalSyncCycleResult {
  ranAt: string;
  /** 'no-hub' when this station currently has nobody to talk to. */
  outcome: 'ok' | 'skipped-no-hub' | 'error';
  pushedToHub: number;
  adoptedFromHub: number;
  errorMessage?: string;
}

export interface LocalSyncEngine {
  start(): void;
  stop(): void;
  /** Run one cycle immediately (used by tests and manual triggers). */
  runCycle(): Promise<LocalSyncCycleResult>;
}

type RelayableEntry = {
  id: string;
  operationUuid: string;
  operationType: string;
  payload: string;
  payloadHash: string;
  sourceWorkstationId: string;
  sourceCreatedAt: Date;
  retryCount: number;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLocalSyncEngine(
  config: LocalSyncEngineConfig,
): LocalSyncEngine {
  return new LocalSyncEngineImpl(config);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class LocalSyncEngineImpl implements LocalSyncEngine {
  private readonly prisma: PrismaClient;
  private readonly workstationId: string;
  private readonly intervalMs: number;
  private readonly onCycleResult?: (result: LocalSyncCycleResult) => void;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private cycleInFlight = false;

  constructor(config: LocalSyncEngineConfig) {
    this.prisma = config.prisma;
    this.workstationId = config.workstationId;
    this.intervalMs = config.intervalMs ?? DEFAULT_CYCLE_INTERVAL_MS;
    this.onCycleResult = config.onCycleResult;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.scheduleNext(FIRST_CYCLE_DELAY_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runCycle(): Promise<LocalSyncCycleResult> {
    const result = await this.cycleOnce();
    this.onCycleResult?.(result);
    return result;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  /**
   * One scheduled tick. Re-entrancy guard: a slow network round-trip must
   * never stack up overlapping cycles against the same PGlite instance.
   */
  private async tick(): Promise<void> {
    if (this.stopped || this.cycleInFlight) return;
    this.cycleInFlight = true;
    try {
      const result = await this.cycleOnce();
      this.onCycleResult?.(result);
    } catch (err) {
      // cycleOnce already reports errors through its result; this catch
      // exists to guarantee the loop itself never dies.
      console.error('[local-sync-engine] Unexpected cycle failure:', err);
    } finally {
      this.cycleInFlight = false;
      this.scheduleNext(this.intervalMs);
    }
  }

  private async cycleOnce(): Promise<LocalSyncCycleResult> {
    const ranAt = new Date().toISOString();

    let status: { currentHubAddress?: string | null; backoffUntil?: string | null };
    try {
      status = await invoke<{
        currentHubAddress: string | null;
        backoffUntil: string | null;
      }>('get_local_sync_status');
    } catch (err) {
      // Non-Tauri environments (tests / plain browser dev) have no backend.
      return this.result(ranAt, 'skipped-no-hub', 0, 0);
    }

    if (!status.currentHubAddress) {
      return this.result(ranAt, 'skipped-no-hub', 0, 0);
    }

    // Respect the Rust-side backoff window after repeated hub failures.
    if (status.backoffUntil) {
      const backoffUntil = Date.parse(status.backoffUntil);
      if (!Number.isNaN(backoffUntil) && backoffUntil > Date.now()) {
        return this.result(ranAt, 'skipped-no-hub', 0, 0);
      }
    }

    try {
      const pushed = await this.pushPendingToHub();
      const adopted = await this.pullAndAdoptFromHub();
      return this.result(ranAt, 'ok', pushed, adopted);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[local-sync-engine] Cycle error:', message);
      return this.result(ranAt, 'error', 0, 0, message);
    }
  }

  private result(
    ranAt: string,
    outcome: LocalSyncCycleResult['outcome'],
    pushedToHub: number,
    adoptedFromHub: number,
    errorMessage?: string,
  ): LocalSyncCycleResult {
    return { ranAt, outcome, pushedToHub, adoptedFromHub, errorMessage };
  }

  // -----------------------------------------------------------------------
  // Push phase
  // -----------------------------------------------------------------------

  /**
   * Read un-relayed queue entries and hand them to the hub. Only entries in
   * the hub's `acceptedOperationUuids` list get stamped as relayed — a bare
   * count is not enough because disk-full rejections arrive as "rejected"
   * without a conflict record, and those MUST be retried later.
   */
  private async pushPendingToHub(): Promise<number> {
    const entries = await this.fetchRelayableEntries();

    if (entries.length === 0) return 0;

    const operations = entries.map((entry) => ({
      operationUuid: entry.operationUuid,
      operationType: entry.operationType,
      payload: entry.payload,
      payloadHash: entry.payloadHash,
      sourceWorkstationId: entry.sourceWorkstationId,
      sourceCreatedAt: entry.sourceCreatedAt.toISOString(),
      retryCount: entry.retryCount,
    }));

    const response = await invoke<PushResponse>('push_to_hub', { operations });
    const acceptedUuids = new Set(response.acceptedOperationUuids ?? []);

    const relayedIds = entries
      .filter((entry) => acceptedUuids.has(entry.operationUuid))
      .map((entry) => entry.id);

    if (relayedIds.length > 0) {
      await this.prisma.syncQueue.updateMany({
        where: { id: { in: relayedIds } },
        data: { lanRelayedAt: new Date() },
      });
    }

    if (response.rejected > 0) {
      // Conflicts are first-write-wins duplicates or lost races; the server
      // arbitrates the authoritative outcome once online, so we log and move
      // on rather than retrying forever.
      const conflictSummary = (response.conflicts ?? [])
        .map((c) => `${c.operationUuid}:${c.reason}`)
        .join(', ');
      console.warn(
        `[local-sync-engine] Hub rejected ${response.rejected}/${entries.length} ` +
          `operations${conflictSummary ? ` — ${conflictSummary}` : ''}`,
      );
    }

    return relayedIds.length;
  }

  private async fetchRelayableEntries(): Promise<RelayableEntry[]> {
    const candidates = await this.prisma.syncQueue.findMany({
      where: {
        lanRelayedAt: null,
        status: { notIn: NON_RELAYABLE_STATUSES },
      },
      orderBy: { clientSequence: 'asc' },
      take: RELAY_BATCH_SIZE * 3,
    });

    return this.sortByPriority(candidates as unknown as RelayableEntry[]).slice(
      0,
      RELAY_BATCH_SIZE,
    );
  }

  /**
   * Same dependency-safe ordering as the internet push pipeline: creations
   * before updates before sales before post-sale operations. Peers adopting
   * these entries replay them to the server in the order we broadcast.
   */
  private sortByPriority(entries: RelayableEntry[]): RelayableEntry[] {
    return [...entries].sort((a, b) => {
      const pA = OPERATION_PRIORITY[a.operationType] ?? DEFAULT_OPERATION_PRIORITY;
      const pB = OPERATION_PRIORITY[b.operationType] ?? DEFAULT_OPERATION_PRIORITY;
      if (pA !== pB) return pA - pB;
      return Number(a.sourceCreatedAt) - Number(b.sourceCreatedAt);
    });
  }

  // -----------------------------------------------------------------------
  // Pull phase
  // -----------------------------------------------------------------------

  /**
   * Fetch operations the hub holds from OTHER workstations and adopt them
   * into our own queue as PENDING, so the normal internet push pipeline
   * forwards them to the server once connectivity returns.
   *
   * Adoption is per-row defensive: one malformed operation must never abort
   * the rest of the batch.
   */
  private async pullAndAdoptFromHub(): Promise<number> {
    const response = await invoke<PullResponse>('pull_from_hub');
    const foreignOps = (response.operations ?? []).filter(
      (op) => op.sourceWorkstationId !== this.workstationId,
    );

    let adopted = 0;

    for (const [index, op] of foreignOps.entries()) {
      try {
        await this.prisma.syncQueue.create({
          data: {
            id: globalThis.crypto.randomUUID(),
            operationUuid: op.operationUuid,
            operationType: castOperationType(op.operationType),
            payload: op.payload,
            payloadHash: op.payloadHash,
            payloadSize: op.payload.length,
            status: 'PENDING',
            sourceWorkstationId: op.sourceWorkstationId,
            sourceCreatedAt: new Date(op.sourceCreatedAt),
            // Adopted entries join the tail of OUR local sequence so they
            // are pushed to the server after everything created locally.
            clientSequence: BigInt(Date.now() * 1000 + index),
            receivedAt: new Date(),
          },
        });
        adopted += 1;
      } catch (err) {
        // Unique-violation on operationUuid = already known → fine.
        // Anything else (unknown enum value, malformed timestamp) is logged
        // and skipped so a single bad operation cannot stall the channel.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          continue;
        }
        console.warn(
          `[local-sync-engine] Skipped operation ${op.operationUuid} ` +
            `(${op.operationType}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return adopted;
  }
}

/**
 * Cast a wire operation type into the local Prisma enum. Unknown values
 * fail the insert with a validation error, which the caller catches per-row
 * so one malformed operation cannot stall the whole channel.
 */
function castOperationType(operationType: string): SyncOperationType {
  return operationType as SyncOperationType;
}
