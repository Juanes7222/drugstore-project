/**
 * Inventory-lot-specific domain errors for the POS desktop app.
 *
 * Mirrors the server-side exceptions from
 * apps/server/src/modules/inventory-lots/exceptions/ but extends the local
 * DomainError base class (no NestJS dependency).
 *
 * Only exceptions needed for the local-authority primitives this module
 * exposes are ported here; the full set lives on the server.
 */
import { DomainError } from '../../common/domain-error';

/**
 * Thrown when requested sale quantity exceeds the total available stock
 * across all ACTIVE lots of a product.
 */
export class InsufficientStockException extends DomainError {
  constructor(productId: string, requested: number, available: number) {
    super(
      'INSUFFICIENT_STOCK',
      `Insufficient stock for product ${productId}. Requested: ${requested}, Available: ${available}`,
    );
  }
}

/**
 * Thrown when an optimistic-locked lot update affects zero rows,
 * indicating a concurrent modification (another operation changed the
 * same lot between read and write).
 */
export class ConcurrentStockModificationException extends DomainError {
  constructor(lotId: string) {
    super(
      'CONCURRENT_STOCK_MODIFICATION',
      `Concurrent modification detected for lot ${lotId}. Please retry the operation.`,
    );
  }
}
