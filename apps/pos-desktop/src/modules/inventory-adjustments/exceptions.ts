/**
 * Inventory-adjustment-specific domain errors for the POS desktop app.
 */
import { DomainError } from '../../common/domain-error';

/**
 * Thrown when an adjustment document is not found.
 */
export class AdjustmentNotFoundException extends DomainError {
  constructor(adjustmentId: string) {
    super(
      'ADJUSTMENT_NOT_FOUND',
      `Adjustment document with ID ${adjustmentId} not found.`,
    );
  }
}

/**
 * Thrown when attempting to modify an adjustment that is not in DRAFT state.
 */
export class AdjustmentNotInDraftException extends DomainError {
  constructor(adjustmentId: string, state: string) {
    super(
      'ADJUSTMENT_NOT_IN_DRAFT',
      `Adjustment ${adjustmentId} is in state "${state}" and cannot be modified.`,
    );
  }
}

/**
 * Thrown when an adjustment references a product with no available lots.
 */
export class NoLotsForProductException extends DomainError {
  constructor(productId: string) {
    super(
      'NO_LOTS_FOR_PRODUCT',
      `No lots found for product ${productId}. Cannot apply negative adjustment.`,
    );
  }
}

/**
 * Thrown when a negative adjustment quantity exceeds available stock
 * across all lots for the product.
 */
export class AdjustmentExceedsAvailableStockException extends DomainError {
  constructor(productId: string, requested: number, available: number) {
    super(
      'ADJUSTMENT_EXCEEDS_AVAILABLE_STOCK',
      `Negative adjustment for product ${productId}: requested ${requested}, available ${available}.`,
    );
  }
}

/**
 * Thrown when a lot version conflict occurs during adjustment application.
 */
export class AdjustmentLotConflictException extends DomainError {
  constructor(lotId: string) {
    super(
      'ADJUSTMENT_LOT_CONFLICT',
      `Lot ${lotId} was modified concurrently. Please retry the adjustment.`,
    );
  }
}
