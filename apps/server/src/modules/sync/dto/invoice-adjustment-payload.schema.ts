import { z } from 'zod';

/**
 * Zod schema for the INVOICE_ADJUSTMENT sync payload.
 *
 * Matches the shape sent by the POS desktop when a manager/admin adjusts
 * an invoice (PAYMENT_METHOD_CHANGE, CLIENT_CHANGE, INTERNAL_NOTE, etc.).
 *
 * The server stores these for cross-workstation visibility and backoffice
 * reporting. No DIAN/fiscal impact — operational annotations only.
 *
 * The schema is permissive on `previousValue`/`newValue` since the value
 * shape varies by adjustmentType (string, object, null, etc.).
 */
export const InvoiceAdjustmentPayloadSchema = z.object({
  /** POS-local UUID of the adjustment record. Used as the server-side id. */
  adjustmentId: z.string().uuid('adjustmentId must be a valid UUID'),

  /** POS-local UUID of the Invoice record this adjustment belongs to. */
  invoiceId: z.string().min(1, 'invoiceId is required'),

  /** Human-readable invoice number (e.g. "FAC-001"). */
  invoiceNumber: z.string().min(1, 'invoiceNumber is required'),

  /**
   * Type of adjustment performed on the POS.
   * Examples: PAYMENT_METHOD_CHANGE, CLIENT_CHANGE, INTERNAL_NOTE,
   * REVERSAL, PAYMENT_SPLIT_CHANGE, CONTACT_UPDATE, DELIVERY_INFO,
   * TAG_ADD, TAG_REMOVE, CUSTOM_FIELD_SET, CUSTOM_FIELD_CLEAR.
   */
  adjustmentType: z.string().min(1, 'adjustmentType is required'),

  /** The value before the adjustment (null for additions like TAG_ADD). */
  previousValue: z.unknown().nullable(),

  /** The value after the adjustment (null for REVERSAL and TAG_REMOVE). */
  newValue: z.unknown().nullable(),

  /** Required reason for the adjustment. */
  reason: z.string().min(1, 'reason is required'),

  /** Optimistic concurrency version within the invoice's adjustment chain. */
  version: z.number().int().positive('version must be a positive integer'),

  /** When adjustmentType = REVERSAL, references the original adjustment. */
  reversalOfAdjustmentId: z.string().nullable(),

  /** When this adjustment is later reversed, populated with the reversal id. */
  replacedByAdjustmentId: z.string().nullable(),

  /** POS-local UUID of the user who created the adjustment. */
  createdByUserId: z.string().min(1, 'createdByUserId is required'),

  /** Denormalized actor name for audit trail resilience. */
  createdByUserName: z.string().min(1, 'createdByUserName is required'),

  /** POS-local UUID of the workstation where the adjustment was made. */
  workstationId: z.string().min(1, 'workstationId is required'),

  /** ISO 8601 timestamp of when the adjustment was created on the POS. */
  createdAt: z.string().datetime('createdAt must be a valid ISO 8601 datetime'),
});

export type InvoiceAdjustmentPayload = z.infer<typeof InvoiceAdjustmentPayloadSchema>;
