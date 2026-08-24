/**
 * Sync ledger integrity verification client.
 *
 * After a successful reconnect/relogin the POS reports the full local
 * SyncQueue ledger to the server (`POST /sync/integrity/verify`) so the
 * server can flag operations it never received (NOT_SUBMITTED), never
 * accepted (NOT_ACCEPTED), or whose local status disagrees with its own
 * (STATUS_MISMATCH). This closes the visibility gap left by historically
 * discarded entries: the server can now see holes in a workstation's
 * movement sequence even though nothing can repair them locally.
 *
 * Read-only by contract: verdicts never modify local data. Remediation is
 * manual/administrative.
 */

import type { PrismaClient } from '@pharmacy/database/local';
import { createAuthHttpClient } from '../auth/auth-http-client';

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/**
 * Status vocabulary the server accepts for verification. Local-only states
 * are folded onto these values — see `mapLocalStatusToWireStatus`.
 */
export type SyncQueueWireStatus = 'SYNCED' | 'PENDING' | 'FAILED' | 'DISCARDED';

export interface SyncIntegrityOperation {
  operationUuid: string;
  status: SyncQueueWireStatus;
  /** Per-workstation sequential sale number; only present for sales. */
  localNumber?: number;
}

export interface SyncIntegrityVerifyRequest {
  workstationId: string;
  operations: SyncIntegrityOperation[];
}

export type SyncIntegrityVerdict =
  | 'OK'
  | 'NOT_SUBMITTED'
  | 'NOT_ACCEPTED'
  | 'STATUS_MISMATCH';

export interface SyncIntegrityResultRow {
  operationUuid: string;
  verdict: SyncIntegrityVerdict;
  clientStatus: string;
  serverStatus: string | null;
}

export interface SyncIntegrityResponse {
  checkedAt: string;
  results: SyncIntegrityResultRow[];
  summary: Record<SyncIntegrityVerdict, number>;
}

/** Max operations per request — keeps payloads well under server limits. */
export const SYNC_INTEGRITY_CHUNK_SIZE = 1000;

const INTEGRITY_VERIFY_ENDPOINT = '/sync/integrity/verify';

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * Fold the local SyncStatus enum onto the wire vocabulary.
 *
 * PERMANENT_FAILURE has no wire equivalent of its own — it is a terminal
 * failed state, so it reports as FAILED. Unknown statuses (forward
 * compatibility if the local enum grows) report as PENDING rather than
 * guessing at a terminal state.
 */
export function mapLocalStatusToWireStatus(localStatus: string): SyncQueueWireStatus {
  switch (localStatus) {
    case 'COMPLETED':
      return 'SYNCED';
    case 'FAILED':
    case 'PERMANENT_FAILURE':
      return 'FAILED';
    case 'DISCARDED':
      return 'DISCARDED';
    case 'PENDING':
    case 'PROCESSING':
    default:
      return 'PENDING';
  }
}

/**
 * Extract `metadata.localNumber` from a SALE_CONFIRMATION payload.
 * Returns undefined when the payload can't be parsed or doesn't carry a
 * finite number — non-sale operations have no sequence number to report.
 */
