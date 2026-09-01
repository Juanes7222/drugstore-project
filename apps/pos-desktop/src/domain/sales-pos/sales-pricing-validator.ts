/**
 * Pure validation functions for sale-item pricing rules.
 *
 * Centralises the role-based checks the sales-pos service applies to
 * every line item (discount percentage, price override) and to the sale
 * as a whole (global discount cap, cost floor).  Kept free of database
 * and React dependencies so the rules are trivially testable in
 * isolation.
 *
 * ## Role model
 *
 * The user-facing configuration only exposes per-role limits for the
 * roles that meaningfully differ from the defaults.  The owner is
 * implicit: the discount map carries `owner: 100/100` for display, but
 * the validation always treats the owner as unconstrained by discount
 * limits and price-override permissions — the cost floor is the single
 * invariant that applies to them.
 */
import { RoleType } from '@pharmacy/shared-types';
import { Prisma } from '@pharmacy/database/local';
import type {
  DiscountLimits,
  SalesConfig,
  PriceOverridePermissions,
  PriceFloorConfig,
} from '../configuration/local-config.store';
import {
  DiscountExceedsRoleLimitException,
  PriceOverrideNotAllowedForRoleException,
  PriceBelowCostException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

/**
 * Map a `RoleType` to the key used in the `DiscountLimits` map.
 *
 * `ADMIN` and `OWNER` both fall through to the legacy `admin` key for
 * backward compatibility with payload data that only carries the four
 * legacy roles; the validation function special-cases `OWNER` so its
 * entry is effectively a placeholder.
 */
export type DiscountLimitKey =
  | 'owner'
  | 'manager'
  | 'cashier'
  | 'inventoryAssistant'
  | 'accountant'
  | 'admin';

export function resolveDiscountLimitKey(role: RoleType | string): DiscountLimitKey {
  switch (role) {
    case RoleType.OWNER:
      return 'owner';
    case RoleType.MANAGER:
      return 'manager';
    case RoleType.CASHIER:
      return 'cashier';
    case RoleType.INVENTORY_ASSISTANT:
      return 'inventoryAssistant';
    case RoleType.ACCOUNTANT:
      return 'accountant';
    case RoleType.ADMIN:
    default:
      return 'admin';
  }
}

/**
 * Map a non-owner `RoleType` to the key used in
 * `PriceOverridePermissions`.  Owners never appear here.
 */
export type PriceOverrideRoleKey =
  | 'manager'
  | 'cashier'
  | 'inventoryAssistant'
  | 'accountant';

export function resolvePriceOverrideRoleKey(
  role: RoleType | string,
): PriceOverrideRoleKey | null {
  switch (role) {
    case RoleType.MANAGER:
      return 'manager';
    case RoleType.CASHIER:
      return 'cashier';
    case RoleType.INVENTORY_ASSISTANT:
      return 'inventoryAssistant';
    case RoleType.ACCOUNTANT:
      return 'accountant';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Per-item validation
// ---------------------------------------------------------------------------

export interface ValidateItemPricingInput {
  role: RoleType | string;
  productId: string;
  /** Optional explicit price override from the request. */
  requestedUnitPrice: Prisma.Decimal | undefined;
  /** Latest catalog price (from `ProductPriceHistory`). */
  catalogUnitPrice: Prisma.Decimal;
  /** Optional explicit discount percentage from the request. */
  discountPercentage: number | undefined;
  /** Latest product cost (from `ProductCostHistory`), or null if unset. */
  productCost: Prisma.Decimal | null;
  discountLimits: DiscountLimits;
  salesConfig: SalesConfig;
}

/**
 * Validate one sale item's pricing against the role's allowed
 * discounts, price-override permissions, and the configured cost floor.
 *
 * Throws a domain exception on the first violation encountered.  The
 * function is total: a successful call returns `void`.
 */
export function validateItemPricing(
  input: ValidateItemPricingInput,
): void {
  const {
    role,
    productId,
    requestedUnitPrice,
    catalogUnitPrice,
    discountPercentage,
    productCost,
    discountLimits,
    salesConfig,
  } = input;

  const isOwner = role === RoleType.OWNER;

  // -- 1. Price override permission -----------------------------------
  // Owners always allowed.  Everyone else must have
  // `priceOverridePermissions[role].allowed === true`, but only when an
  // explicit override *different* from the catalog price is present.
  // Sending the catalog price verbatim (frontend always does to avoid
  // drift) is NOT an override — otherwise every cashier sale would fail
  // when cashier.allowed=false (the default).
  if (
    requestedUnitPrice !== undefined &&
    !requestedUnitPrice.equals(catalogUnitPrice) &&
    !isOwner
  ) {
    const overrideKey = resolvePriceOverrideRoleKey(role);
    if (overrideKey === null) {
      // Role not listed in the override map (e.g. SAAS_ADMIN, ADMIN
      // legacy).  Treat as not allowed — they should use the catalog
      // price.
      throw new PriceOverrideNotAllowedForRoleException(
        String(role),
        productId,
      );
    }
    const overrideRule =
      salesConfig.priceOverridePermissions[overrideKey];
    if (!overrideRule.allowed) {
      throw new PriceOverrideNotAllowedForRoleException(
        String(role),
        productId,
      );
    }
  }

  // -- 2. Per-item discount cap ---------------------------------------
  // Owners are exempt (their cap is effectively 100%).  Everyone else
  // must respect `discountLimits[role].itemMaxPercent`.
  if (!isOwner && discountPercentage !== undefined && discountPercentage > 0) {
    const limitKey = resolveDiscountLimitKey(role);
    const itemMax = discountLimits[limitKey]?.itemMaxPercent ?? 0;
    if (discountPercentage > itemMax) {
      throw new DiscountExceedsRoleLimitException(
        String(role),
        productId,
        discountPercentage,
        itemMax,
        'item',
      );
    }
  }

  // -- 3. Cost floor --------------------------------------------------
  // Universal — applies to every role, owner included.  When the floor
  // is disabled in the settings, this check is skipped for everyone.
  // The floor operates on the final price the customer would pay per
  // unit, which is `requestedUnitPrice` if provided, else
  // `catalogUnitPrice` — the override path is what makes this check
  // meaningful (the catalog price is set by the owner, so it is
  // already above cost by construction).
  applyCostFloor({
    productId,
    finalUnitPrice: requestedUnitPrice ?? catalogUnitPrice,
    productCost,
    priceFloor: salesConfig.priceFloor,
  });
}

// ---------------------------------------------------------------------------
// Sale-level validation
// ---------------------------------------------------------------------------

export interface ValidateSalePricingInput {
  role: RoleType | string;
  /** Total discount amount across all items, in pesos. */
  totalDiscount: Prisma.Decimal;
  /** Subtotal before any discount, in pesos. */
  subtotal: Prisma.Decimal;
  discountLimits: DiscountLimits;
}

/**
 * Validate the sale-level global discount cap.  Owners are exempt.
 *
 * The cap is expressed as a percentage of the subtotal: if the cashier
 * discounts the entire sale by 30% but their global cap is 20%, this
 * throws even if no individual item exceeded its own cap.
 */
export function validateSalePricing(
  input: ValidateSalePricingInput,
): void {
  const { role, totalDiscount, subtotal, discountLimits } = input;

  if (role === RoleType.OWNER) return;
  if (subtotal.lessThanOrEqualTo(new Prisma.Decimal(0))) return;

  const limitKey = resolveDiscountLimitKey(role);
  const globalMax =
    discountLimits[limitKey]?.globalMaxPercent ?? 0;

  // Compute effective global discount percent with two decimal places to
  // avoid floating-point drift in the comparison.
  const percentDecimal = totalDiscount
    .dividedBy(subtotal)
    .times(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const percent = percentDecimal.toNumber();

  if (percent > globalMax) {
    throw new DiscountExceedsRoleLimitException(
      String(role),
      '*',
      percent,
      globalMax,
      'global',
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyCostFloor(args: {
  productId: string;
  finalUnitPrice: Prisma.Decimal;
  productCost: Prisma.Decimal | null;
  priceFloor: PriceFloorConfig;
}): void {
  const { productId, finalUnitPrice, productCost, priceFloor } = args;

  if (!priceFloor.enabled) return;
  if (productCost === null) return; // no cost data → no enforcement

  let floor: Prisma.Decimal;
  if (priceFloor.type === 'COST') {
    floor = productCost;
  } else {
    // COST_PLUS_MARGIN
    const margin = new Prisma.Decimal(priceFloor.minMarginPercent);
    const one = new Prisma.Decimal(1);
    floor = productCost.times(one.plus(margin.dividedBy(100)));
  }

  if (finalUnitPrice.lessThan(floor)) {
    throw new PriceBelowCostException(
      productId,
      finalUnitPrice.toNumber(),
      floor.toNumber(),
      priceFloor.type,
    );
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { PriceOverridePermissions };
