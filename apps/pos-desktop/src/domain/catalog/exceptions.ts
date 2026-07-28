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

/**
 * Thrown when a product reference (tax scheme, pharmaceutical form, or
 * category) cannot be synced to the server.
 *
 * Two distinct failure modes, each with its own recovery path:
 *
 * - `local_seed_id` — the id starts with the `seed-` prefix used by the
 *   offline catalog seed (e.g. `seed-iva-19`, `seed-exento`). These rows
 *   are POS-local-only and were never pushed to the server, so the
 *   server will reject them. This is a configuration error: the
 *   operator must pick a reference that was synced from the server
 *   (either a UUID or a slug-style id such as `tax_exento` /
 *   `pf_tablet`). Triggering a pull-sync does NOT fix this — the seed
 *   row will simply be overwritten by the server's real id of the same
 *   name, but the operator has to re-pick the reference in the form.
 *
 * - `not_in_local_cache` — the id is well-formed but no row with that
 *   id is present in the local `taxScheme` / `pharmaceuticalForm` /
 *   `category` cache. This is a sync-ordering issue: a pull-sync has
 *   not yet brought that reference down, so the server knows about it
 *   but the POS doesn't. Wait for the next pull-sync cycle and retry.
 *
 * The UI should map `REFERENCE_NOT_SYNCED` to a clear message that
 * branches on the `reason` field rather than treating it as a generic
 * product-creation error.
 */
export class UnsyncedReferenceException extends DomainError {
  readonly referenceType: 'taxScheme' | 'pharmaceuticalForm' | 'category';
  readonly referenceId: string;
  readonly reason: 'local_seed_id' | 'not_in_local_cache';

  constructor(
    referenceType: 'taxScheme' | 'pharmaceuticalForm' | 'category',
    referenceId: string,
    reason: 'local_seed_id' | 'not_in_local_cache',
  ) {
    const humanReason =
      reason === 'local_seed_id'
        ? 'looks like a local seed id (only valid in the offline catalog, not on the server)'
        : 'is not present in the local cache yet';
    const recovery =
      reason === 'local_seed_id'
        ? 'Pick a reference that was synced from the server (a UUID or a slug-style id such as "tax_exento") and retry.'
        : 'Wait for catalog pull-sync to complete and retry.';
    super(
      'REFERENCE_NOT_SYNCED',
      `Reference ${referenceType} "${referenceId}" ${humanReason}. ${recovery}`,
    );
    this.referenceType = referenceType;
    this.referenceId = referenceId;
    this.reason = reason;
  }
}
