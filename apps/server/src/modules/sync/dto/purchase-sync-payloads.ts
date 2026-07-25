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
// Supplier creation data — carried inline when the referenced supplier does
// not yet exist on the server (offline-first POS scenario).
// ---------------------------------------------------------------------------

export interface SupplierSyncData {
  businessName: string;
  identificationType: 'NIT' | 'CC' | 'CE' | 'PASSPORT';
  identificationNumber: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  paymentTermsDays?: number;
  creditLimit?: number;
}

// ---------------------------------------------------------------------------
// Lot creation data — carried inline when the referenced lot does not yet
// exist on the server (synced before the reception that created it).
// ---------------------------------------------------------------------------

export interface LotSyncData {
  batchNumber: string;
  expirationDate: string;
  productId: string;
  locationCode?: string;
  currentStock?: number;
}

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
  /** Optional supplier data to create the supplier if it does not exist yet. */
  supplier?: SupplierSyncData;
  notes?: string;
  confirmedByUserId: string;
  confirmedAt: string;
  /**
   * Purchase order items.
   * May be missing on legacy sync payloads queued before the POS started
   * embedding items. The handler falls back gracefully: creates the PO
   * header without items and appends a note referencing the missing data.
   * Newer payloads always include this field.
   */
  items?: PurchaseOrderConfirmationItem[];
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
  /** Optional lot data to create the Lot record if it does not exist yet. */
  lot?: LotSyncData;
}

export interface PurchaseReceptionConfirmationPayload {
  receptionId: string;
  sequentialNumber: number;
  supplierId: string;
  /** Optional supplier data to create the supplier if it does not exist yet. */
  supplier?: SupplierSyncData;
  purchaseOrderId?: string;
  notes?: string;
  confirmedByUserId: string;
  createdById: string;
  confirmedAt: string;
  /**
   * Reception items.
   * May be missing on legacy sync payloads. When absent the handler creates
   * the reception header with a descriptive note.
   */
  items?: PurchaseReceptionConfirmationItem[];
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
  /** Optional lot data to create the Lot record if it does not exist yet. */
  lot?: LotSyncData;
}

export interface SupplierReturnConfirmationPayload {
  returnId: string;
  sequentialNumber: number;
  supplierId: string;
  /** Optional supplier data to create the supplier if it does not exist yet. */
  supplier?: SupplierSyncData;
  purchaseReceptionId?: string;
  reason?: string;
  createdByUserId: string;
  confirmedAt: string;
  /**
   * Return items.
   * May be missing on legacy payloads; when absent the handler creates
   * the return header with a descriptive note.
   */
  items?: SupplierReturnConfirmationItem[];
  metadata?: Record<string, unknown>;
}
