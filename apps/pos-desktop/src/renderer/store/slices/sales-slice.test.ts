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
  selectDeliveryFeeCents,
  selectGrandTotalCents,
  selectSelectedLineId,
  selectSubtotalCents,
  selectTaxCents,
  selectTotalCents,
  selectUndoAvailable,
  setDelivery,
  setSelectedLine,
  undoLastChange,
  updateItemDiscount,
  updateItemPrice,
  updateQuantity,
} from "./sales-slice";
import { CartItem, SaleDeliveryDraft, SelectedClient } from "./sales-types";
import { SaleType } from "@pharmacy/shared-types";

const baseItem = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: "line-1",
  productId: "p-001",
  name: "Paracetamol 500mg",
  invimaCertificate: "INVIMA-2025-001",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  lotCode: "LOT-A01",
  lotExpirationDate: "2027-06-01",
  unitPriceCents: 500_000,
  taxPercentage: 19,
  quantity: 1,
  overrideUnitPriceCents: null,
  discountPercentage: null,
  costCents: null,
  commissionType: null,
  commissionValue: null,
  commissionStartsAt: null,
  commissionEndsAt: null,
  ...overrides,
});

interface RootState {
  sales: {
    items: CartItem[];
    selectedClient: SelectedClient | null;
    delivery: SaleDeliveryDraft | null;
    selectedLineId: string | null;
    undoStack: CartItem[][];
  };
}

const buildRoot = (items: CartItem[]): RootState => ({
  sales: {
    items,
    selectedClient: null,
    delivery: null,
    selectedLineId: null,
    undoStack: [],
  },
});

const deliveryDraft = (
  overrides: Partial<SaleDeliveryDraft> = {},
): SaleDeliveryDraft => ({
  state: "PENDING",
  address: "Calle 10 #20-30",
  contactName: "Juan Pérez",
  contactPhone: "5551234",
  notes: null,
  scheduledAt: null,
  feeCents: 5_000,
  ...overrides,
});

