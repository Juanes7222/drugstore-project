/**
 * Sync payload type definitions for the POS desktop app.
 *
 * Each interface maps to a SyncOperationType value and defines the
 * structured payload that the POS serialises into `SyncQueue.payload`
 * for server-side replay.
 */

// ---------------------------------------------------------------------------
// Existing operation types (documented here for reference)
// ---------------------------------------------------------------------------

/** @see sales-pos.service.ts createSyncQueueEntry */
export interface SaleConfirmationPayload {
  userId: string;
  createSaleDto: {
    saleType: string;
    cashShiftId: string;
    clientId: string | null;
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: string;
      discount: string;
      discountReason: string | null;
    }>;
    prescriptionNumber: string | null;
  };
  confirmSaleDto: {
    payments: Array<{
      paymentMethodId: string;
      amount: number;
      transactionReference: string | null;
      authorizationCode: string | null;
      cardBrand: string | null;
      cardLastFour: string | null;
      batchNumber: string | null;
      processorResponseCode: string | null;
    }>;
  };
  metadata: {
    localSaleId: string;
    localNumber: number;
    workstationId: string;
    sourceWorkstationId: string;
    startedAt: string;
    confirmedAt: string;
  };
}

// ---------------------------------------------------------------------------
// New operation types
// ---------------------------------------------------------------------------

/**
 * Payload for CLIENT_RETURN operations.
 *
 * Created by ReturnsService.confirm() and dispatched server-side to
 * generate the corresponding credit note.
 */
export interface ClientReturnPayload {
  returnId: string;
  sequentialNumber: number;
  saleId: string;
  clientId: string;
  refundAmount: string;
  subtotalReturned: string;
  taxReturned: string;
  refundMethodId: string;
  reason: string | null;
  notes: string | null;
  createdById: string;
  cashShiftId: string;
  workstationId: string;
  items: Array<{
    saleItemId: string;
    quantity: number;
    unitPriceAtSale: string;
    unitPriceAtReturn: string;
    taxAmount: string;
    totalAmount: string;
    lots: Array<{
      lotId: string;
      quantity: number;
    }>;
  }>;
  metadata: {
    localReturnId: string;
    workstationId: string;
    confirmedAt: string;
  };
}

/**
 * Payload for INVENTORY_ADJUSTMENT operations.
 *
 * Created by InventoryAdjustmentsService.apply() and dispatched server-side
 * for re-validation and processing through the approval chain.
 *
 * The payload is structured to match the server's CreateInventoryAdjustmentDto
 * inside a `createAdjustmentDto` key, following the same pattern as
 * SALE_CONFIRMATION's `createSaleDto`/`confirmSaleDto`.  The server handler
 * reads `payload.createAdjustmentDto` + `payload.userId` directly.
 */
export interface InventoryAdjustmentPayload {
  userId: string;
  createAdjustmentDto: {
    reason: string | null;
    notes: string | null;
    items: Array<{
      lotId: string;
      movementType: 'POSITIVE_ADJUSTMENT' | 'NEGATIVE_ADJUSTMENT';
      quantity: number;
      reason?: string;
    }>;
  };
  metadata: {
    adjustmentId: string;
    sequentialNumber: number;
    workstationId: string;
    appliedAt: string;
  };
}

/**
 * Payload for PRESCRIPTION_REGISTRATION operations.
 *
 * Created by PrescriptionsService.create() and dispatched server-side
 * for fiscal compliance re-validation.
 */
export interface PrescriptionRegistrationPayload {
  prescriptionId: string;
  saleItemId: string;
  prescriptionNumber: string | null;
  prescriberIdNumber: string | null;
  prescriberName: string | null;
  isControlledSubstance: boolean;
  metadata: {
    userId: string;
    workstationId: string;
    createdAt: string;
  };
}

// ---------------------------------------------------------------------------
// Invoice transmission sync operations
// ---------------------------------------------------------------------------

/**
 * Payload for INVOICE_TRANSMISSION operations.
 *
 * Created by InvoiceService when a contingency document needs to be
 * transmitted to DIAN. The server-side sync dispatcher validates the
 * payload and enqueues it into the fiscal engine for DIAN transmission.
 */
export interface InvoiceTransmissionPayload {
  invoiceId: string;
  invoiceNumber: string;
  contingencyNumber: string | null;
  saleId: string;
  provisionalCufe: string;
  fullInvoiceData: Record<string, unknown>;
  workstationId: string;
}

// ---------------------------------------------------------------------------
// Product sync operations
// ---------------------------------------------------------------------------

/**
 * Payload for PRODUCT_CREATION operations.
 *
 * Created by ProductService.createProduct() and dispatched server-side
 * to create the product authoritatively. The server assigns a real
 * sequential `internalCode` and reflects it back on sync completion.
 */
