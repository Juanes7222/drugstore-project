/**
 * Types for the local invoice adjustment layer.
 *
 * These types define the operational annotation layer that sits alongside the
 * immutable fiscal Invoice record. Local adjustments never sync to the server
 * and never affect what DIAN sees.
 */

import type { InvoicePayment, InvoiceFullData, InvoiceStatus, InvoiceType } from './fiscal-types';

// ---------------------------------------------------------------------------
// Adjustment types (matching the Prisma enum InvoiceAdjustmentType)
// ---------------------------------------------------------------------------

export type AdjustmentType =
  | 'PAYMENT_METHOD_CHANGE'
  | 'PAYMENT_SPLIT_CHANGE'
  | 'INTERNAL_NOTE'
  | 'CONTACT_UPDATE'
  | 'DELIVERY_INFO'
  | 'TAG_ADD'
  | 'TAG_REMOVE'
  | 'CUSTOM_FIELD_SET'
  | 'CUSTOM_FIELD_CLEAR'
  | 'REVERSAL';

// ---------------------------------------------------------------------------
// Adjustment record (as stored and retrieved from the database)
// ---------------------------------------------------------------------------

export interface AdjustmentRecord {
  id: string;
  invoiceId: string;
  createdAt: string; // ISO string
  createdByUserId: string;
  createdByUserName: string;
  adjustmentType: AdjustmentType;
  previousValue: unknown | null;
  newValue: unknown | null;
  reason: string;
  version: number;
  reversalOfAdjustmentId: string | null;
  replacedByAdjustmentId: string | null;
}

// ---------------------------------------------------------------------------
// Adjustment history entry (enriched for display)
// ---------------------------------------------------------------------------

export interface AdjustmentHistoryEntry {
  id: string;
  createdAt: string;
  actorName: string;
  actorId: string;
  adjustmentType: AdjustmentType;
  previousValue: unknown | null;
  newValue: unknown | null;
  reason: string;
  /** Whether this adjustment has been reversed */
  isReversed: boolean;
  /** If this entry is itself a reversal, the id of the original adjustment */
  reversalOfAdjustmentId: string | null;
  /** If this entry has been reversed, the id of the reversal */
  replacedByAdjustmentId: string | null;
}

// ---------------------------------------------------------------------------
// Operational invoice view — the projected result of the adjustment chain
// ---------------------------------------------------------------------------

export interface OperationalInvoiceView {
  /** The immutable fiscal invoice data, passed through unmodified */
  fiscal: {
    id: string;
    invoiceNumber: string;
    invoiceType: InvoiceType;
    status: InvoiceStatus;
    cufeProvisional: string;
    cufeOfficial: string | null;
    issuedAt: string;
    fullData: InvoiceFullData;
  };

  /** The operational projection after applying all non-reversed adjustments */
  operational: {
    payments: InvoicePayment[];
    notes: OperationalNote[];
    contactInfo: OperationalContactInfo;
    tags: string[];
    customFields: Record<string, string>;
    deliveryInfo: OperationalDeliveryInfo | null;
    /** True when the operational view differs from the fiscal view */
    hasDifferences: boolean;
  };
}

export interface OperationalNote {
  id: string;
  text: string;
  authorName: string;
  createdAt: string;
}

export interface OperationalContactInfo {
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface OperationalDeliveryInfo {
  notes: string | null;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  scheduledDate: string | null;
}

// ---------------------------------------------------------------------------
// Adjustment summary for observability
// ---------------------------------------------------------------------------

export interface LocalAdjustmentSummary {
  adjustmentsLast24h: number;
  byType: Record<string, number>;
  reversalsLast24h: number;
  invoicesWithAdjustments: number;
}

// ---------------------------------------------------------------------------
// Report view parameter
// ---------------------------------------------------------------------------

export type ReportView = 'fiscal' | 'operational';

// ---------------------------------------------------------------------------
// CSV export row
// ---------------------------------------------------------------------------

export interface AdjustmentCsvRow {
  createdAt: string;
  actor: string;
  adjustmentType: string;
  previousValue: string;
  newValue: string;
  reason: string;
  reversedBy: string;
  reversalOf: string;
}
