/**
 * Return-specific domain errors for the POS desktop app.
 */
import { DomainError } from '../../common/domain-error';

/**
 * Thrown when a return references a sale that does not exist locally.
 */
export class SaleForReturnNotFoundException extends DomainError {
  constructor(saleId: string) {
    super(
      'SALE_FOR_RETURN_NOT_FOUND',
      `Sale with ID ${saleId} not found for return processing.`,
    );
  }
}

/**
 * Thrown when a return is attempted on a sale that is not in CONFIRMED state.
 */
export class SaleNotConfirmedForReturnException extends DomainError {
  constructor(saleId: string, state: string) {
    super(
      'SALE_NOT_CONFIRMED_FOR_RETURN',
      `Sale ${saleId} is in state "${state}" and cannot be used for a return.`,
    );
  }
}

/**
 * Thrown when the return quantity for an item exceeds the quantity sold in the original sale.
 */
export class ReturnQuantityExceedsSaleException extends DomainError {
  constructor(saleItemId: string, sold: number, requested: number) {
    super(
      'RETURN_QUANTITY_EXCEEDS_SALE',
      `SaleItem ${saleItemId}: sold ${sold}, requested return ${requested}.`,
    );
  }
}

/**
 * Thrown when a return item references a sale item that is not found
 * or does not belong to the referenced sale.
 */
export class ReturnSaleItemNotFoundException extends DomainError {
  constructor(saleItemId: string, saleId: string) {
    super(
      'RETURN_SALE_ITEM_NOT_FOUND',
      `SaleItem ${saleItemId} not found in sale ${saleId}.`,
    );
  }
}

/**
 * Thrown when attempting to modify a return that is not in DRAFT state.
 */
export class ReturnNotInDraftException extends DomainError {
  constructor(returnId: string, state: string) {
    super(
      'RETURN_NOT_IN_DRAFT',
      `Return ${returnId} is in state "${state}" and cannot be modified.`,
    );
  }
}

/**
 * Thrown when a return is not found.
 */
export class ReturnNotFoundException extends DomainError {
  constructor(returnId: string) {
    super('RETURN_NOT_FOUND', `Return with ID ${returnId} not found.`);
  }
}

/**
 * Thrown when stock reversal fails for a return (e.g. lot exhaustion race).
 */
export class ReturnStockReversalFailedException extends DomainError {
  constructor(lotId: string, message: string) {
    super('RETURN_STOCK_REVERSAL_FAILED', `Stock reversal failed for lot ${lotId}: ${message}`);
  }
}
