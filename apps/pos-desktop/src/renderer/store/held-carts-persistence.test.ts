/**
 * Unit tests for held-cart persistence in localStorage.
 *
 * Covers the load/save contract of `held-carts-persistence.ts`: every bad
 * storage read must degrade to an empty list (the sales screen never crashes
 * on a corrupt write) and every save must be capped and fail silently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaleType } from "@pharmacy/shared-types";
import { loadHeldCarts, saveHeldCarts } from "./held-carts-persistence";
import type { CartItem, HeldCart } from "./slices/sales-types";

// Mirrors STORAGE_KEY in held-carts-persistence.ts.
const STORAGE_KEY = "pos-held-carts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cartItemFixture = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: "line-1",
  productId: "p-001",
  name: "Acetaminofén 500mg",
  invimaCertificate: "INVIMA-2025-001",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  lotCode: "LOT-A01",
  lotExpirationDate: "2027-06-01",
  unitPriceCents: 500_000,
  overrideUnitPriceCents: null,
  discountPercentage: null,
  costCents: null,
  taxPercentage: 19,
  quantity: 1,
  commissionType: null,
  commissionValue: null,
  commissionStartsAt: null,
  commissionEndsAt: null,
  ...overrides,
});

const heldCartFixture = (overrides: Partial<HeldCart> = {}): HeldCart => ({
  id: "held-1",
  savedAt: 1_700_000_000_000,
  items: [cartItemFixture()],
  selectedClient: null,
  delivery: null,
  ...overrides,
});

const manyCarts = (count: number): HeldCart[] =>
  Array.from({ length: count }, (_, index) =>
    heldCartFixture({ id: `held-${index}` }),
  );

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("loadHeldCarts", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns [] when the storage key is missing", () => {
    expect(loadHeldCarts()).toEqual([]);
  });

  it("returns [] when the stored value is not valid JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");

    expect(loadHeldCarts()).toEqual([]);
  });

  it("returns [] when the stored value is not an array", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ id: "held-1" }),
    );

    expect(loadHeldCarts()).toEqual([]);
  });

  it("returns [] when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(loadHeldCarts()).toEqual([]);
  });

  it("filters out entries that are not valid held carts", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        null,
        "held-1",
        { id: "held-1" },
        { id: "held-2", savedAt: "not-a-number", items: [] },
        { id: "held-3", savedAt: 1_700_000_000_000, items: "not-an-array" },
        heldCartFixture({ id: "held-4" }),
        heldCartFixture({ id: "held-5" }),
      ]),
    );

    expect(loadHeldCarts()).toEqual([
      heldCartFixture({ id: "held-4" }),
      heldCartFixture({ id: "held-5" }),
    ]);
  });

  it("caps the loaded list at 10, keeping the first carts", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(manyCarts(12)));

    const loaded = loadHeldCarts();

    expect(loaded).toHaveLength(10);
    expect(loaded.map((cart) => cart.id)).toEqual(
      manyCarts(10).map((cart) => cart.id),
    );
  });

  it("round-trips a saved list including the cart snapshot fields", () => {
    const carts = [
      heldCartFixture({
        id: "held-a",
        items: [
          cartItemFixture({
            id: "line-9",
            productId: "p-009",
            unitPriceCents: 12_000,
            lotCode: "LOT-B02",
          }),
        ],
      }),
      heldCartFixture({ id: "held-b", savedAt: 1_700_000_000_001 }),
    ];
    saveHeldCarts(carts);

    expect(loadHeldCarts()).toEqual(carts);
  });
});

describe("saveHeldCarts", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the JSON snapshot to localStorage", () => {
    const carts = [heldCartFixture()];

    saveHeldCarts(carts);

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(
      carts,
    );
  });

  it("caps the saved list at 10, keeping the first carts", () => {
    saveHeldCarts(manyCarts(12));

    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    ) as HeldCart[];

    expect(stored).toHaveLength(10);
    expect(stored.map((cart) => cart.id)).toEqual(
      manyCarts(10).map((cart) => cart.id),
    );
  });

  it("does not throw when localStorage.setItem fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => saveHeldCarts([heldCartFixture()])).not.toThrow();
  });
});