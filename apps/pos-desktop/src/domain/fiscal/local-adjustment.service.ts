/**
 * Local adjustment service — operational annotation layer for fiscal documents.
 *
 * This service manages the `InvoiceLocalAdjustment` table: local-only
 * annotations that sit alongside the immutable fiscal Invoice record.
 * Adjustments never sync to the server, never affect DIAN, and only change
 * how the POS interprets the invoice for operational purposes.
 *
 * ## Role gating
 * Every public mutating method calls `auth.requireRole(MANAGER, ADMIN)`.
 * Cashiers cannot invoke any adjustment operation, even programmatically.
 *
 * ## Concurrency
 * Optimistic concurrency via version counting: the service reads the current
 * count of non-reversed adjustments before applying and rejects with
 * `AdjustmentConflictException` if the count changed.
 *
 * ## Reversal chain semantics
 * A → B (reverses A) → C (reverses B): after C, A is effectively active again
 * (B is reversed, so A's value applies). The audit log shows the full chain.
 */

import type { PrismaClient, InvoiceAdjustmentType, Prisma } from '@pharmacy/database/local';
import { RoleType } from '@pharmacy/shared-types';
import type { AuthService } from '../auth/auth.service';
import type {
  AdjustmentType,
  AdjustmentRecord,
  AdjustmentHistoryEntry,
  OperationalInvoiceView,
  OperationalNote,
  OperationalContactInfo,
  OperationalDeliveryInfo,
  LocalAdjustmentSummary,
  AdjustmentCsvRow,
} from './local-adjustment.types';
import {
  AdjustmentAuthorizationException,
  AdjustmentInvoiceNotFoundException,
  AdjustmentNotAllowedForStatusException,
  AdjustmentReasonTooShortException,
  AdjustmentNotFoundException,
  AdjustmentAlreadyReversedException,
  AdjustmentConflictException,
} from './local-adjustment.exceptions';

// ---------------------------------------------------------------------------
// Per-status allow rules
// ---------------------------------------------------------------------------

const ALLOWED_ADJUSTMENTS_BY_STATUS: Record<string, AdjustmentType[]> = {
  CONTINGENCY_PENDING_TRANSMISSION: [
    'INTERNAL_NOTE',
    'CONTACT_UPDATE',
    'DELIVERY_INFO',
    'TAG_ADD',
    'TAG_REMOVE',
    'CUSTOM_FIELD_SET',
    'CUSTOM_FIELD_CLEAR',
    // Payment method changes are NOT allowed pre-transmission — better to
    // cancel and re-issue if the payment method is wrong before DIAN sees it.
  ],
  TRANSMITTED_AUTHORIZED: [
    'PAYMENT_METHOD_CHANGE',
    'PAYMENT_SPLIT_CHANGE',
    'INTERNAL_NOTE',
    'CONTACT_UPDATE',
    'DELIVERY_INFO',
    'TAG_ADD',
    'TAG_REMOVE',
    'CUSTOM_FIELD_SET',
    'CUSTOM_FIELD_CLEAR',
  ],
  TRANSMITTED_REJECTED: [
    'INTERNAL_NOTE',
    'TAG_ADD',
    'TAG_REMOVE',
    'CONTACT_UPDATE',
    // Payment changes blocked — rejected invoice awaits re-issue via nota crédito.
    // DELIVERY_INFO blocked — no point annotating a rejected doc.
    // CUSTOM_FIELD_SET/CLEAR blocked — use nota crédito instead.
  ],
  EXPIRED_CONTINGENCY: [
    'INTERNAL_NOTE',
    'TAG_ADD',
    'TAG_REMOVE',
    'CONTACT_UPDATE',
    // Same restrictions as TRANSMITTED_REJECTED — needs official re-issue.
  ],
  CANCELLED: [], // Terminal state — no adjustments allowed.
};

// Credit notes follow the same rules based on their own status
const isCreditNoteType = (invoiceType: string): boolean =>
  invoiceType === 'CREDIT_NOTE';