describe("sales slice — reducers", () => {
  it("starts with an empty cart", () => {
    const state = salesSlice.reducer(salesSlice.getInitialState(), {
      type: "unknown",
    });

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
    let state = salesSlice.reducer(salesSlice.getInitialState(), addItem(item));

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
    let state = salesSlice.reducer(salesSlice.getInitialState(), addItem(item));

    state = salesSlice.reducer(state, removeItem("line-1"));

    expect(state.items).toEqual([]);
  });

  it("removeItem is a no-op when the id does not exist", () => {
    const item = baseItem({ id: "line-1" });
    let state = salesSlice.reducer(salesSlice.getInitialState(), addItem(item));

    state = salesSlice.reducer(state, removeItem("nonexistent"));

    expect(state.items).toHaveLength(1);
  });

  it("updateQuantity changes the quantity of an existing item", () => {
    const item = baseItem({ id: "line-1", quantity: 1 });
    let state = salesSlice.reducer(salesSlice.getInitialState(), addItem(item));

    state = salesSlice.reducer(
      state,
      updateQuantity({ id: "line-1", quantity: 5 }),
    );

    expect(state.items[0]?.quantity).toBe(5);
  });

  it("updateQuantity with zero removes the item", () => {
    const item = baseItem({ id: "line-1", quantity: 3 });
    let state = salesSlice.reducer(salesSlice.getInitialState(), addItem(item));

    state = salesSlice.reducer(
      state,
      updateQuantity({ id: "line-1", quantity: 0 }),
    );

    expect(state.items).toEqual([]);
  });

  it("updateQuantity with negative value removes the item", () => {
    const item = baseItem({ id: "line-1", quantity: 3 });
    let state = salesSlice.reducer(salesSlice.getInitialState(), addItem(item));

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

  it("setDelivery stores the delivery draft on the sale", () => {
    const draft = deliveryDraft();

    const state = salesSlice.reducer(
      salesSlice.getInitialState(),
      setDelivery(draft),
    );

    expect(state.delivery).toEqual(draft);
  });

  it("setDelivery with null clears any existing draft", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      setDelivery(deliveryDraft()),
    );

    state = salesSlice.reducer(state, setDelivery(null));

    expect(state.delivery).toBeNull();
  });

  it("setDelivery clamps a negative fee to 0", () => {
    const state = salesSlice.reducer(
      salesSlice.getInitialState(),
      setDelivery(deliveryDraft({ feeCents: -2_000 })),
    );

    expect(state.delivery?.feeCents).toBe(0);
  });

  it("setDelivery rounds a fractional fee to whole cents", () => {
    const state = salesSlice.reducer(
      salesSlice.getInitialState(),
      setDelivery(deliveryDraft({ feeCents: 1_234.56 })),
    );

    expect(state.delivery?.feeCents).toBe(1_235);
  });

  it("clearCart resets the delivery draft", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );
    state = salesSlice.reducer(state, setDelivery(deliveryDraft()));

    state = salesSlice.reducer(state, clearCart());

    expect(state.items).toEqual([]);
    expect(state.selectedClient).toBeNull();
    expect(state.delivery).toBeNull();
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

  it("applies per-item discounts to subtotal and tax, matching the DB service", () => {
    // 100_000 at 15% → line 85_000, tax 19% on the discounted base = 16_150
    const root = buildRoot([
      baseItem({
        id: "a",
        unitPriceCents: 100_000,
        quantity: 1,
        discountPercentage: 15,
      }),
    ]);

    expect(selectSubtotalCents(root)).toBe(85_000);
    expect(selectTaxCents(root)).toBe(16_150);
    expect(selectTotalCents(root)).toBe(101_150);
    expect(selectGrandTotalCents(root)).toBe(101_150);
  });

  it("rounds per-item tax to the cent like the DB service (ROUND_HALF_UP)", () => {
    // 2 450 × 19% = 465.5 exact → the UI rounds to 466, so the charged
    // total (2 916) must match what the service stores for credit payments.
    const root = buildRoot([
      baseItem({ id: "a", unitPriceCents: 2_450, quantity: 1 }),
    ]);

    expect(selectTaxCents(root)).toBe(466);
    expect(selectTotalCents(root)).toBe(2_916);
  });

  it("selectDeliveryFeeCents returns 0 when there is no delivery", () => {
    const root = buildRoot([baseItem()]);

    expect(selectDeliveryFeeCents(root)).toBe(0);
  });

  it("selectDeliveryFeeCents returns the draft fee when a delivery is set", () => {
    const root: RootState = {
      sales: {
        items: [],
        selectedClient: null,
        delivery: deliveryDraft({ feeCents: 7_500 }),
        selectedLineId: null,
        undoStack: [],
      },
    };

    expect(selectDeliveryFeeCents(root)).toBe(7_500);
  });

  it("selectGrandTotalCents is the item total when there is no fee", () => {
    const root = buildRoot([
      baseItem({ id: "a", unitPriceCents: 100_000, quantity: 1 }),
    ]);

    // subtotal = 100_000, tax = 19_000, total = 119_000, no fee
    expect(selectGrandTotalCents(root)).toBe(119_000);
  });

  it("selectGrandTotalCents adds the delivery fee to the item total", () => {
    const root: RootState = {
      sales: {
        items: [baseItem({ id: "a", unitPriceCents: 100_000, quantity: 1 })],
        selectedClient: null,
        delivery: deliveryDraft({ feeCents: 5_000 }),
        selectedLineId: null,
        undoStack: [],
      },
    };

    // total = 119_000, fee = 5_000 → 124_000
    expect(selectGrandTotalCents(root)).toBe(124_000);
  });
});

