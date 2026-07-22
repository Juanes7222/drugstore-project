/**
 * Local audit event constants + writer for offline POS events.
 *
 * Each domain service calls `write()` after completing an operation locally.
 * Events are stored in the `LocalAuditLog` table (local-only schema) and
 * surfaced alongside legacy `InventoryMovement` rows in the audit timeline.
 *
 * ## Usage
 *
 * ```ts
 * import { createLocalAuditWriter, LocalAuditEvent } from '../audit';
 *
 * const audit = createLocalAuditWriter(prisma);
 * await audit.write(LocalAuditEvent.CASH_SHIFT_OPENED, {
 *   category: 'cash_shift',
 *   entityType: 'CashShift',
 *   entityId: shift.id,
 *   userId: session.userId,
 *   userRole: session.role,
 *   workstationId: session.workstationId,
 *   details: { openingBalance: dto.openingBalance.toString() },
 * });
 * ```
 */
import type { PrismaClient } from '@pharmacy/database/local';

// ---------------------------------------------------------------------------
// Event constants
// ---------------------------------------------------------------------------

export const LocalAuditEvent = {
  // ── Cash shift ───────────────────────────────────────────────
  CASH_SHIFT_OPENED: 'CASH_SHIFT_OPENED',
  CASH_SHIFT_CLOSED: 'CASH_SHIFT_CLOSED',
  CASH_SHIFT_FORCED_CLOSE: 'CASH_SHIFT_FORCED_CLOSE',
  CASH_COUNT_PARTIAL: 'CASH_COUNT_PARTIAL',

  // ── Sales ────────────────────────────────────────────────────
  SALE_CONFIRMED: 'SALE_CONFIRMED',
  SALE_ANNULLED: 'SALE_ANNULLED',

  // ── Clients ──────────────────────────────────────────────────
  CLIENT_CREATED: 'CLIENT_CREATED',
  CLIENT_UPDATED: 'CLIENT_UPDATED',
  CLIENT_DEACTIVATED: 'CLIENT_DEACTIVATED',
  CLIENT_RETURN_CONFIRMED: 'CLIENT_RETURN_CONFIRMED',

  // ── Prescriptions ────────────────────────────────────────────
  PRESCRIPTION_REGISTERED: 'PRESCRIPTION_REGISTERED',

  // ── Auth (offline) ────────────────────────────────────────────
  OFFLINE_LOGIN: 'OFFLINE_LOGIN',
  OFFLINE_SESSION_BLESSED: 'OFFLINE_SESSION_BLESSED',
  OFFLINE_SESSION_REJECTED: 'OFFLINE_SESSION_REJECTED',

  // ── Sync ─────────────────────────────────────────────────────
  SYNC_PUSH_COMPLETED: 'SYNC_PUSH_COMPLETED',
  SYNC_PUSH_FAILED: 'SYNC_PUSH_FAILED',
  SYNC_PULL_COMPLETED: 'SYNC_PULL_COMPLETED',
  SYNC_CONFLICT: 'SYNC_CONFLICT',

  // ── Inventory adjustments ────────────────────────────────────
  INVENTORY_ADJUSTMENT_CREATED: 'INVENTORY_ADJUSTMENT_CREATED',
  INVENTORY_ADJUSTMENT_APPLIED: 'INVENTORY_ADJUSTMENT_APPLIED',
  INVENTORY_ADJUSTMENT_APPROVED: 'INVENTORY_ADJUSTMENT_APPROVED',
  INVENTORY_ADJUSTMENT_REJECTED: 'INVENTORY_ADJUSTMENT_REJECTED',

  // ── Purchase ─────────────────────────────────────────────────
  PURCHASE_ORDER_CREATED: 'PURCHASE_ORDER_CREATED',
  PURCHASE_RECEPTION_CONFIRMED: 'PURCHASE_RECEPTION_CONFIRMED',

  // ── Fiscal ────────────────────────────────────────────────────
  FISCAL_INVOICE_EMITTED: 'FISCAL_INVOICE_EMITTED',
  FISCAL_CONTINGENCY_ACTIVATED: 'FISCAL_CONTINGENCY_ACTIVATED',
  FISCAL_TRANSMISSION_FAILED: 'FISCAL_TRANSMISSION_FAILED',
} as const;

export type LocalAuditEventType =
  (typeof LocalAuditEvent)[keyof typeof LocalAuditEvent];

/** Category string stored in `LocalAuditLog.category`. */
export type LocalAuditCategory =
  | 'cash_shift'
  | 'sale'
  | 'client'
  | 'prescription'
  | 'auth'
  | 'sync'
  | 'inventory'
  | 'purchase'
  | 'fiscal';

// ---------------------------------------------------------------------------
// Write input
// ---------------------------------------------------------------------------

export interface LocalAuditWriteInput {
  /** High-level grouping for filtering (e.g. "cash_shift", "sale"). */
  category: LocalAuditCategory;
  /** Domain entity typename (e.g. "CashShift", "Sale"). */
  entityType?: string;
  /** ID of the affected entity. */
  entityId?: string;
  /** Human-readable name for display (e.g. client name, product name). */
  entityName?: string;
  /** Free-form JSON payload with event-specific data. */
  details?: Record<string, unknown>;
  /** Who performed the action. */
  userId?: string;
  /** Role of the user at the time of the action. */
  userRole?: string;
  /** Workstation where the event occurred. */
  workstationId?: string;
  /** Session ID for correlation. */
  sessionId?: string;
  /** Correlation ID linking local and server-side audit entries. */
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export class LocalAuditWriter {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Persist a local audit event.
   *
   * Fire-and-forget by design — never throws. A failed write is logged to the
   * console but never allowed to roll back the calling operation.
   */
  async write(
    action: LocalAuditEventType,
    input: LocalAuditWriteInput,
  ): Promise<void> {
    try {
      await this.prisma.localAuditLog.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          action,
          category: input.category,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          entityName: input.entityName ?? null,
          details: input.details ? JSON.stringify(input.details) : null,
          userId: input.userId ?? null,
          userRole: input.userRole ?? null,
          workstationId: input.workstationId ?? null,
          sessionId: input.sessionId ?? null,
          correlationId: input.correlationId ?? null,
          createdAt: new Date(),
        },
      });
    } catch (error) {
      console.error(
        `[LocalAuditWriter] Failed to write audit event ${action}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

export const createLocalAuditWriter = (
  prisma: PrismaClient,
): LocalAuditWriter => new LocalAuditWriter(prisma);
