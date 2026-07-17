/**
 * Catalog/Product domain errors for the POS desktop app.
 */
import { DomainError } from '../../common/domain-error';

/**
 * Thrown when a product is not found by id or internalCode.
 */
export class ProductNotFoundException extends DomainError {
  constructor(key: string) {
    super('PRODUCT_NOT_FOUND', `Product with id/code ${key} not found.`);
  }
}

/**
 * Thrown when product creation fails (e.g. duplicate barcode).
 */
export class ProductCreationException extends DomainError {
  constructor(reason: string) {
    super('PRODUCT_CREATION_FAILED', `Product creation failed: ${reason}.`);
  }
}

/**
 * Thrown when product update fails (e.g. concurrent modification).
 */
export class ProductUpdateException extends DomainError {
  constructor(productId: string, reason: string) {
    super(
      'PRODUCT_UPDATE_FAILED',
      `Product ${productId} update failed: ${reason}.`,
    );
  }
}

/**
 * Thrown when a barcode is already assigned to a different product.
 */
export class DuplicateBarcodeException extends DomainError {
  constructor(barcode: string) {
    super(
      'DUPLICATE_BARCODE',
      `Barcode ${barcode} is already assigned to another product.`,
    );
  }
}