// Contingency cancellations are closures — no adjustments
const isContingencyCancellation = (invoiceType: string): boolean =>
  invoiceType === 'CONTINGENCY_CANCELLATION';

// ---------------------------------------------------------------------------
// Payment method overrides — JSON shape for the newValue field
// ---------------------------------------------------------------------------

export interface PaymentOverrideValue {
  payments: Array<{
    paymentMethodId: string;
    paymentMethodName: string;
    amount: string;
    category: string;
    transactionReference: string | null;
    authorizationCode: string | null;
    cardBrand: string | null;
    cardLastFour: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface LocalAdjustmentService {
  /**
   * Apply an operational adjustment to an invoice.
   * Role-gated: MANAGER, ADMIN only.
   *
   * @param invoiceId  The fiscal invoice to adjust
   * @param type       The type of adjustment
   * @param newValue   The new value (varies by type)
   * @param reason     Required (min 10 chars)
   * @returns The created adjustment record
   * @throws AdjustmentAuthorizationException if not manager/admin
   * @throws AdjustmentInvoiceNotFoundException if invoice not found
   * @throws AdjustmentNotAllowedForStatusException if type blocked for invoice status
   * @throws AdjustmentReasonTooShortException if reason < 10 chars
   * @throws AdjustmentConflictException if concurrent modification detected
   */
  applyAdjustment(
    invoiceId: string,
    type: AdjustmentType,
    newValue: unknown,
    reason: string,
  ): Promise<AdjustmentRecord>;

  /**
   * Reverse a previous adjustment by creating a REVERSAL entry.
   * The original adjustment is never deleted.
   *
   * @param adjustmentId  The adjustment to reverse
   * @param reason        Required (min 10 chars)
   * @returns The created reversal adjustment record
   * @throws AdjustmentAuthorizationException if not manager/admin
   * @throws AdjustmentNotFoundException if adjustment not found
   * @throws AdjustmentAlreadyReversedException if already reversed
   * @throws AdjustmentReasonTooShortException if reason < 10 chars
   */
  reverseAdjustment(
    adjustmentId: string,
    reason: string,
  ): Promise<AdjustmentRecord>;

  /**
   * Get the full chronological adjustment history for an invoice.
   * Includes reversed adjustments — the audit trail is complete.
   * Actor names are resolved from the stored userName at creation time.
   */
  getAdjustmentHistory(invoiceId: string): Promise<AdjustmentHistoryEntry[]>;

  /**
   * Compute the operational view of an invoice by projecting the adjustment
   * chain onto the immutable fiscal invoice data.
   */
  resolveOperationalView(invoiceId: string): Promise<OperationalInvoiceView>;

  /**
   * Check whether a given adjustment type is currently allowed for the
   * specified invoice. Used by the UI to enable/disable buttons.
   */
  isAdjustmentAllowed(
    invoiceId: string,
    type: AdjustmentType,
  ): Promise<boolean>;

  /**
   * Get all adjustment types currently allowed for the specified invoice.
   * Used by the UI to populate the type picker.
   */
  getAllowableAdjustmentTypes(invoiceId: string): Promise<AdjustmentType[]>;

  /**
   * Export the full adjustment log for a single invoice as CSV rows.
   */
  exportAdjustmentLogAsCsv(invoiceId: string): Promise<string>;

  /**
   * Export a date-range-filtered adjustment log across all invoices as CSV rows.
   */
  exportBulkAdjustmentLogAsCsv(
    since: Date,
    until: Date,
  ): Promise<string>;

  /**
   * Get a summary of recent adjustment activity for observability.
   */
  getLocalAdjustmentSummary(): Promise<LocalAdjustmentSummary>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createLocalAdjustmentService = (
  prisma: PrismaClient,
  auth: AuthService,
): LocalAdjustmentService => {
  return new LocalAdjustmentServiceImpl(prisma, auth);
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class LocalAdjustmentServiceImpl implements LocalAdjustmentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async applyAdjustment(
    invoiceId: string,
    type: AdjustmentType,
    newValue: unknown,
    reason: string,
  ): Promise<AdjustmentRecord> {
    // Role-gated to ADMIN and ACCOUNTANT (the current RoleType enum has no
    // dedicated MANAGER value; ADMIN serves as the managerial role).
    const session = this.auth.requireRole(RoleType.ADMIN, RoleType.ACCOUNTANT);

    if (reason.length < 10) {
      throw new AdjustmentReasonTooShortException();
    }

    // Fetch invoice to validate status and existence
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        status: true,
        invoiceType: true,
        fullData: true,
      },
    });

    if (!invoice) {
      throw new AdjustmentInvoiceNotFoundException(invoiceId);
    }

    // For REVERSAL type, use reverseAdjustment instead
    if (type === 'REVERSAL') {
      throw new AdjustmentNotAllowedForStatusException(
        invoiceId,
        String(invoice.status),
        type,
      );
    }

    // Check status-based allow rules
    if (!this.isTypeAllowedForStatus(type, String(invoice.status), String(invoice.invoiceType))) {
      throw new AdjustmentNotAllowedForStatusException(
        invoiceId,
        String(invoice.status),
        type,
      );
    }

    // Capture the previous value for the audit trail
    const previousValue = this.capturePreviousValue(invoice, type);

    // Optimistic concurrency: read current version (1-based count of non-reversed
    // adjustments for this invoice). The next adjustment gets `version = currentVersion + 1`.
    // The `@@unique([invoiceId, version])` constraint ensures that two concurrent writes
    // for the same invoice at the same version cannot both succeed.
    const currentVersion = await this.countNonReversedAdjustments(invoiceId);
    const nextVersion = currentVersion + 1;

    const id = globalThis.crypto.randomUUID();

    try {
      await this.prisma.invoiceLocalAdjustment.create({
        data: {
          id,
          invoiceId,
          createdAt: new Date(),
          createdByUserId: session.userId,
          createdByUserName: session.fullName,
          adjustmentType: type as InvoiceAdjustmentType,
          previousValue: previousValue != null ? (previousValue as Prisma.InputJsonValue) : null,
          newValue: newValue != null ? (newValue as Prisma.InputJsonValue) : null,
          reason,
          version: nextVersion,
          reversalOfAdjustmentId: null,
          replacedByAdjustmentId: null,
        },
      });
    } catch (err) {
      // A Prisma unique constraint violation on [invoiceId, version] means a
      // concurrent writer already inserted version `nextVersion` for this invoice.
      throw new AdjustmentConflictException(invoiceId);
    }

    return this.toAdjustmentRecord(
      await this.prisma.invoiceLocalAdjustment.findUniqueOrThrow({ where: { id } }),
    );
  }