describe("sales slice — line selection", () => {
  it("addItem selects the incoming line", () => {
    const state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );

    expect(state.selectedLineId).toBe("line-1");
  });

  it("addItem keeps the merged line selected when quantities merge", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );

    state = salesSlice.reducer(state, addItem(baseItem({ id: "line-1" })));

    expect(state.items).toHaveLength(1);
    expect(state.selectedLineId).toBe("line-1");
  });

  it("removeItem clears the selection when the selected line is removed", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );
    state = salesSlice.reducer(state, addItem(baseItem({ id: "line-2" })));
    state = salesSlice.reducer(state, setSelectedLine("line-1"));

    state = salesSlice.reducer(state, removeItem("line-1"));

    expect(state.selectedLineId).toBeNull();
  });

  it("removeItem keeps the selection when a different line is removed", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );
    state = salesSlice.reducer(state, addItem(baseItem({ id: "line-2" })));
    state = salesSlice.reducer(state, setSelectedLine("line-1"));

    state = salesSlice.reducer(state, removeItem("line-2"));

    expect(state.selectedLineId).toBe("line-1");
  });

  it("updateQuantity with zero clears the selection when it matches", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1", quantity: 3 })),
    );
    state = salesSlice.reducer(state, setSelectedLine("line-1"));

    state = salesSlice.reducer(
      state,
      updateQuantity({ id: "line-1", quantity: 0 }),
    );

    expect(state.items).toEqual([]);
    expect(state.selectedLineId).toBeNull();
  });

  it("updateQuantity with a positive value keeps the selection", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1", quantity: 3 })),
    );
    state = salesSlice.reducer(state, setSelectedLine("line-1"));

    state = salesSlice.reducer(
      state,
      updateQuantity({ id: "line-1", quantity: 5 }),
    );

    expect(state.items[0]?.quantity).toBe(5);
    expect(state.selectedLineId).toBe("line-1");
  });

  it("clearCart clears the selection", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );
    state = salesSlice.reducer(state, setSelectedLine("line-1"));

    state = salesSlice.reducer(state, clearCart());

    expect(state.items).toEqual([]);
    expect(state.selectedLineId).toBeNull();
  });

  it("setSelectedLine stores the given line id", () => {
    const state = salesSlice.reducer(
      salesSlice.getInitialState(),
      setSelectedLine("line-1"),
    );

    expect(state.selectedLineId).toBe("line-1");
  });

  it("setSelectedLine with null clears the selection", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      setSelectedLine("line-1"),
    );

    state = salesSlice.reducer(state, setSelectedLine(null));

    expect(state.selectedLineId).toBeNull();
  });

  it("selectSelectedLineId returns the selected line id", () => {
    const root = buildRoot([baseItem()]);
    root.sales.selectedLineId = "line-1";

    expect(selectSelectedLineId(root)).toBe("line-1");
  });

  it("selectSelectedLineId returns null when nothing is selected", () => {
    expect(selectSelectedLineId(buildRoot([baseItem()]))).toBeNull();
  });
});

