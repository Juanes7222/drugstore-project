/**
 * Open-shift pull synchronizer for the POS desktop app.
 *
 * The cash shift is store-wide (global): an admin opens it once, possibly
 * at another workstation. Every other POS learns about it by mirroring the
 * server's answer from `GET /cash-shifts/open` into the local PGlite table,
 * so it can keep selling into the same shift while offline.
 *
 * ## Shape
 * Follows the same pattern as `ClientPullService` / `CatalogSyncService`:
 * a network phase (`fetchOpenShift`) with no database access, an apply phase
 * (`applyOpenShift`) that must run under the PGlite write lock, and a
 * convenience `refreshOpenShift()` combining both.
 *
 * ## Conflict policy
 * - No local OPEN shift → adopt the server row verbatim.
 * - Same id → refresh the mirrored fields.
 * - Different id, local shift belongs to THIS workstation (a real local open
 *   whose SHIFT_OPEN push has not reached the server yet) → keep local,
 *   report `local-open-conflict`; once the push lands the server reports
 *   our id and the mirror converges.
 * - Different id, local shift is a foreign mirror (another workstation
 *   opened it) → the server is authoritative: the stale mirror is marked
 *   CLOSED (`forcedClose`, `SUPERSEDED_BY_SERVER_MIRROR`) and the new row
 *   is adopted. Totals are left untouched — reconciliation lives on the
 *   server.
 * - Server answers 404 (no open shift anywhere) → do nothing. The local
 *   open shift may simply be ahead of the server (push pending); closing
 *   it on the basis of a 404 would fabricate a close.
 */
import {
  PrismaClient,
  Prisma,
  ShiftState,
} from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import { dbWriteLock } from '../../infrastructure/write-lock';
import type { SyncHttpClient } from '../catalog/catalog-sync.service';
import { useCashShiftStore } from './cash-shift.store';
import type { CashShiftRecord } from './cash-shift.service';

// ---------------------------------------------------------------------------
// Config & factory
// ---------------------------------------------------------------------------

export interface OpenShiftPullConfig {
  /** Server base URL, e.g. "http://localhost:3000" */
  baseUrl: string;
  /** Optional override of the HTTP client (for testing). */
  httpClient?: SyncHttpClient;
  /** Optional auth token for protected endpoints. */
  accessToken?: string;
}

/** Workstation identity used to tell a local shift from a foreign mirror. */
export interface OpenShiftPullContext {
  workstationId: string;
}

