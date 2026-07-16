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
