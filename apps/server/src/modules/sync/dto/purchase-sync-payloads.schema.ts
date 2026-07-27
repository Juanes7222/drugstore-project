/**
 * Zod validation schemas for purchase-related sync payloads.
 *
 * These are runtime guards applied at the sync dispatcher boundary so a
 * malformed POS payload (missing required fields, undefined numbers,
 * non-ISO datetimes) surfaces a clear `SYNC_PAYLOAD_VALIDATION` error
 * rather than a raw `DecimalError: Invalid argument: undefined` or a
 * type-cast crash deeper in the service layer.
 *
 * Note on ID format: the pre-fix POS used slug-style IDs (e.g.
 * `user_admin`, `ws_principal`, `shift-1`) and the seeded database
 * follows that convention, so the ID fields are validated as non-empty
 * strings rather than UUIDs. Prisma's FK constraints reject invalid
 * references at write time, so this is sufficient as a boundary check.
 *
 * The interface types from `purchase-sync-payloads.ts` remain the
 * developer-facing shape; the schema is the runtime contract.
 */
import { z } from 'zod';

const idString = z.string().min(1);

const SupplierSyncDataSchema = z.object({
  businessName: z.string().min(1),
  identificationType: z.enum(['NIT', 'CC', 'CE', 'PASSPORT']),
  identificationNumber: z.string().min(1),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  paymentTermsDays: z.number().int().nonnegative().optional(),
  creditLimit: z.number().nonnegative().optional(),
});

const LotSyncDataSchema = z.object({
  batchNumber: z.string().min(1),
  expirationDate: z.string(),
  productId: idString,
  locationCode: z.string().optional(),
  currentStock: z.number().optional(),
});

// ---------------------------------------------------------------------------
// PurchaseOrderConfirmationPayload
// ---------------------------------------------------------------------------

const PurchaseOrderConfirmationItemSchema = z.object({
  productId: idString,
  requestedQuantity: z.number().int().positive(),
  expectedUnitCost: z.number().nonnegative(),
});

export const PurchaseOrderConfirmationPayloadSchema = z.object({
  orderId: idString,
  sequentialNumber: z.number().int().positive(),
  supplierId: idString,
  supplier: SupplierSyncDataSchema.optional(),
  notes: z.string().optional(),
  confirmedByUserId: idString,
  confirmedAt: z.string().datetime(),
  items: z.array(PurchaseOrderConfirmationItemSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// PurchaseReceptionConfirmationPayload
// ---------------------------------------------------------------------------

const PurchaseReceptionConfirmationItemSchema = z.object({
  productId: idString,
  lotId: idString.optional(),
  quantity: z.number().int().positive(),
  unitCost: z.number().nonnegative(),
  expirationDate: z.string().optional(),
  batchNumber: z.string().optional(),
  lot: LotSyncDataSchema.optional(),
});

export const PurchaseReceptionConfirmationPayloadSchema = z.object({
  receptionId: idString,
  sequentialNumber: z.number().int().positive(),
  supplierId: idString,
  supplier: SupplierSyncDataSchema.optional(),
  purchaseOrderId: idString.optional(),
  notes: z.string().optional(),
  confirmedByUserId: idString,
  createdById: idString,
  confirmedAt: z.string().datetime(),
  items: z.array(PurchaseReceptionConfirmationItemSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// SupplierReturnConfirmationPayload
// ---------------------------------------------------------------------------

const SupplierReturnConfirmationItemSchema = z.object({
  productId: idString,
  lotId: idString,
  quantity: z.number().int().positive(),
  unitCost: z.number().nonnegative(),
  reason: z.string().optional(),
  lot: LotSyncDataSchema.optional(),
});

export const SupplierReturnConfirmationPayloadSchema = z.object({
  returnId: idString,
  sequentialNumber: z.number().int().positive(),
  supplierId: idString,
  supplier: SupplierSyncDataSchema.optional(),
  purchaseReceptionId: idString.optional(),
  reason: z.string().optional(),
  createdByUserId: idString,
  confirmedAt: z.string().datetime(),
  items: z.array(SupplierReturnConfirmationItemSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