export const createOpenShiftPullService = (
  prisma: PrismaClient,
  config: OpenShiftPullConfig,
  context: OpenShiftPullContext,
): OpenShiftPullService => {
  return new OpenShiftPullService(prisma, config, context);
};

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type OpenShiftPullResult =
  | { status: 'adopted'; shiftId: string }
  | { status: 'unchanged'; shiftId: string }
  | { status: 'superseded-stale-mirror'; adoptedShiftId: string }
  | { status: 'no-open-on-server' }
  | { status: 'offline' }
  | {
      status: 'local-open-conflict';
      localShiftId: string;
      serverShiftId: string;
    };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OpenShiftPullService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;

  constructor(
    private readonly prisma: PrismaClient,
    config: OpenShiftPullConfig,
    private readonly context: OpenShiftPullContext,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Fetch the server's open shift and mirror it locally, refreshing the
   * cash-shift store afterwards. Safe to call when offline — returns
   * early without throwing.
   *
   * Acquires the PGlite write lock itself; use the fetch/apply split when
   * the caller (sync scheduler) already holds the lock.
   */
  async refreshOpenShift(): Promise<OpenShiftPullResult> {
    if (!isOnline()) return { status: 'offline' };

    const row = await this.fetchOpenShift();
    if (!row) return { status: 'no-open-on-server' };

    await dbWriteLock.acquire('foreground');
    try {
      return await this.applyOpenShift(row);
    } finally {
      dbWriteLock.release();
    }
  }

  /**
   * Network phase: GET /cash-shifts/open. Returns null on 404 (no open
   * shift anywhere in the store). No database access — safe to run without
   * the PGlite write lock.
   */
  async fetchOpenShift(): Promise<ServerOpenShiftRow | null> {
    const authHeaders = this.buildAuthHeaders();
    try {
      return await this.http.get<ServerOpenShiftRow>(
        `${this.baseUrl}/cash-shifts/open`,
        authHeaders,
      );
    } catch (err) {
      if (err instanceof OpenShiftPullHttpError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Apply phase: mirror the fetched open shift into the local CashShift
   * table per the conflict policy in the module comment, then refresh the
   * reactive store. Must run under the PGlite write lock.
   */
  async applyOpenShift(row: ServerOpenShiftRow): Promise<OpenShiftPullResult> {
    const localOpen = (await this.prisma.cashShift.findFirst({
      where: { state: 'OPEN' },
    })) as CashShiftRecord | null;

    // Same shift — refresh the mirrored fields only.
    if (localOpen?.id === row.id) {
      await this.upsertServerShift(row);
      await this.refreshStore();
      return { status: 'unchanged', shiftId: row.id };
    }

    // A different OPEN shift exists locally...
    if (localOpen) {
      // Unknown workstation identity (scheduler built before any login) —
      // never supersede a shift we cannot attribute; report the conflict so
      // the next cycle after login resolves ownership correctly.
      const isLocallyOwned =
        this.context.workstationId === 'unknown' ||
        localOpen.workstationId === this.context.workstationId;

      if (isLocallyOwned) {
        // Check if the local shift's SHIFT_OPEN is already doomed (PERMANENT_FAILURE
        // or exhausted). A doomed push will never land, so keeping the local
        // open forever would split-brain the store (local sells into 9fa..., server
        // into e45...). In that case, retire the local and adopt the server's
        // authoritative row — same path as a foreign stale mirror.
        const doomed = await this.isLocalShiftDoomed(localOpen.id);
        if (!doomed) {
          // Real local open whose SHIFT_OPEN push has not landed yet. Keep
          // it — the server will converge to our id after the push.
          return {
            status: 'local-open-conflict',
            localShiftId: localOpen.id,
            serverShiftId: row.id,
          };
        }
        // Local shift will never land — fall through to supersede logic below.
      }

      // Foreign stale mirror OR locally-owned but doomed — the server already
      // moved on. Retire it without fabricating totals, then adopt the new row.
      await this.prisma.cashShift.update({
        where: { id: localOpen.id },
        data: {
          state: 'CLOSED',
          closedAt: new Date(),
          closingNotes: SUPERSEDED_BY_SERVER_MARKER,
          forcedClose: true,
        },
      });
      await this.upsertServerShift(row);
      await this.refreshStore();
      return { status: 'superseded-stale-mirror', adoptedShiftId: row.id };
    }

    // Nothing open locally — plain adoption.
    await this.upsertServerShift(row);
    await this.refreshStore();
    return { status: 'adopted', shiftId: row.id };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Mirror the server row into the local table. Idempotent by id so a
   * re-pull of the same shift only refreshes fields.
   */
  private async upsertServerShift(row: ServerOpenShiftRow): Promise<void> {
    const data = {
      workstationId: row.workstationId,
      userId: row.userId,
      openingBalance: new Prisma.Decimal(row.openingBalance),
      openedAt: new Date(row.openedAt),
      state: ShiftState.OPEN,
    };

    const existing = await this.prisma.cashShift.findUnique({
      where: { id: row.id },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.cashShift.update({ where: { id: row.id }, data });
    } else {
      await this.prisma.cashShift.create({
        data: {
          id: row.id,
          openingNotes: null,
          ...data,
        },
      });
    }
  }

  /**
   * Whether the local shift's SHIFT_OPEN will never land on the server.
   *
   * A locally-owned shift with a PENDING/FAILED (retryable) entry is still
   * in-flight — keep it. If the entry is PERMANENT_FAILURE, or there is no
   * entry at all (legacy bootstrap shift that never had a sync row), the push
   * is doomed and the local row should be retired in favor of the server's
   * authoritative OPEN.
   */
  private async isLocalShiftDoomed(shiftId: string): Promise<boolean> {
    try {
      const entries = await this.prisma.syncQueue.findMany({
        where: { operationType: 'SHIFT_OPEN' },
        select: { payload: true, status: true, retryCount: true },
      });
      let matched: { status: string; retryCount: number } | null = null;
      for (const e of entries as unknown as Array<{ payload: string; status: string; retryCount: number }>) {
        try {
          const p = JSON.parse(e.payload) as { shiftId?: string };
          if (p.shiftId === shiftId) {
            matched = e;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!matched) return true; // No sync row → legacy bootstrap, doomed in global model
      if (matched.status === 'PERMANENT_FAILURE') return true;
      if (matched.status === 'FAILED' && matched.retryCount >= 10) return true;
      return false;
    } catch {
      return false; // On query failure, be conservative and keep local
    }
  }

  /** Point the reactive store at whatever OPEN shift now exists locally. */
  private async refreshStore(): Promise<void> {
    const openShift = (await this.prisma.cashShift.findFirst({
      where: { state: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    })) as CashShiftRecord | null;

    useCashShiftStore.getState().setCurrentShift(openShift);
  }

  private buildAuthHeaders(): Record<string, string> {
    if (this.accessToken) {
      return { Authorization: `Bearer ${this.accessToken}` };
    }
    return {};
  }
}

// ---------------------------------------------------------------------------
// Default HTTP client
// ---------------------------------------------------------------------------

const defaultHttpClient: SyncHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new OpenShiftPullHttpError(url, response.status, await response.text());
    }
    return response.json() as Promise<T>;
  },
};

// ---------------------------------------------------------------------------
// Local error
// ---------------------------------------------------------------------------

export class OpenShiftPullHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(url: string, statusCode: number, responseBody: string) {
    super(`Open-shift pull HTTP error ${statusCode} for ${url}: ${responseBody}`);
    this.name = 'OpenShiftPullHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

/** Shape returned by the server's GET /cash-shifts/open (200 body). */
export interface ServerOpenShiftRow {
  id: string;
  /** Origin workstation that opened the shift — informational only. */
  workstationId: string;
  /** User who opened the shift — informational only. */
  userId: string;
  openedAt: string;
  /** Exact decimal serialized as string — parse with Decimal, never parseFloat. */
  openingBalance: string;
  state: 'OPEN';
}

/** Marker written on mirrors retired because the server moved past them. */
export const SUPERSEDED_BY_SERVER_MARKER = 'SUPERSEDED_BY_SERVER_MIRROR';
