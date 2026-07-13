/**
 * Unit tests for the sales slice and its selectors.
 */
import { describe, expect, it } from "vitest";
import {
  addItem,
  clearCart,
  removeItem,
  salesSlice,
  selectCartItemCount,
  selectCartItems,
  selectSubtotalCents,
  selectTaxCents,
  selectTotalCents,
  updateQuantity,
} from "./sales-slice";
import { CartItem } from "./sales-types";
import { SaleType } from "@pharmacy/shared-types";

const baseItem = (
  overrides: Partial<CartItem> = {},
): CartItem => ({
  id: "line-1",
  productId: "p-001",
  name: "Paracetamol 500mg",
  genericName: "Paracetamol",
  invimaCertificate: "INVIMA-2025-001",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  lotCode: "LOT-A01",
  lotExpirationDate: "2027-06-01",
  unitPriceCents: 500_000,
  taxPercentage: 19,
  quantity: 1,
  ...overrides,
});

interface RootState {
  sales: { items: CartItem[] };
}

const buildRoot = (items: CartItem[]): RootState => ({
  sales: { items },
});

describe("sales slice — reducers", () => {
  it("starts with an empty cart", () => {
    const state = salesSlice.reducer(
      salesSlice.getInitialState(),
      { type: "unknown" },
    );

    expect(state.items).toEqual([]);
  });

  it("addItem pushes a new item into the cart", () => {
    const item = baseItem();
    const state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(item),
    );

    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.id).toBe("line-1");
    expect(state.items[0]?.quantity).toBe(1);
  });

  it("addItem merges quantity when an item with the same id already exists", () => {
    const item = baseItem();
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(item),
    );

    state = salesSlice.reducer(state, addItem(item));

    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.quantity).toBe(2);
  });

  it("addItem creates separate entries when ids differ", () => {
    const first = baseItem({ id: "line-1", productId: "p-001" });
    const second = baseItem({ id: "line-2", productId: "p-002" });

    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(first),
    );
    state = salesSlice.reducer(state, addItem(second));

    expect(state.items).toHaveLength(2);
  });

  it("removeItem deletes the matching line by id", () => {
    const item = baseItem({ id: "line-1" });
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(item),
    );

    state = salesSlice.reducer(state, removeItem("line-1"));

    expect(state.items).toEqual([]);
  });

  it("removeItem is a no-op when the id does not exist", () => {
    const item = baseItem({ id: "line-1" });
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(item),
    );

    state = salesSlice.reducer(state, removeItem("nonexistent"));

    expect(state.items).toHaveLength(1);
  });

  it("updateQuantity changes the quantity of an existing item", () => {
    const item = baseItem({ id: "line-1", quantity: 1 });
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(item),
    );

    state = salesSlice.reducer(
      state,
      updateQuantity({ id: "line-1", quantity: 5 }),
    );

    expect(state.items[0]?.quantity).toBe(5);
  });

  it("updateQuantity with zero removes the item", () => {
    const item = baseItem({ id: "line-1", quantity: 3 });
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(item),
    );

    state = salesSlice.reducer(
      state,
      updateQuantity({ id: "line-1", quantity: 0 }),
    );

    expect(state.items).toEqual([]);
  });

  it("updateQuantity with negative value removes the item", () => {
    const item = baseItem({ id: "line-1", quantity: 3 });
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(item),
    );

    state = salesSlice.reducer(
      state,
      updateQuantity({ id: "line-1", quantity: -1 }),
    );

    expect(state.items).toEqual([]);
  });

  it("updateQuantity is a no-op when the id does not exist", () => {
    const state = salesSlice.reducer(
      salesSlice.getInitialState(),
      updateQuantity({ id: "nonexistent", quantity: 5 }),
    );

    expect(state.items).toEqual([]);
  });

  it("clearCart empties the items array", () => {
    const first = baseItem({ id: "line-1" });
    const second = baseItem({ id: "line-2" });
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(first),
    );
    state = salesSlice.reducer(state, addItem(second));

    state = salesSlice.reducer(state, clearCart());

    expect(state.items).toEqual([]);
  });
});

describe("sales selectors", () => {
  it("selectCartItems returns the raw items array", () => {
    const items = [baseItem({ id: "a" }), baseItem({ id: "b" })];
    const root = buildRoot(items);

    expect(selectCartItems(root)).toEqual(items);
  });

  it("selectCartItemCount sums quantities across all items", () => {
    const root = buildRoot([
      baseItem({ id: "a", quantity: 2 }),
      baseItem({ id: "b", quantity: 3 }),
    ]);

    expect(selectCartItemCount(root)).toBe(5);
  });

  it("selectCartItemCount returns 0 for an empty cart", () => {
    const root = buildRoot([]);

    expect(selectCartItemCount(root)).toBe(0);
  });

  it("selectSubtotalCents computes unitPrice * quantity for one item", () => {
    const root = buildRoot([
      baseItem({ id: "a", unitPriceCents: 100_000, quantity: 1 }),
    ]);

    expect(selectSubtotalCents(root)).toBe(100_000);
  });

  it("selectSubtotalCents accumulates across multiple items", () => {
    const root = buildRoot([
      baseItem({ id: "a", unitPriceCents: 100_000, quantity: 2 }),
      baseItem({ id: "b", unitPriceCents: 50_000, quantity: 3 }),
    ]);

    // (100_000 * 2) + (50_000 * 3) = 200_000 + 150_000 = 350_000
    expect(selectSubtotalCents(root)).toBe(350_000);
  });

  it("selectSubtotalCents is 0 for an empty cart", () => {
    const root = buildRoot([]);
    expect(selectSubtotalCents(root)).toBe(0);
  });

  it("selectTaxCents computes 19% of the subtotal, rounded", () => {
    const root = buildRoot([
      baseItem({ id: "a", unitPriceCents: 100_000, quantity: 1 }),
    ]);

    expect(selectTaxCents(root)).toBe(19_000);
  });

  it("selectTaxCents rounds the result", () => {
    // 100 cents * 0.19 = 19 — exact, no rounding needed, but ensure
    // Math.round is applied for fractional cases.
    const root = buildRoot([
      baseItem({ id: "a", unitPriceCents: 101, quantity: 1 }),
    ]);

    expect(selectTaxCents(root)).toBe(19); // 101 * 0.19 = 19.19 → 19
  });

  it("selectTaxCents is 0 when subtotal is 0", () => {
    const root = buildRoot([]);
    expect(selectTaxCents(root)).toBe(0);
  });

  it("selectTotalCents is subtotal + tax", () => {
    const root = buildRoot([
      baseItem({ id: "a", unitPriceCents: 100_000, quantity: 1 }),
    ]);

    // subtotal = 100_000, tax = 19_000, total = 119_000
    expect(selectTotalCents(root)).toBe(119_000);
  });

  it("selectTotalCents is 0 for an empty cart", () => {
    const root = buildRoot([]);
    expect(selectTotalCents(root)).toBe(0);
  });
});