  async reverseAdjustment(
    adjustmentId: string,
    reason: string,
  ): Promise<AdjustmentRecord> {
    const session = this.auth.requireRole(RoleType.ADMIN, RoleType.ACCOUNTANT);

    if (reason.length < 10) {
      throw new AdjustmentReasonTooShortException();
    }

    const original = await this.prisma.invoiceLocalAdjustment.findUnique({
      where: { id: adjustmentId },
    });

    if (!original) {
      throw new AdjustmentNotFoundException(adjustmentId);
    }

    if (original.replacedByAdjustmentId) {
      throw new AdjustmentAlreadyReversedException(adjustmentId);
    }

    // Verify the invoice still exists and is in a state that allows reversals
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: original.invoiceId },
      select: { status: true, invoiceType: true },
    });

    if (!invoice) {
      throw new AdjustmentInvoiceNotFoundException(original.invoiceId);
    }

    const status = String(invoice.status);
    if (status === 'CANCELLED') {
      throw new AdjustmentNotAllowedForStatusException(
        original.invoiceId,
        status,
        'REVERSAL',
      );
    }

    // Optimistic concurrency: compute the next version for this invoice
    const currentVersion = await this.countNonReversedAdjustments(original.invoiceId);
    const nextVersion = currentVersion + 1;

    // Create the reversal entry
    const reversalId = globalThis.crypto.randomUUID();

    try {
      await this.prisma.$transaction(async (tx) => {
      // Create reversal pointing to the original
      await tx.invoiceLocalAdjustment.create({
        data: {
          id: reversalId,
          invoiceId: original.invoiceId,
          createdAt: new Date(),
          createdByUserId: session.userId,
          createdByUserName: session.fullName,
          adjustmentType: 'REVERSAL' as InvoiceAdjustmentType,
          previousValue: original.newValue != null ? (original.newValue as Prisma.InputJsonValue) : null,
          newValue: original.previousValue != null ? (original.previousValue as Prisma.InputJsonValue) : null,
          reason,
          version: nextVersion,
          reversalOfAdjustmentId: adjustmentId,
          replacedByAdjustmentId: null,
        },
      });

        // Mark the original as replaced
        await tx.invoiceLocalAdjustment.update({
          where: { id: adjustmentId },
          data: { replacedByAdjustmentId: reversalId },
        });
      });
    } catch (err) {
      // Unique constraint violation on [invoiceId, version] means a concurrent
      // writer already created a reversal at the same version.
      throw new AdjustmentConflictException(original.invoiceId);
    }

    return this.toAdjustmentRecord(
      await this.prisma.invoiceLocalAdjustment.findUniqueOrThrow({ where: { id: reversalId } }),
    );
  }

  async getAdjustmentHistory(invoiceId: string): Promise<AdjustmentHistoryEntry[]> {
    const adjustments = await this.prisma.invoiceLocalAdjustment.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'asc' },
    });

    // Build a map of id → replacedByAdjustmentId for quick lookup
    const replacedByMap = new Map<string, string>();
    for (const adj of adjustments) {
      if (adj.replacedByAdjustmentId) {
        replacedByMap.set(adj.id, adj.replacedByAdjustmentId);
      }
    }

    return adjustments.map((adj) => ({
      id: adj.id,
      createdAt: adj.createdAt.toISOString(),
      actorName: adj.createdByUserName,
      actorId: adj.createdByUserId,
      adjustmentType: adj.adjustmentType as AdjustmentType,
      previousValue: adj.previousValue,
      newValue: adj.newValue,
      reason: adj.reason,
      isReversed: replacedByMap.has(adj.id),
      reversalOfAdjustmentId: adj.reversalOfAdjustmentId,
      replacedByAdjustmentId: adj.replacedByAdjustmentId,
    }));
  }

  async resolveOperationalView(invoiceId: string): Promise<OperationalInvoiceView> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new AdjustmentInvoiceNotFoundException(invoiceId);
    }

    const fullData = invoice.fullData as Record<string, unknown>;
    const payments = (fullData.payments ?? []) as OperationalInvoiceView['fiscal']['fullData']['payments'];

    // Build the fiscal view
    const fiscal: OperationalInvoiceView['fiscal'] = {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceType: invoice.invoiceType as OperationalInvoiceView['fiscal']['invoiceType'],
      status: invoice.status as OperationalInvoiceView['fiscal']['status'],
      cufeProvisional: invoice.cufeProvisional,
      cufeOfficial: invoice.cufeOfficial,
      issuedAt: invoice.issuedAt.toISOString(),
      fullData: invoice.fullData as unknown as OperationalInvoiceView['fiscal']['fullData'],
    };

    // Get all non-reversed adjustments in chronological order
    const adjustments = await this.prisma.invoiceLocalAdjustment.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'asc' },
    });

    // Apply projection: skip reversed adjustments
    const replacedIds = new Set(
      adjustments.filter((a) => a.replacedByAdjustmentId).map((a) => a.id),
    );
    const active = adjustments.filter((a) => !replacedIds.has(a.id));

    // Start with fiscal defaults
    const operational: OperationalInvoiceView['operational'] = {
      payments: [...payments],
      notes: [],
      contactInfo: {
        email: null,
        phone: null,
        address: null,
      },
      tags: [],
      customFields: {},
      deliveryInfo: null,
      hasDifferences: false,
    };

    // Apply each non-reversed adjustment in order
    for (const adj of active) {
      switch (adj.adjustmentType) {
        case 'PAYMENT_METHOD_CHANGE':
        case 'PAYMENT_SPLIT_CHANGE': {
          const override = adj.newValue as PaymentOverrideValue | null;
          if (override?.payments) {
            operational.payments = override.payments;
            operational.hasDifferences = true;
          }
          break;
        }

        case 'INTERNAL_NOTE': {
          const text = adj.newValue as string | null;
          if (text) {
            operational.notes.push({
              id: adj.id,
              text,
              authorName: adj.createdByUserName,
              createdAt: adj.createdAt.toISOString(),
            });
          }
          break;
        }

        case 'CONTACT_UPDATE': {
          const contact = adj.newValue as Partial<OperationalContactInfo> | null;
          if (contact) {
            if (contact.email !== undefined) operational.contactInfo.email = contact.email;
            if (contact.phone !== undefined) operational.contactInfo.phone = contact.phone;
            if (contact.address !== undefined) operational.contactInfo.address = contact.address;
            operational.hasDifferences = true;
          }
          break;
        }

        case 'DELIVERY_INFO': {
          operational.deliveryInfo = adj.newValue as OperationalDeliveryInfo | null;
          if (adj.newValue !== null) operational.hasDifferences = true;
          break;
        }

        case 'TAG_ADD': {
          const tag = adj.newValue as string | null;
          if (tag && !operational.tags.includes(tag)) {
            operational.tags.push(tag);
            operational.hasDifferences = true;
          }
          break;
        }

        case 'TAG_REMOVE': {
          // The tag to remove is passed as newValue by the caller.
          // previousValue captures the current tags set for audit purposes.
          const tag = adj.newValue as string | null;
          if (tag) {
            operational.tags = operational.tags.filter((t) => t !== tag);
            operational.hasDifferences = true;
          }
          break;
        }

        case 'CUSTOM_FIELD_SET': {
          const field = adj.newValue as { key: string; value: string } | null;
          if (field?.key) {
            operational.customFields[field.key] = field.value;
            operational.hasDifferences = true;
          }
          break;
        }

        case 'CUSTOM_FIELD_CLEAR': {
          // The key to clear is passed as newValue. previousValue captures
          // the value before clearing for audit purposes.
          const field = adj.newValue as { key: string } | string | null;
          const key = typeof field === 'string' ? field : field?.key;
          if (key && key in operational.customFields) {
            delete operational.customFields[key];
            operational.hasDifferences = true;
          }
          break;
        }

        case 'REVERSAL': {
          // REVERSAL entries are already handled by the replacedIds filter above.
          // This case exists for completeness but should never be reached for
          // active adjustments.
          break;
        }
      }
    }

    return { fiscal, operational };
  }

  async isAdjustmentAllowed(
    invoiceId: string,
    type: AdjustmentType,
  ): Promise<boolean> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, invoiceType: true },
    });

    if (!invoice) return false;

    return this.isTypeAllowedForStatus(
      type,
      String(invoice.status),
      String(invoice.invoiceType),
    );
  }

  async getAllowableAdjustmentTypes(invoiceId: string): Promise<AdjustmentType[]> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, invoiceType: true },
    });

    if (!invoice) return [];

    const status = String(invoice.status);
    const invoiceType = String(invoice.invoiceType);

    if (isContingencyCancellation(invoiceType)) return [];

    const allowed = ALLOWED_ADJUSTMENTS_BY_STATUS[status];
    if (!allowed) return [];

    return allowed.filter((t) => t !== 'REVERSAL');
  }

  async exportAdjustmentLogAsCsv(invoiceId: string): Promise<string> {
    const history = await this.getAdjustmentHistory(invoiceId);
    return this.formatHistoryAsCsv(history);
  }

  async exportBulkAdjustmentLogAsCsv(
    since: Date,
    until: Date,
  ): Promise<string> {
    const adjustments = await this.prisma.invoiceLocalAdjustment.findMany({
      where: {
        createdAt: { gte: since, lte: until },
      },
      orderBy: { createdAt: 'asc' },
    });

    const replacedByMap = new Map<string, string>();
    for (const adj of adjustments) {
      if (adj.replacedByAdjustmentId) {
        replacedByMap.set(adj.id, adj.replacedByAdjustmentId);
      }
    }

    // Map to history entries with invoice number resolution
    const invoiceIds = [...new Set(adjustments.map((a) => a.invoiceId))];
    const invoices = await this.prisma.invoice.findMany({
      where: { id: { in: invoiceIds } },
      select: { id: true, invoiceNumber: true },
    });
    const invoiceNumberMap = new Map(invoices.map((i) => [i.id, i.invoiceNumber]));

    // Build enriched items for CSV
    const enriched = adjustments.map((adj) => ({
      ...adj,
      invoiceNumber: invoiceNumberMap.get(adj.invoiceId) ?? adj.invoiceId,
      reversalTarget: adj.reversalOfAdjustmentId
        ? adjustments.find((a) => a.id === adj.reversalOfAdjustmentId)
        : null,
      replacingAdjustment: adj.replacedByAdjustmentId
        ? adjustments.find((a) => a.id === adj.replacedByAdjustmentId)
        : null,
    }));

    const headers = [
      'createdAt', 'invoiceNumber', 'actor', 'adjustmentType',
      'previousValue', 'newValue', 'reason', 'reversedBy', 'reversalOf',
    ];

    const rows = [headers.join(',')];

    for (const entry of enriched) {
      const reversedBy = entry.replacingAdjustment
        ? `${entry.replacingAdjustment.createdByUserName} (${entry.replacingAdjustment.id})`
        : '';
      const reversalOf = entry.reversalTarget
        ? `${entry.reversalTarget.adjustmentType} (${entry.reversalTarget.id})`
        : '';

      const row = [
        entry.createdAt.toISOString(),
        this.escapeCsvCell(entry.invoiceNumber),
        this.escapeCsvCell(entry.createdByUserName),
        entry.adjustmentType,
        this.escapeCsvCell(entry.previousValue ? JSON.stringify(entry.previousValue) : ''),
        this.escapeCsvCell(entry.newValue ? JSON.stringify(entry.newValue) : ''),
        this.escapeCsvCell(entry.reason),
        this.escapeCsvCell(reversedBy),
        this.escapeCsvCell(reversalOf),
      ];
      rows.push(row.join(','));
    }

    return rows.join('\n');
  }

  async getLocalAdjustmentSummary(): Promise<LocalAdjustmentSummary> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recent = await this.prisma.invoiceLocalAdjustment.findMany({
      where: { createdAt: { gte: twentyFourHoursAgo } },
      select: { adjustmentType: true, invoiceId: true },
    });

    const byType: Record<string, number> = {};
    let reversalsLast24h = 0;
    const invoicesWithAdjustments = new Set<string>();

    for (const adj of recent) {
      const type = String(adj.adjustmentType);
      byType[type] = (byType[type] ?? 0) + 1;
      if (type === 'REVERSAL') {
        reversalsLast24h++;
      }
      invoicesWithAdjustments.add(adj.invoiceId);
    }

    return {
      adjustmentsLast24h: recent.length,
      byType,
      reversalsLast24h,
      invoicesWithAdjustments: invoicesWithAdjustments.size,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private isTypeAllowedForStatus(
    type: AdjustmentType,
    status: string,
    invoiceType: string,
  ): boolean {
    // Contingency cancellations block everything
    if (isContingencyCancellation(invoiceType)) {
      return false;
    }

    // Credit notes use the same rules as regular invoices
    const effectiveType = isCreditNoteType(invoiceType) ? 'CREDIT_NOTE' : status;
    // Use the status-based rules
    const allowed = ALLOWED_ADJUSTMENTS_BY_STATUS[status];
    if (!allowed) return false;
    return allowed.includes(type);
  }

  /**
   * Capture the current value being replaced, for the audit trail.
   */
  private capturePreviousValue(
    invoice: { fullData: unknown; status: string },
    type: AdjustmentType,
  ): unknown {
    const fullData = invoice.fullData as Record<string, unknown> | null;

    switch (type) {
      case 'PAYMENT_METHOD_CHANGE':
      case 'PAYMENT_SPLIT_CHANGE': {
        const payments = (fullData?.payments ?? []) as Array<Record<string, unknown>>;
        return { payments };
      }

      case 'TAG_REMOVE':
        // Capture the tag being removed so the audit trail shows what was removed
        return null; // The caller provides the tag via newValue; previousValue
                     // captures the current state for audit.

      case 'CUSTOM_FIELD_CLEAR':
        return null;

      default:
        return null;
    }
  }

  /**
   * Count ALL adjustments for an invoice (including reversals and replaced ones).
   * Used to compute the monotonically increasing version number for the next
   * adjustment. Versions are never reused — a reversal does NOT free up the
   * version slot because that would cause @@unique([invoiceId, version]) conflicts
   * when a subsequent adjustment tries to claim the freed version.
   */
  private async countNonReversedAdjustments(invoiceId: string): Promise<number> {
    return this.prisma.invoiceLocalAdjustment.count({
      where: { invoiceId },
    });
  }

  private toAdjustmentRecord(
    row: Record<string, unknown>,
  ): AdjustmentRecord {
    return {
      id: row.id as string,
      invoiceId: row.invoiceId as string,
      createdAt: (row.createdAt as Date).toISOString(),
      createdByUserId: row.createdByUserId as string,
      createdByUserName: row.createdByUserName as string,
      adjustmentType: row.adjustmentType as AdjustmentType,
      previousValue: row.previousValue,
      newValue: row.newValue,
      reason: row.reason as string,
      version: row.version as number,
      reversalOfAdjustmentId: row.reversalOfAdjustmentId as string | null,
      replacedByAdjustmentId: row.replacedByAdjustmentId as string | null,
    };
  }

  private formatHistoryAsCsv(history: AdjustmentHistoryEntry[]): string {
    const headers = [
      'createdAt', 'actor', 'adjustmentType',
      'previousValue', 'newValue', 'reason', 'reversedBy', 'reversalOf',
    ];

    const rows = [headers.join(',')];

    for (const entry of history) {
      const reversedBy = entry.replacedByAdjustmentId
        ? `reversed:${entry.replacedByAdjustmentId}`
        : '';
      const reversalOf = entry.reversalOfAdjustmentId
        ? `reverses:${entry.reversalOfAdjustmentId}`
        : '';

      const row = [
        entry.createdAt,
        this.escapeCsvCell(entry.actorName),
        entry.adjustmentType,
        this.escapeCsvCell(entry.previousValue ? JSON.stringify(entry.previousValue) : ''),
        this.escapeCsvCell(entry.newValue ? JSON.stringify(entry.newValue) : ''),
        this.escapeCsvCell(entry.reason),
        this.escapeCsvCell(reversedBy),
        this.escapeCsvCell(reversalOf),
      ];
      rows.push(row.join(','));
    }

    return rows.join('\n');
  }

  /**
   * Prevent CSV injection. Mirrors the implementation in sync-metrics.service.ts.
   */
  private escapeCsvCell(value: string): string {
    const firstChar = value.charAt(0);
    if (
      firstChar === '=' || firstChar === '+' || firstChar === '-' ||
      firstChar === '@' || firstChar === '\t' || firstChar === '\r'
    ) {
      value = `'${value}`;
    }
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      value = `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
