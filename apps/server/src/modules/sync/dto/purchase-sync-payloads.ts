/**
 * Payload types for purchase-related sync operations from POS desktop.
 *
 * These mirror the shapes the POS emits after committing purchase
 * operations locally. The server re-validates every constraint and
 * creates the authoritative server-side records.
 *
 * Promotion candidate: move to @pharmacy/shared-types when POS needs
 * to import them directly.
 */

// ---------------------------------------------------------------------------
// PurchaseOrderConfirmationPayload
// ---------------------------------------------------------------------------

export interface PurchaseOrderConfirmationItem {
  productId: string;
  requestedQuantity: number;
  expectedUnitCost: number;
}

export interface PurchaseOrderConfirmationPayload {
  orderId: string;
  sequentialNumber: number;
  supplierId: string;
  notes?: string;
  confirmedByUserId: string;
  confirmedAt: string;
  items: PurchaseOrderConfirmationItem[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// PurchaseReceptionConfirmationPayload
// ---------------------------------------------------------------------------

export interface PurchaseReceptionConfirmationItem {
  productId: string;
  lotId?: string;
  quantity: number;
  unitCost: number;
  expirationDate?: string;
  batchNumber?: string;
}

export interface PurchaseReceptionConfirmationPayload {
  receptionId: string;
  sequentialNumber: number;
  supplierId: string;
  purchaseOrderId?: string;
  notes?: string;
  confirmedByUserId: string;
  createdById: string;
  confirmedAt: string;
  items: PurchaseReceptionConfirmationItem[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// SupplierReturnConfirmationPayload
// ---------------------------------------------------------------------------

export interface SupplierReturnConfirmationItem {
  productId: string;
  lotId: string;
  quantity: number;
  unitCost: number;
  reason?: string;
}

export interface SupplierReturnConfirmationPayload {
  returnId: string;
  sequentialNumber: number;
  supplierId: string;
  purchaseReceptionId?: string;
  reason?: string;
  createdByUserId: string;
  confirmedAt: string;
  items: SupplierReturnConfirmationItem[];
  metadata?: Record<string, unknown>;
}
