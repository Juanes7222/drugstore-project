/**
 * Unit tests for the pure sales-pricing validation functions.
 *
 * The validator is the single source of truth for per-item and sale-level
 * pricing rules: role-based discount caps, price-override permissions, and
 * the universal cost floor.  It reads config from the local-config Zustand
 * store via `getDiscountLimits()` and `getSalesConfig()` in the real call
 * path, but the function itself takes plain objects so it is trivially
 * testable in isolation.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { Prisma } from "@pharmacy/database/local";
import { RoleType } from "@pharmacy/shared-types";
import {
  validateItemPricing,
  validateSalePricing,
  resolveDiscountLimitKey,
  resolvePriceOverrideRoleKey,
  type ValidateItemPricingInput,
  type ValidateSalePricingInput,
} from "./sales-pricing-validator";
import {
  DiscountExceedsRoleLimitException,
  PriceOverrideNotAllowedForRoleException,
  PriceBelowCostException,
} from "./exceptions";
import { useLocalConfigStore, type DiscountLimits, type SalesConfig } from "../configuration/local-config.store";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const makeDiscountLimits = (): DiscountLimits => ({
  owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
  manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
  cashier: { itemMaxPercent: 10, globalMaxPercent: 5 },
  admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
  inventoryAssistant: { itemMaxPercent: 15, globalMaxPercent: 10 },
  accountant: { itemMaxPercent: 0, globalMaxPercent: 0 },
});

const makeSalesConfig = (overrides?: {
  cashierAllowed?: boolean;
  cashierRequireReason?: boolean;
  managerAllowed?: boolean;
  floorEnabled?: boolean;
  floorType?: "COST" | "COST_PLUS_MARGIN";
  minMarginPercent?: number;
}): SalesConfig => ({
  priceOverridePermissions: {
    manager: {
      allowed: overrides?.managerAllowed ?? true,
      requireReason: true,
    },
    cashier: {
      allowed: overrides?.cashierAllowed ?? false,
      requireReason: overrides?.cashierRequireReason ?? true,
    },
    inventoryAssistant: { allowed: false, requireReason: true },
    accountant: { allowed: false, requireReason: true },
  },
  priceFloor: {
    enabled: overrides?.floorEnabled ?? true,
    type: overrides?.floorType ?? "COST",
    minMarginPercent: overrides?.minMarginPercent ?? 0,
  },
  creditEnabled: false,
  defaultCreditLimitCents: 0,
});

const makeItemInput = (
  overrides: Partial<ValidateItemPricingInput> = {},
): ValidateItemPricingInput => ({
  role: RoleType.CASHIER,
  productId: "prod-1",
  requestedUnitPrice: undefined,
  catalogUnitPrice: new Prisma.Decimal(5000),
  discountPercentage: undefined,
  productCost: null,
  discountLimits: makeDiscountLimits(),
  salesConfig: makeSalesConfig(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveDiscountLimitKey", () => {
  it("maps OWNER to the owner key", () => {
    expect(resolveDiscountLimitKey(RoleType.OWNER)).toBe("owner");
  });

  it("maps MANAGER to the manager key", () => {
    expect(resolveDiscountLimitKey(RoleType.MANAGER)).toBe("manager");
  });

  it("maps CASHIER to the cashier key", () => {
    expect(resolveDiscountLimitKey(RoleType.CASHIER)).toBe("cashier");
  });

  it("maps INVENTORY_ASSISTANT to the inventoryAssistant key", () => {
    expect(resolveDiscountLimitKey(RoleType.INVENTORY_ASSISTANT)).toBe("inventoryAssistant");
  });

  it("maps ACCOUNTANT to the accountant key", () => {
    expect(resolveDiscountLimitKey(RoleType.ACCOUNTANT)).toBe("accountant");
  });

  it("maps ADMIN and any unknown role to the admin key", () => {
    expect(resolveDiscountLimitKey(RoleType.ADMIN)).toBe("admin");
    expect(resolveDiscountLimitKey("UNKNOWN_ROLE")).toBe("admin");
    expect(resolveDiscountLimitKey(RoleType.SAAS_ADMIN)).toBe("admin");
  });
});

describe("resolvePriceOverrideRoleKey", () => {
  it("maps MANAGER to the manager key", () => {
    expect(resolvePriceOverrideRoleKey(RoleType.MANAGER)).toBe("manager");
  });

  it("maps CASHIER to the cashier key", () => {
    expect(resolvePriceOverrideRoleKey(RoleType.CASHIER)).toBe("cashier");
  });

  it("maps INVENTORY_ASSISTANT to the inventoryAssistant key", () => {
    expect(resolvePriceOverrideRoleKey(RoleType.INVENTORY_ASSISTANT)).toBe("inventoryAssistant");
  });

  it("maps ACCOUNTANT to the accountant key", () => {
    expect(resolvePriceOverrideRoleKey(RoleType.ACCOUNTANT)).toBe("accountant");
  });

  it("returns null for OWNER", () => {
    expect(resolvePriceOverrideRoleKey(RoleType.OWNER)).toBeNull();
  });

  it("returns null for ADMIN and SAAS_ADMIN", () => {
    expect(resolvePriceOverrideRoleKey(RoleType.ADMIN)).toBeNull();
    expect(resolvePriceOverrideRoleKey(RoleType.SAAS_ADMIN)).toBeNull();
  });

  it("returns null for any unknown role string", () => {
    expect(resolvePriceOverrideRoleKey("UNKNOWN_ROLE")).toBeNull();
  });
});

describe("validateItemPricing", () => {
  describe("owner exemptions", () => {
    it("allows owner to apply a 100% item discount", () => {
      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.OWNER,
            discountPercentage: 100,
            // cost floor would block 0, so disable the floor for this test
            salesConfig: makeSalesConfig({ floorEnabled: false }),
          }),
        ),
      ).not.toThrow();
    });

    it("allows owner to override the price even though the override key map excludes owner", () => {
      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.OWNER,
            requestedUnitPrice: new Prisma.Decimal(1),
            // cost floor would block 1 (assuming cost is set), so use no cost
            productCost: null,
            salesConfig: makeSalesConfig({ floorEnabled: false }),
          }),
        ),
      ).not.toThrow();
    });

    it("still subjects the owner to the cost floor", () => {
      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.OWNER,
            requestedUnitPrice: new Prisma.Decimal(5),
            productCost: new Prisma.Decimal(50),
            // floor enabled (default), so 5 < 50 should throw
          }),
        ),
      ).toThrow(PriceBelowCostException);
    });
  });

  describe("discount cap", () => {
    it("throws DiscountExceedsRoleLimitException with scope 'item' when cashier exceeds their item cap", () => {
      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.CASHIER,
            discountPercentage: 20, // cashier.itemMaxPercent is 10
          }),
        ),
      ).toThrow(DiscountExceedsRoleLimitException);

      try {
        validateItemPricing(
          makeItemInput({
            role: RoleType.CASHIER,
            discountPercentage: 20,
          }),
        );
      } catch (err) {
        expect(err).toBeInstanceOf(DiscountExceedsRoleLimitException);
        const ex = err as DiscountExceedsRoleLimitException;
        expect(ex.scope).toBe("item");
        expect(ex.attemptedPercent).toBe(20);
        expect(ex.maxPercent).toBe(10);
        expect(ex.role).toBe(RoleType.CASHIER);
        expect(ex.productId).toBe("prod-1");
      }
    });

    it("allows a cashier discount exactly at the item cap", () => {
      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.CASHIER,
            discountPercentage: 10, // cashier.itemMaxPercent is 10
          }),
        ),
      ).not.toThrow();
    });
  });

  describe("price-override permission", () => {
    it("throws PriceOverrideNotAllowedForRoleException when cashier overrides and allowed=false", () => {
      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.CASHIER,
            requestedUnitPrice: new Prisma.Decimal(4000),
            // salesConfig defaults: cashier.allowed = false
          }),
        ),
      ).toThrow(PriceOverrideNotAllowedForRoleException);
    });

    it("passes the override permission check for a cashier when allowed=true and no reason is provided", () => {
      // The reason check is handled in buildSaleItemFromRequest, NOT in
      // this validator.  The validator only enforces the role's
      // `allowed` flag, not the `requireReason` companion flag.
      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.CASHIER,
            requestedUnitPrice: new Prisma.Decimal(4000),
            productCost: null,
            salesConfig: makeSalesConfig({ cashierAllowed: true }),
          }),
        ),
      ).not.toThrow();
    });

    it("allows manager overrides when manager.allowed=true", () => {
      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.MANAGER,
            requestedUnitPrice: new Prisma.Decimal(4500),
            productCost: null,
            // salesConfig defaults: manager.allowed = true
          }),
        ),
      ).not.toThrow();
    });
  });

  describe("cost floor", () => {
    it("does not enforce the cost floor when productCost is null", () => {
      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.CASHIER,
            requestedUnitPrice: new Prisma.Decimal(1),
            productCost: null,
            // cashier.allowed = true so the override check passes and
            // the cost floor check is reached
            salesConfig: makeSalesConfig({ cashierAllowed: true }),
            // floor enabled, but no cost data → no enforcement
          }),
        ),
      ).not.toThrow();
    });

    it("throws PriceBelowCostException when an override is below cost and the floor is enabled", () => {
      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.CASHIER,
            requestedUnitPrice: new Prisma.Decimal(5),
            productCost: new Prisma.Decimal(50),
            salesConfig: makeSalesConfig({ cashierAllowed: true }),
            // floor enabled (default), 5 < 50 → throw
          }),
        ),
      ).toThrow(PriceBelowCostException);

      try {
        validateItemPricing(
          makeItemInput({
            role: RoleType.CASHIER,
            requestedUnitPrice: new Prisma.Decimal(5),
            productCost: new Prisma.Decimal(50),
            salesConfig: makeSalesConfig({ cashierAllowed: true }),
          }),
        );
      } catch (err) {
        expect(err).toBeInstanceOf(PriceBelowCostException);
        const ex = err as PriceBelowCostException;
        expect(ex.productId).toBe("prod-1");
        expect(ex.attemptedPrice).toBe(5);
        expect(ex.floorPrice).toBe(50);
        expect(ex.floorType).toBe("COST");
      }
    });

    it("does not enforce the cost floor when the floor is disabled", () => {
      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.CASHIER,
            requestedUnitPrice: new Prisma.Decimal(5),
            productCost: new Prisma.Decimal(50),
            salesConfig: makeSalesConfig({ cashierAllowed: true, floorEnabled: false }),
          }),
        ),
      ).not.toThrow();
    });

    it("uses cost * (1 + minMarginPercent/100) for COST_PLUS_MARGIN", () => {
      // cost = 100, margin = 5% → floor = 100 * 1.05 = 105
      // A price of exactly 105 should pass; 104.99 should fail.
      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.OWNER,
            requestedUnitPrice: new Prisma.Decimal(105),
            productCost: new Prisma.Decimal(100),
            salesConfig: makeSalesConfig({
              floorType: "COST_PLUS_MARGIN",
              minMarginPercent: 5,
            }),
          }),
        ),
      ).not.toThrow();

      expect(() =>
        validateItemPricing(
          makeItemInput({
            role: RoleType.OWNER,
            requestedUnitPrice: new Prisma.Decimal(104.99),
            productCost: new Prisma.Decimal(100),
            salesConfig: makeSalesConfig({
              floorType: "COST_PLUS_MARGIN",
              minMarginPercent: 5,
            }),
          }),
        ),
      ).toThrow(PriceBelowCostException);
    });
  });
});

describe("validateSalePricing", () => {
  const makeSaleInput = (
    overrides: Partial<ValidateSalePricingInput> = {},
  ): ValidateSalePricingInput => ({
    role: RoleType.CASHIER,
    totalDiscount: new Prisma.Decimal(0),
    subtotal: new Prisma.Decimal(1000),
    discountLimits: makeDiscountLimits(),
    ...overrides,
  });

  it("does not throw for the owner even with a discount well above the cap", () => {
    // Owner is special-cased and returns before any comparison.
    expect(() =>
      validateSalePricing(
        makeSaleInput({
          role: RoleType.OWNER,
          totalDiscount: new Prisma.Decimal(500),
          subtotal: new Prisma.Decimal(1000),
        }),
      ),
    ).not.toThrow();
  });

  it("does not throw when totalDiscount is 0 even if the global cap is 0", () => {
    expect(() =>
      validateSalePricing(
        makeSaleInput({
          role: RoleType.ACCOUNTANT, // globalMaxPercent = 0
          totalDiscount: new Prisma.Decimal(0),
          subtotal: new Prisma.Decimal(1000),
        }),
      ),
    ).not.toThrow();
  });

  it("does not throw when subtotal is 0 (avoids division by zero)", () => {
    expect(() =>
      validateSalePricing(
        makeSaleInput({
          role: RoleType.CASHIER,
          totalDiscount: new Prisma.Decimal(0),
          subtotal: new Prisma.Decimal(0),
        }),
      ),
    ).not.toThrow();
  });

  it("throws DiscountExceedsRoleLimitException with scope 'global' when cashier global% exceeds 5", () => {
    // 60 / 1000 = 6% > 5% (cashier.globalMaxPercent)
    expect(() =>
      validateSalePricing(
        makeSaleInput({
          role: RoleType.CASHIER,
          totalDiscount: new Prisma.Decimal(60),
          subtotal: new Prisma.Decimal(1000),
        }),
      ),
    ).toThrow(DiscountExceedsRoleLimitException);

    try {
      validateSalePricing(
        makeSaleInput({
          role: RoleType.CASHIER,
          totalDiscount: new Prisma.Decimal(60),
          subtotal: new Prisma.Decimal(1000),
        }),
      );
    } catch (err) {
      expect(err).toBeInstanceOf(DiscountExceedsRoleLimitException);
      const ex = err as DiscountExceedsRoleLimitException;
      expect(ex.scope).toBe("global");
      expect(ex.attemptedPercent).toBe(6);
      expect(ex.maxPercent).toBe(5);
      expect(ex.role).toBe(RoleType.CASHIER);
    }
  });

  it("does not throw when cashier global% is exactly at the cap (5%)", () => {
    // 50 / 1000 = 5% > 5% is false → no throw
    expect(() =>
      validateSalePricing(
        makeSaleInput({
          role: RoleType.CASHIER,
          totalDiscount: new Prisma.Decimal(50),
          subtotal: new Prisma.Decimal(1000),
        }),
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Sanity: this test file is pure — it never touches the Zustand store or
// the network.  A minimal store reset in beforeEach is included so the
// file is safe to run in any order against other test files that may
// mutate useLocalConfigStore as a side effect.
// ---------------------------------------------------------------------------

describe("store isolation", () => {
  beforeEach(() => {
    useLocalConfigStore.setState({
      discountLimits: makeDiscountLimits(),
      salesConfig: makeSalesConfig(),
    });
  });

  it("validateItemPricing does not read from the global store", () => {
    // If the function read from the store, mutating the store here
    // would affect the outcome.  It does not — all config is passed in
    // the input.  This test documents the contract.
    useLocalConfigStore.setState({
      discountLimits: {
        owner: { itemMaxPercent: 0, globalMaxPercent: 0 },
        manager: { itemMaxPercent: 0, globalMaxPercent: 0 },
        cashier: { itemMaxPercent: 0, globalMaxPercent: 0 },
        admin: { itemMaxPercent: 0, globalMaxPercent: 0 },
        inventoryAssistant: { itemMaxPercent: 0, globalMaxPercent: 0 },
        accountant: { itemMaxPercent: 0, globalMaxPercent: 0 },
      },
    });

    expect(() =>
      validateItemPricing(
        makeItemInput({
          role: RoleType.CASHIER,
          discountPercentage: 5, // 5 < cashier.itemMaxPercent=10 in the input
        }),
      ),
    ).not.toThrow();
  });
});
