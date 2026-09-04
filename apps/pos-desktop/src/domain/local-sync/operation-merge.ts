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
 * First-write-wins per entity: the operation that arrived earliest (by
 * sourceCreatedAt) is accepted; later operations targeting the same entity
 * are rejected. Ties break by workstation ID (deterministic).
 *
 * The live hub enforces the same rule in Rust (`entity_key()` +
 * `check_for_conflict_stored()` in `src-tauri/src/local_sync_server.rs`)
 * so peers get immediate first-write-wins feedback at push time; this
 * TypeScript merge is the reference implementation and the fallback for
 * any client-side reconciliation. Keep the entity-identity lookup order
 * identical on both sides.
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
 * Two operations conflict if they have the same operationType AND target the
 * same logical entity. The entity is identified by extracting the entity
 * identifier from the payload — NEVER by payloadHash alone, which is a hash
 * of the full content: two adjustments to the same lot with different
 * quantities have different hashes but target the same entity and must
 * conflict, while a replay of the same bytes carries the same
 * operationUuid and is deduped before ever reaching this check.
 *
 * The Rust hub mirrors this lookup order in `entity_key()`
 * (`src-tauri/src/local_sync_server.rs`) — keep both in sync. Unknown
 * shapes fall back to `hash:<payloadHash>` (conservative: only byte-equal
 * payloads collide).
 */
function entityKey(op: LocalOperation): string {
  return `${op.operationType}::${entityIdentity(op) ?? `hash:${op.payloadHash}`}`;
}

/**
 * Extract the target-entity identifier from an operation payload.
 * Returns null when the payload carries no recognizable entity id.
 */
export function entityIdentity(op: LocalOperation): string | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(op.payload) as Record<string, unknown>;
  } catch {
    return null;
  }
  const metadata =
    payload.metadata as Record<string, unknown> | undefined;
  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;
  const num = (value: unknown): string | null =>
    typeof value === 'number' || typeof value === 'string'
      ? String(value)
      : null;

  switch (op.operationType) {
    case 'SALE_CONFIRMATION':
      return (
        str(metadata?.localSaleId) ??
        num(metadata?.localNumber) ??
        str(payload.localSaleId)
      );
    case 'SHIFT_OPEN':
    case 'SHIFT_CLOSURE':
      return (
        str(payload.cashShiftId) ?? str(metadata?.cashShiftId)
      );
    case 'PRODUCT_CREATION':
    case 'PRODUCT_UPDATE': {
      const dto = (payload.createProductDto ??
        payload.updateProductDto) as Record<string, unknown> | undefined;
      return (
        str(metadata?.productId) ??
        str(dto?.internalCode) ??
        str(dto?.id)
      );
    }
    case 'CLIENT_CREATION':
    case 'CLIENT_UPDATE': {
      const dto = (payload.createClientDto ??
        payload.updateClientDto) as Record<string, unknown> | undefined;
      return (
        str(metadata?.clientId) ??
        str(dto?.identificationNumber) ??
        str(dto?.fullName) ??
        str(dto?.id)
      );
    }
    case 'CLIENT_DEACTIVATE': {
      const dto = payload.deactivateClientDto as
        | Record<string, unknown>
        | undefined;
      return str(dto?.clientId) ?? str(payload.clientId);
    }
    case 'INVENTORY_ADJUSTMENT':
      return (
        str(payload.lotId) ??
        str(metadata?.adjustmentId) ??
        str(payload.adjustmentId)
      );
    case 'CLIENT_RETURN':
      return (
        num(payload.sequentialNumber) ??
        num(payload.receiptNumber) ??
        str(payload.returnId)
      );
    case 'CLIENT_CREDIT_PAYMENT':
    case 'CLIENT_CREDIT_PAYMENT_ANNULMENT':
      return (
        num(payload.sequentialNumber) ?? str(payload.paymentId)
      );
    case 'PRESCRIPTION_REGISTRATION':
      return (
        str(payload.prescriptionNumber) ?? str(payload.prescriptionId)
      );
    case 'INVOICE_TRANSMISSION':
    case 'INVOICE_TRANSMISSION_RESULT':
    case 'INVOICE_ADJUSTMENT':
    case 'FISCAL_DOCUMENT_SYNC':
      return (
        str(payload.invoiceNumber) ??
        str(payload.invoiceId) ??
        str(metadata?.localSaleId)
      );
    case 'PURCHASE_ORDER_CONFIRMATION':
    case 'PURCHASE_RECEPTION_CONFIRMATION':
    case 'SUPPLIER_RETURN_CONFIRMATION':
      return num(payload.sequentialNumber) ?? str(payload.orderId);
    case 'RESOLUTION_ALLOCATION':
      return str(payload.resolutionId) ?? str(payload.prefix);
    case 'AUDIT_LOG_BATCH':
      // Audit batches are append-only bookkeeping, never entity mutations:
      // each batch is unique by definition and must never conflict.
      return `batch:${op.operationUuid}`;
    default:
      return null;
  }
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