describe("sales slice — undo stack", () => {
  it("addItem pushes a snapshot of the pre-mutation cart", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );

    expect(state.undoStack).toEqual([[]]);

    state = salesSlice.reducer(state, addItem(baseItem({ id: "line-2" })));

    expect(state.undoStack).toHaveLength(2);
    expect(state.undoStack.at(-1)).toEqual([baseItem({ id: "line-1" })]);
  });

  it("removeItem pushes an undo snapshot", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );

    state = salesSlice.reducer(state, removeItem("line-1"));

    expect(state.undoStack).toHaveLength(2);
  });

  it("updateQuantity pushes an undo snapshot", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );

    state = salesSlice.reducer(
      state,
      updateQuantity({ id: "line-1", quantity: 5 }),
    );

    expect(state.undoStack).toHaveLength(2);
  });

  it("updateItemPrice pushes an undo snapshot", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );

    state = salesSlice.reducer(
      state,
      updateItemPrice({ id: "line-1", unitPriceCents: 10_000 }),
    );

    expect(state.undoStack).toHaveLength(2);
  });

  it("updateItemDiscount pushes an undo snapshot", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );

    state = salesSlice.reducer(
      state,
      updateItemDiscount({ id: "line-1", discountPercentage: 10 }),
    );

    expect(state.undoStack).toHaveLength(2);
  });

  it("clearCart pushes an undo snapshot", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );

    state = salesSlice.reducer(state, clearCart());

    expect(state.undoStack).toHaveLength(2);
  });

  it("undoLastChange restores the previous items and clears the selection", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );
    state = salesSlice.reducer(state, addItem(baseItem({ id: "line-2" })));
    expect(state.selectedLineId).toBe("line-2");

    state = salesSlice.reducer(state, undoLastChange());

    expect(state.items).toEqual([baseItem({ id: "line-1" })]);
    expect(state.selectedLineId).toBeNull();
  });

  it("undoLastChange restores the pre-merge quantities of a merged line", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1", quantity: 1 })),
    );
    state = salesSlice.reducer(
      state,
      addItem(baseItem({ id: "line-1", quantity: 2 })),
    );
    expect(state.items[0]?.quantity).toBe(3);

    state = salesSlice.reducer(state, undoLastChange());

    expect(state.items).toEqual([baseItem({ id: "line-1", quantity: 1 })]);
  });

  it("undoLastChange restores a removed line", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );
    state = salesSlice.reducer(state, addItem(baseItem({ id: "line-2" })));
    state = salesSlice.reducer(state, removeItem("line-1"));

    state = salesSlice.reducer(state, undoLastChange());

    expect(state.items).toEqual([
      baseItem({ id: "line-1" }),
      baseItem({ id: "line-2" }),
    ]);
  });

  it("undoLastChange is a no-op when the stack is empty", () => {
    const state = salesSlice.reducer(
      salesSlice.getInitialState(),
      undoLastChange(),
    );

    expect(state.items).toEqual([]);
    expect(state.undoStack).toEqual([]);
  });

  it("undoLastChange keeps the stack empty after the last snapshot is popped", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );

    state = salesSlice.reducer(state, undoLastChange());

    expect(state.items).toEqual([]);
    expect(state.undoStack).toEqual([]);
  });

  it("caps the undo stack at 20 snapshots and drops the oldest", () => {
    const item = baseItem({ id: "line-1" });
    let state = salesSlice.getInitialState();
    // 21 mutations; the first snapshot (the empty cart) must be the one dropped.
    Array.from({ length: 21 }, () => item).forEach((line) => {
      state = salesSlice.reducer(state, addItem(line));
    });

    expect(state.undoStack).toHaveLength(20);
    expect(state.items[0]?.quantity).toBe(21);

    // Popping 20 snapshots lands back on the state after the first mutation.
    for (let i = 0; i < 20; i += 1) {
      state = salesSlice.reducer(state, undoLastChange());
    }
    expect(state.items[0]?.quantity).toBe(1);

    // A 21st pop is a no-op — the stack is already exhausted.
    state = salesSlice.reducer(state, undoLastChange());
    expect(state.items[0]?.quantity).toBe(1);
  });

  it("selectUndoAvailable reflects a non-empty undo stack", () => {
    expect(selectUndoAvailable(buildRoot([]))).toBe(false);

    const root = buildRoot([]);
    root.sales.undoStack = [[]];
    expect(selectUndoAvailable(root)).toBe(true);
  });

  it("updateItemDiscount clamps the percentage to the 0–100 range", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );

    state = salesSlice.reducer(
      state,
      updateItemDiscount({ id: "line-1", discountPercentage: 150 }),
    );
    expect(state.items[0]?.discountPercentage).toBe(100);

    state = salesSlice.reducer(
      state,
      updateItemDiscount({ id: "line-1", discountPercentage: -5 }),
    );
    expect(state.items[0]?.discountPercentage).toBe(0);

    state = salesSlice.reducer(
      state,
      updateItemDiscount({ id: "line-1", discountPercentage: null }),
    );
    expect(state.items[0]?.discountPercentage).toBeNull();
  });

  it("updateItemPrice clamps a negative price to zero", () => {
    let state = salesSlice.reducer(
      salesSlice.getInitialState(),
      addItem(baseItem({ id: "line-1" })),
    );

    state = salesSlice.reducer(
      state,
      updateItemPrice({ id: "line-1", unitPriceCents: -100 }),
    );

    expect(state.items[0]?.unitPriceCents).toBe(0);
    expect(state.items[0]?.overrideUnitPriceCents).toBe(0);
  });
});