function extractSaleLocalNumber(payload: string): number | undefined {
  try {
    const parsed = JSON.parse(payload) as { metadata?: { localNumber?: unknown } };
    const value = parsed.metadata?.localNumber;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Local queue collection
// ---------------------------------------------------------------------------

export interface CollectedIntegrityBatch {
  operations: SyncIntegrityOperation[];
}

/**
 * Read every local SyncQueue entry — all statuses, including historical
 * DISCARDED rows so the server can flag them — and shape each one into a
 * verification operation. Sales additionally carry their sequential
 * localNumber so the server can detect gaps in the movement sequence.
 */
export async function collectSyncIntegrityOperations(
  prisma: PrismaClient,
): Promise<CollectedIntegrityBatch> {
  const entries = await prisma.syncQueue.findMany({
    select: {
      operationUuid: true,
      status: true,
      operationType: true,
      payload: true,
    },
    orderBy: { clientSequence: 'asc' as const },
  });

  const operations: SyncIntegrityOperation[] = entries.map((entry) => {
    const operation: SyncIntegrityOperation = {
      operationUuid: entry.operationUuid,
      status: mapLocalStatusToWireStatus(entry.status),
    };
    if (entry.operationType === 'SALE_CONFIRMATION') {
      const localNumber = extractSaleLocalNumber(entry.payload);
      if (localNumber !== undefined) {
        operation.localNumber = localNumber;
      }
    }
    return operation;
  });

  return { operations };
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export interface SyncIntegrityClient {
  verifyIntegrity(
    request: SyncIntegrityVerifyRequest,
    accessToken: string,
  ): Promise<SyncIntegrityResponse>;
}

export function createSyncIntegrityClient(config: {
  baseUrl: string;
}): SyncIntegrityClient {
  const http = createAuthHttpClient(config.baseUrl);
  return {
    verifyIntegrity: (request, accessToken) =>
      http.postWithAuth<SyncIntegrityResponse>(
        INTEGRITY_VERIFY_ENDPOINT,
        request,
        accessToken,
      ),
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface SyncIntegrityRunOutcome {
  /** Total operations reported across all chunks. */
  operationCount: number;
  /** Operations whose verdict was not OK. */
  flaggedCount: number;
  /** Aggregated per-verdict counts across all chunks. */
  byVerdict: Record<SyncIntegrityVerdict, number>;
  /** Server timestamp of the last chunk's verification, when any ran. */
  checkedAt: string | null;
}

export interface SyncIntegrityVerificationConfig {
  prisma: PrismaClient;
  baseUrl: string;
  accessToken: string;
  workstationId: string;
}

const EMPTY_VERDICTS = (): Record<SyncIntegrityVerdict, number> => ({
  OK: 0,
  NOT_SUBMITTED: 0,
  NOT_ACCEPTED: 0,
  STATUS_MISMATCH: 0,
});

/**
 * Collect the local ledger and verify it against the server in sequential
 * chunks of at most {@link SYNC_INTEGRITY_CHUNK_SIZE} operations.
 *
 * Throws on transport/auth failure — callers decide whether that is fatal
 * (it must never block login). Verdicts are only logged here; mutating
 * local state based on them is forbidden by design.
 */
export async function runSyncIntegrityVerification(
  config: SyncIntegrityVerificationConfig,
): Promise<SyncIntegrityRunOutcome> {
  const { operations } = await collectSyncIntegrityOperations(config.prisma);

  const outcome: SyncIntegrityRunOutcome = {
    operationCount: operations.length,
    flaggedCount: 0,
    byVerdict: EMPTY_VERDICTS(),
    checkedAt: null,
  };

  if (operations.length === 0) {
    return outcome;
  }

  const client = createSyncIntegrityClient({ baseUrl: config.baseUrl });

  // Sequential chunks: the server verifies in order and the requests are
  // rare (once per reconnect), so parallelism buys nothing but risk.
  for (let offset = 0; offset < operations.length; offset += SYNC_INTEGRITY_CHUNK_SIZE) {
    const chunk = operations.slice(offset, offset + SYNC_INTEGRITY_CHUNK_SIZE);
    const response = await client.verifyIntegrity(
      { workstationId: config.workstationId, operations: chunk },
      config.accessToken,
    );

    outcome.checkedAt = response.checkedAt;
    for (const row of response.results) {
      outcome.byVerdict[row.verdict] = (outcome.byVerdict[row.verdict] ?? 0) + 1;
      if (row.verdict !== 'OK') {
        outcome.flaggedCount += 1;
        console.warn(
          `[SyncIntegrity] ${row.verdict} for operation ${row.operationUuid} ` +
            `(client=${row.clientStatus}, server=${row.serverStatus ?? 'none'})`,
        );
      }
    }
  }

  return outcome;
}
