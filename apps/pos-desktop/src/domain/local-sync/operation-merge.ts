/**
 * Operation merge logic for local sync.
 *
 * Decides which operation wins when two workstations modified the same
 * entity offline. Returns the winning operations and a list of rejected
 * operations that the loser should reverse locally.
 */

import { ConflictReason } from '@pharmacy/shared-types';
import type { LocalOperation } from '@pharmacy/shared-types';
import type { MergeResult, RejectedOperation } from './types';

/**
 * Merge local and remote operation queues.
 *
 * The hub calls this when it receives a push from a peer. The algorithm:
 *
 * 1. Group operations by entity (operationType + payload identity).
 * 2. For each group, apply first-write-wins: the operation that arrived
 *    earliest (by sourceCreatedAt) is accepted; later operations targeting
 *    the same entity are rejected.
 * 3. Ties are broken by workstation ID (deterministic).
 *
 * @param local - Operations already held by the hub.
 * @param incoming - Operations being pushed by the peer.
 * @returns MergeResult with winning and rejected operations.
 */
export function mergeLocalOperations(
  local: LocalOperation[],
  incoming: LocalOperation[],
): MergeResult {
  const winningOperations: LocalOperation[] = [...local];
  const rejectedOperations: RejectedOperation[] = [];

  // Build a map of existing operations by entity key for quick lookup.
  const existingByEntity = new Map<string, LocalOperation>();
  for (const op of local) {
    const key = entityKey(op);
    // Keep the earliest arrival.
    const existing = existingByEntity.get(key);
    if (!existing || op.sourceCreatedAt < existing.sourceCreatedAt) {
      existingByEntity.set(key, op);
    }
  }

  for (const op of incoming) {
    const key = entityKey(op);
    const existing = existingByEntity.get(key);

    if (!existing) {
      // No conflict — accept the operation.
      winningOperations.push(op);
      existingByEntity.set(key, op);
      continue;
    }

    // Conflict detected. Apply first-write-wins.
    if (op.sourceCreatedAt < existing.sourceCreatedAt) {
      // The incoming operation is older; it wins.
      // Remove the existing one and replace.
      const idx = winningOperations.findIndex(
        (w) => entityKey(w) === key,
      );
      if (idx !== -1) {
        rejectedOperations.push({
          operation: winningOperations[idx],
          reason: ConflictReason.FIRST_WRITE_WINS,
          winningOperationUuid: op.operationUuid,
        });
        winningOperations[idx] = op;
      }
      existingByEntity.set(key, op);
    } else if (op.sourceCreatedAt === existing.sourceCreatedAt) {
      // Tie-break by workstation ID.
      if (op.sourceWorkstationId < existing.sourceWorkstationId) {
        // Incoming wins (lexicographically smaller workstation ID).
        const idx = winningOperations.findIndex(
          (w) => entityKey(w) === key,
        );
        if (idx !== -1) {
          rejectedOperations.push({
            operation: winningOperations[idx],
            reason: ConflictReason.FIRST_WRITE_WINS,
            winningOperationUuid: op.operationUuid,
          });
          winningOperations[idx] = op;
        }
        existingByEntity.set(key, op);
      } else {
        // Existing wins.
        rejectedOperations.push({
          operation: op,
          reason: ConflictReason.FIRST_WRITE_WINS,
          winningOperationUuid: existing.operationUuid,
        });
      }
    } else {
      // Existing operation is older (or same time but won tie-break) — it wins.
      rejectedOperations.push({
        operation: op,
        reason: ConflictReason.FIRST_WRITE_WINS,
        winningOperationUuid: existing.operationUuid,
      });
    }
  }

  return { winningOperations, rejectedOperations };
}

/**
 * Build an entity key from an operation for conflict detection.
 *
 * Two operations conflict if they have the same operationType AND
 * target the same logical entity. The entity is identified by parsing
 * the payload (which contains entity identifiers).
 */
function entityKey(op: LocalOperation): string {
  // Use operationType + payloadHash as the conflict key.
  // payloadHash is a hash of the payload content that identifies
  // the target entity + the specific change.
  //
  // For operations that don't target the same entity (e.g., two
  // sales of different products), the payloadHash differs and they
  // are not considered conflicting.
  return `${op.operationType}::${op.payloadHash}`;
}

/**
 * Check if an operation's dependencies are satisfied.
 *
 * An operation may depend on another operation (e.g., a sale item
 * depends on the sale header). This function checks if the dependency
 * exists in the accepted operations set.
 */
export function hasDependenciesSatisfied(
  op: LocalOperation,
  accepted: LocalOperation[],
): boolean {
  // Parse the payload to extract dependency references.
  try {
    const payload = JSON.parse(op.payload) as Record<string, unknown>;
    if (!payload.dependsOn) {
      return true; // No dependency.
    }

    const dependsOn = payload.dependsOn as string[];
    for (const depUuid of dependsOn) {
      const found = accepted.some((a) => a.operationUuid === depUuid);
      if (!found) {
        return false;
      }
    }
    return true;
  } catch {
    // If we can't parse the payload, assume dependencies are satisfied
    // (the dependency check is advisory).
    return true;
  }
}