export interface ProductCreationPayload {
  operationType: 'PRODUCT_CREATION';
  userId: string;
  createProductDto: {
    internalCode: string;
    commercialName: string;
    genericName: string;
    activePrinciple: string;
    concentration?: string;
    concentrationUnit?: string;
    laboratory: string;
    saleType: string;
    minimumStock: number;
    invimaRegistry?: string;
    atcCode?: string;
    therapeuticIndication?: string;
    storageConditions?: string;
    internalNotes?: string;
    categoryId?: string;
    pharmaceuticalFormId?: string;
    barcodes: Array<{
      barcode: string;
      barcodeType: string;
      isPrimary: boolean;
    }>;
    price: {
      price: string;
      effectiveFrom: string;
    };
    tax: {
      taxSchemeId: string;
      effectiveFrom: string;
    };
  };
  metadata: {
    productId: string;
    workstationId: string;
    createdAt: string;
  };
}

/**
 * Payload for PRODUCT_UPDATE operations.
 *
 * Created by ProductService.updateProduct() (and softDeleteProduct) and
 * dispatched server-side to apply the same changes to the server record.
 * Only includes fields that actually changed.
 */
export interface ProductUpdatePayload {
  operationType: 'PRODUCT_UPDATE';
  userId: string;
  updateProductDto: {
    internalCode: string;
    commercialName?: string;
    genericName?: string;
    activePrinciple?: string;
    concentration?: string | null;
    concentrationUnit?: string | null;
    laboratory?: string;
    saleType?: string;
    minimumStock?: number;
    isActive?: boolean;
    discontinuationReason?: string;
    invimaRegistry?: string | null;
    atcCode?: string | null;
    therapeuticIndication?: string | null;
    storageConditions?: string | null;
    internalNotes?: string | null;
    categoryId?: string | null;
    pharmaceuticalFormId?: string | null;
    barcodes?: Array<{
      barcode: string;
      barcodeType: string;
      isPrimary: boolean;
    }>;
    price?: {
      price: string;
      effectiveFrom: string;
      changeReason?: string | null;
    };
    tax?: {
      taxSchemeId: string;
      effectiveFrom: string;
      changeReason?: string | null;
    };
  };
  metadata: {
    productId: string;
    workstationId: string;
    updatedAt: string;
  };
}

/**
 * Payload for INVOICE_TRANSMISSION_RESULT operations.
 *
 * Sent from the server back to the POS desktop after DIAN transmission
 * completes. The POS updates the local Invoice record with the official
 * CUFE and DIAN's response.
 */
export interface InvoiceTransmissionResultPayload {
  invoiceId: string;
  status: 'AUTHORIZED' | 'REJECTED';
  cufeOfficial?: string;
  dianXml?: string;
  rejectionReason?: string;
  authorizedAt?: string;
}

// ---------------------------------------------------------------------------
// Purchase sync operations
// ---------------------------------------------------------------------------

/**
 * Payload for PURCHASE_ORDER_CONFIRMATION operations.
 *
 * Created by PurchaseOrdersService.confirmOrder() and dispatched server-side
 * to record the purchase order as active. The server re-validates supplier
 * and product references against its authoritative state.
 */
export interface PurchaseOrderConfirmationPayload {
  orderId: string;
  sequentialNumber: number;
  supplierId: string;
  notes: string | null;
  createdById: string;
  confirmedByUserId: string;
  workstationId: string;
  confirmedAt: string;
  metadata: {
    localOrderId: string;
    workstationId: string;
    confirmedAt: string;
  };
}

/**
 * Payload for PURCHASE_RECEPTION_CONFIRMATION operations.
 *
 * Created by PurchaseReceptionsService.confirmReception() and dispatched
 * server-side for re-validation, lot creation, fiscal document generation,
 * and DIAN transmission. The server re-computes totals and creates the
 * authoritative PurchaseReception record.
 *
 * The payload mirrors the server's CreatePurchaseReceptionDto shape so
 * the server-side sync handler can delegate directly.
 */
export interface PurchaseReceptionConfirmationPayload {
  operationType: 'PURCHASE_RECEPTION_CONFIRMATION';
  receptionId: string;
  sequentialNumber: number;
  supplierId: string;
  purchaseOrderId: string | null;
  notes: string | null;
  createdById: string;
  confirmedByUserId: string;
  workstationId: string;
  confirmedAt: string;
  metadata: {
    localReceptionId: string;
    workstationId: string;
    confirmedAt: string;
  };
}

/**
 * Payload for SUPPLIER_RETURN_CONFIRMATION operations.
 *
 * Created by SupplierReturnsService.confirmReturn() and dispatched
 * server-side for re-validation, stock reversal, and DIAN credit-note
 * generation.
 */
export interface SupplierReturnConfirmationPayload {
  operationType: 'SUPPLIER_RETURN_CONFIRMATION';
  returnId: string;
  sequentialNumber: number;
  supplierId: string;
  purchaseReceptionId: string | null;
  reason: string | null;
  createdByUserId: string;
  workstationId: string;
  confirmedAt: string;
  metadata: {
    localReturnId: string;
    workstationId: string;
    confirmedAt: string;
  };
}
