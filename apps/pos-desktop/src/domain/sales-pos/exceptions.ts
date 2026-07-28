/**
 * Sales-pos-specific domain errors for the POS desktop app.
 *
 * Mirrors the server-side exceptions from
 * apps/server/src/modules/sales-pos/exceptions/ but extends the local
 * DomainError base class (no NestJS dependency).
 *
 * Only exceptions needed for the local-authority primitives this module
 * exposes (create and confirm) are ported here. Server-authoritative
 * exceptions like annul-related or client-return-related ones are
 * omitted — they live on the server only.
 */
import { DomainError } from '../../common/domain-error';

/**
 * Thrown when attempting to confirm a sale whose operational state is not
 * IN_PROGRESS.
 */
export class SaleNotInProgressException extends DomainError {
  constructor(saleId: string) {
    super(
      'SALE_NOT_IN_PROGRESS',
      `Sale ${saleId} is not in IN_PROGRESS state and cannot be confirmed.`,
    );
  }
}

/**
 * Thrown when a sale item references a product whose saleType requires a
 * prescription (PRESCRIPTION or CONTROLLED_SUBSTANCE). Only FREE_SALE is
 * supported in the local POS.
 */
export class PrescriptionRequiredNotSupportedException extends DomainError {
  constructor(productId: string) {
    super(
      'PRESCRIPTION_REQUIRED_NOT_SUPPORTED',
      `Product ${productId} requires a prescription, which is not supported in this phase.`,
    );
  }
}

/**
 * Thrown when the total payment amount does not meet or exceed the sale's
 * totalAmount.
 */
export class PaymentAmountMismatchException extends DomainError {
  constructor(totalAmount: number, totalPaid: number) {
    super(
      'PAYMENT_AMOUNT_MISMATCH',
      `Total payments (${totalPaid}) do not match total sale amount (${totalAmount}).`,
    );
  }
}

/**
 * Thrown when overpayment (change due) is required but no cash payment
 * method is present in the payment list.
 */
export class ChangeRequiresCashPaymentException extends DomainError {
  constructor() {
    super(
      'CHANGE_REQUIRES_CASH_PAYMENT',
      'Change can only be returned if at least one payment method is cash.',
    );
  }
}

/**
 * Thrown when a sale with the given ID is not found.
 */
export class SaleNotFoundException extends DomainError {
  constructor(saleId: string) {
    super(
      'SALE_NOT_FOUND',
      `Sale with ID ${saleId} not found`,
    );
  }
}

/**
 * Thrown when a non-owner role tries to apply a discount that exceeds
 * either the per-item cap or the sale-wide cap configured for their role.
 */
export class DiscountExceedsRoleLimitException extends DomainError {
  constructor(
    public readonly role: string,
    public readonly productId: string,
    public readonly attemptedPercent: number,
    public readonly maxPercent: number,
    public readonly scope: 'item' | 'global',
  ) {
    super(
      'DISCOUNT_EXCEEDS_ROLE_LIMIT',
      scope === 'item'
        ? `Role ${role} cannot apply a ${attemptedPercent.toFixed(2)}% item discount to product ${productId} (max ${maxPercent}%).`
        : `Role ${role} cannot apply a ${attemptedPercent.toFixed(2)}% sale-wide discount (max ${maxPercent}%).`,
    );
  }
}

/**
 * Thrown when a non-owner role tries to override the catalog unit price
 * at sale time, and the role's `priceOverridePermissions.allowed` is
 * `false`.
 */
export class PriceOverrideNotAllowedForRoleException extends DomainError {
  constructor(
    public readonly role: string,
    public readonly productId: string,
  ) {
    super(
      'PRICE_OVERRIDE_NOT_ALLOWED_FOR_ROLE',
      `Role ${role} is not permitted to override the catalog price for product ${productId}.`,
    );
  }
}

/**
 * Thrown when a sale's effective unit price would fall below the
 * configured price floor.  The floor is universal — it applies to every
 * role including the owner — and the owner can disable it from the
 * settings tab.
 */
export class PriceBelowCostException extends DomainError {
  constructor(
    public readonly productId: string,
    public readonly attemptedPrice: number,
    public readonly floorPrice: number,
    public readonly floorType: 'COST' | 'COST_PLUS_MARGIN',
  ) {
    super(
      'PRICE_BELOW_COST',
      `Price ${attemptedPrice} for product ${productId} is below the ${floorType} floor of ${floorPrice}.`,
    );
  }
}

/**
 * Thrown when a sale is being created (or confirmed) and at least one
 * referenced product has not been pushed to the server yet.
 *
 * Background: the POS can create products while offline. Those rows
 * carry a provisional `OFFLINE-{uuid}` internalCode and `serverId IS NULL`
 * until the next sync push successfully delivers a `PRODUCT_CREATION`
 * to the server and stamps the returned server-assigned id on the local
 * row. If a sale of one of those products reaches the server first, the
 * server rejects the `SALE_CONFIRMATION` with `Product with ID {x} not
 * found`, the cashier sees a successful local sale that the server has
 * no record of, and every subsequent sale of the same product piles up
 * behind that first failed push.
 *
 * Blocking the sale at create/confirm time is the correct fix for a
 * local-first POS that needs eventual consistency with the server: the
 * cashier can still process a sale of a synced product, and the unsynced
 * product becomes sellable the moment its `PRODUCT_CREATION` push
 * completes (the same `SyncScheduler` reconnect-burst that pushes the
 * sale-confirmation also pushes the product-creation). The exception
 * carries a `productId` so the UI can highlight exactly which line item
 * the cashier needs to wait for.
 *
 * Surfaced to the user through the i18n key
 * `sales.cart.error_product_not_synced_yet`.
 */
export class ProductNotSyncedYetException extends DomainError {
  constructor(public readonly productId: string) {
    super(
      'PRODUCT_NOT_SYNCED_YET',
      `Product ${productId} has not been synced to the server yet. ` +
        'Wait for the next sync cycle to complete and retry, or contact a manager.',
    );
  }
}
