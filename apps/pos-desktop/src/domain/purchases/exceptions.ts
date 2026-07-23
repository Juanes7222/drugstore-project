/**
 * Purchase-domain error types for the POS desktop app.
 */
import { DomainError } from '../../common/domain-error';

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export class SupplierNotFoundException extends DomainError {
  constructor(supplierId: string) {
    super('SUPPLIER_NOT_FOUND', `Supplier with ID ${supplierId} not found.`);
  }
}

export class DuplicateSupplierIdentificationException extends DomainError {
  constructor(identificationType: string, identificationNumber: string) {
    super(
      'DUPLICATE_SUPPLIER_IDENTIFICATION',
      `Supplier with ${identificationType} ${identificationNumber} already exists.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Purchase Orders
// ---------------------------------------------------------------------------

export class PurchaseOrderNotFoundException extends DomainError {
  constructor(orderId: string) {
    super('PURCHASE_ORDER_NOT_FOUND', `Purchase order ${orderId} not found.`);
  }
}

export class PurchaseOrderNotDraftException extends DomainError {
  constructor(orderId: string, state: string) {
    super(
      'PURCHASE_ORDER_NOT_DRAFT',
      `Purchase order ${orderId} is in state "${state}" and cannot be modified.`,
    );
  }
}

export class PurchaseOrderNotConfirmableException extends DomainError {
  constructor(_orderId: string, reason: string) {
    super('PURCHASE_ORDER_NOT_CONFIRMABLE', reason);
  }
}

// ---------------------------------------------------------------------------
// Purchase Receptions
// ---------------------------------------------------------------------------

export class PurchaseReceptionNotFoundException extends DomainError {
  constructor(receptionId: string) {
    super('PURCHASE_RECEPTION_NOT_FOUND', `Purchase reception ${receptionId} not found.`);
  }
}

export class PurchaseReceptionNotDraftException extends DomainError {
  constructor(receptionId: string, state: string) {
    super(
      'PURCHASE_RECEPTION_NOT_DRAFT',
      `Purchase reception ${receptionId} is in state "${state}".`,
    );
  }
}

export class PurchaseReceptionNotConfirmedException extends DomainError {
  constructor(receptionId: string) {
    super(
      'PURCHASE_RECEPTION_NOT_CONFIRMED',
      `Purchase reception ${receptionId} is not in CONFIRMED state.`,
    );
  }
}

export class OverReceptionException extends DomainError {
  constructor(itemId: string, maxAllowed: number, requested: number) {
    super(
      'OVER_RECEPTION',
      `Reception item ${itemId}: max allowed ${maxAllowed}, requested ${requested}.`,
    );
  }
}

export class PurchaseOrderItemNotFoundException extends DomainError {
  constructor(itemId: string) {
    super('PURCHASE_ORDER_ITEM_NOT_FOUND', `Purchase order item ${itemId} not found.`);
  }
}

export class PurchaseOrderItemMismatchException extends DomainError {
  constructor(itemId: string, detail: string) {
    super('PURCHASE_ORDER_ITEM_MISMATCH', `Item ${itemId}: ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Supplier Returns
// ---------------------------------------------------------------------------

export class SupplierReturnNotFoundException extends DomainError {
  constructor(returnId: string) {
    super('SUPPLIER_RETURN_NOT_FOUND', `Supplier return ${returnId} not found.`);
  }
}

export class SupplierReturnNotDraftException extends DomainError {
  constructor(returnId: string, expectedState: string) {
    super(
      'SUPPLIER_RETURN_NOT_DRAFT',
      `Supplier return ${returnId} is not in ${expectedState} state.`,
    );
  }
}

export class SupplierReturnCannotBeAnnulledException extends DomainError {
  constructor(returnId: string) {
    super(
      'SUPPLIER_RETURN_CANNOT_BE_ANNULLED',
      `Supplier return ${returnId} cannot be annulled in its current state.`,
    );
  }
}

export class SupplierReturnLotCostUnavailableException extends DomainError {
  constructor(lotId: string) {
    super(
      'SUPPLIER_RETURN_LOT_COST_UNAVAILABLE',
      `Cannot determine unit cost for lot ${lotId} — no purchase reception record found.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Lot / Stock
// ---------------------------------------------------------------------------

export class LotNotFoundException extends DomainError {
  constructor(lotId: string) {
    super('LOT_NOT_FOUND', `Lot ${lotId} not found.`);
  }
}

export class ConcurrentStockModificationException extends DomainError {
  constructor(lotId: string) {
    super(
      'CONCURRENT_STOCK_MODIFICATION',
      `Lot ${lotId} was modified concurrently. Please retry.`,
    );
  }
}
