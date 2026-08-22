/**
 * Redux Toolkit slice owning the active sale/cart state.
 *
 * Responsibilities:
 *   - Track line items, quantities, and selected lots.
 *   - Expose computed totals via selectors (subtotal, IVA per product rate, grand total).
 *
 * Tax is computed per cart item using each item's `taxPercentage` field (e.g. 19, 5, 0)
 * rather than a flat rate, so exempt items (EXENTO, 0%) and reduced-rate items (5%, 8%)
 * are correctly reflected in the total.
 *
 * The slice never imports the catalog implementation — it only receives
 * already-shaped CartItem objects from components/services.
 */
import { createSelector, createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  CartItem,
  GENERIC_CLIENT,
  SaleDeliveryDraft,
  SalesState,
  SelectedClient,
} from "./sales-types";

const initialState: SalesState = {
  items: [],
  selectedClient: null,
  delivery: null,
  selectedLineId: null,
  undoStack: [],
  heldCarts: [],
};

/** Max number of cart snapshots kept for Ctrl+Z undo. */
const UNDO_LIMIT = 20;

/**
 * Clone the current cart items into the undo stack.
 *
 * Must be called BEFORE the mutation. Immer copy-on-write means the shallow
 * clones captured here keep the pre-mutation values, so restoring them later
 * yields exactly the previous cart. Items are flat objects (no nesting), so
 * a shallow spread is a full clone.
 */
function pushUndo(state: SalesState): void {
  state.undoStack.push(state.items.map((item) => ({ ...item })));
  if (state.undoStack.length > UNDO_LIMIT) {
    state.undoStack.shift();
  }
}

export const salesSlice = createSlice({
  name: "sales",
  initialState,
  reducers: {
    addItem: (state, action: PayloadAction<CartItem>) => {
      pushUndo(state);
      const incoming = action.payload;
      const existing = state.items.find((item) => item.id === incoming.id);

      if (existing) {
        existing.quantity += incoming.quantity;
      } else {
        state.items.push(incoming);
      }
      // Keep the newly added line selected so the cashier can adjust it
      // (quantity, discount, price) without reaching for the mouse.
      state.selectedLineId = incoming.id;
    },

    removeItem: (state, action: PayloadAction<string>) => {
      pushUndo(state);
      const id = action.payload;
      state.items = state.items.filter((item) => item.id !== id);
      if (state.selectedLineId === id) {
        state.selectedLineId = null;
      }
    },

    updateQuantity: (
      state,
      action: PayloadAction<{ id: string; quantity: number }>,
    ) => {
      pushUndo(state);
      const { id, quantity } = action.payload;
      const item = state.items.find((cartItem) => cartItem.id === id);

      if (!item) {
        return;
      }

      if (quantity <= 0) {
        state.items = state.items.filter((cartItem) => cartItem.id !== id);
        if (state.selectedLineId === id) {
          state.selectedLineId = null;
        }
      } else {
        item.quantity = quantity;
      }
    },

    /**
     * Override the unit price of a cart item.
     * Sets both `unitPriceCents` (effective) and `overrideUnitPriceCents`
     * (marker) so the downstream service can distinguish a manual override
     * from the original catalog price.
     */
    updateItemPrice: (
      state,
      action: PayloadAction<{ id: string; unitPriceCents: number }>,
    ) => {
      pushUndo(state);
      const { id, unitPriceCents } = action.payload;
      const item = state.items.find((cartItem) => cartItem.id === id);
      if (!item) return;

      item.unitPriceCents = Math.max(0, unitPriceCents);
      item.overrideUnitPriceCents = Math.max(0, unitPriceCents);
    },

    /**
     * Set or clear the discount percentage on a cart item.
     * `discountPercentage` is clamped to [0, 100]; null clears the discount.
     * Does NOT change `unitPriceCents` — the discount is additive at the
     * service level.
     */
    updateItemDiscount: (
      state,
      action: PayloadAction<{
        id: string;
        discountPercentage: number | null;
      }>,
    ) => {
      pushUndo(state);
      const { id, discountPercentage } = action.payload;
      const item = state.items.find((cartItem) => cartItem.id === id);
      if (!item) return;

      item.discountPercentage =
        discountPercentage !== null
          ? Math.max(0, Math.min(100, discountPercentage))
          : null;
    },

    setClient: (state, action: PayloadAction<SelectedClient | null>) => {
      state.selectedClient = action.payload;
    },

    /**
     * Set or replace the delivery (domicilio) draft attached to the sale.
     * Passing null clears it and makes the sale a regular in-store sale.
     */
    setDelivery: (
      state,
      action: PayloadAction<SaleDeliveryDraft | null>,
    ) => {
      const draft = action.payload;
      state.delivery = draft
        ? { ...draft, feeCents: Math.max(0, Math.round(draft.feeCents)) }
        : null;
    },

    clearCart: (state) => {
      pushUndo(state);
      state.items = [];
      state.selectedClient = null;
      state.delivery = null;
      state.selectedLineId = null;
    },

    /** Select the cart line the keyboard acts on. Null clears the selection. */
    setSelectedLine: (state, action: PayloadAction<string | null>) => {
      state.selectedLineId = action.payload;
    },

    /**
     * Restore the cart to the state before the last mutation (Ctrl+Z).
     * Line-level undo only — client and delivery drafts are left untouched.
     */
    undoLastChange: (state) => {
      const previous = state.undoStack.pop();
      if (!previous) return;
      state.items = previous;
      state.selectedLineId = null;
    },

    /**
     * Set the active cart aside (F8) and start a fresh one. No-op when the
     * cart is already empty. The held cart keeps items, client, and delivery
     * drafts; it is session-only state and does not touch the undo stack —
     * the way back is `recallHeldCart`, not Ctrl+Z.
     */
    holdCart: (
      state,
      action: PayloadAction<{ id: string; savedAt: number }>,
    ) => {
      if (state.items.length === 0) return;
      const { id, savedAt } = action.payload;
      state.heldCarts.push({
        id,
        savedAt,
        items: state.items.map((item) => ({ ...item })),
        selectedClient: state.selectedClient,
        delivery: state.delivery,
      });
      state.items = [];
      state.selectedClient = null;
      state.delivery = null;
      state.selectedLineId = null;
    },

    /**
     * Restore a held cart (F8 on an empty cart recalls the most recent one).
     * Pass an id to recall a specific cart; without one, the newest held
     * cart is recalled. The recalled cart is removed from the held list.
     */
    recallHeldCart: (state, action: PayloadAction<string | undefined>) => {
      const index = action.payload
        ? state.heldCarts.findIndex((held) => held.id === action.payload)
        : state.heldCarts.length - 1;
      if (index < 0) return;
      const [held] = state.heldCarts.splice(index, 1);
      state.items = held.items;
      state.selectedClient = held.selectedClient;
      state.delivery = held.delivery;
      state.selectedLineId = null;
    },

    /** Drop a held cart without recalling it. */
    discardHeldCart: (state, action: PayloadAction<string>) => {
      state.heldCarts = state.heldCarts.filter(
        (held) => held.id !== action.payload,
      );
    },
  },
});

export const {
  addItem,
  removeItem,
  updateQuantity,
  updateItemPrice,
  updateItemDiscount,
  clearCart,
  setClient,
  setDelivery,
  setSelectedLine,
  undoLastChange,
  holdCart,
  recallHeldCart,
  discardHeldCart,
} = salesSlice.actions;

/* ------------------------------------------------------------------ */
/* Selectors                                                          */
/* ------------------------------------------------------------------ */

const selectSalesState = (state: { sales: SalesState }): SalesState =>
  state.sales;

export const selectCartItems = createSelector(
  [selectSalesState],
  (sales) => sales.items,
);

export const selectCartItemCount = createSelector(
  [selectCartItems],
  (items) => items.reduce((sum, item) => sum + item.quantity, 0),
);

/**
 * Per-item money math, mirroring the domain sale service so the totals the
 * cashier sees are exactly what the DB records and the payment screen
 * charges:
 *   - discount = round(subtotal × pct / 100) to the cent
 *   - line total = subtotal − discount
 *   - tax = round(line total × rate / 100) to the cent
 *
 * The service applies the same per-item centavos rounding (ROUND_HALF_UP),
 * so the frontend total can never drift from sale.totalAmount — a drift of
 * a cent or more made credit-only payments look overpaid and threw
 * ChangeRequiresCashPaymentException at confirm time.
 */
function computeCartItemMoney(item: CartItem): {
  lineTotalCents: number;
  taxCents: number;
} {
  const subtotalCents = item.unitPriceCents * item.quantity;
  const discountCents = Math.round(
    (subtotalCents * (item.discountPercentage ?? 0)) / 100,
  );
  const lineTotalCents = subtotalCents - discountCents;
  const taxRate = (item.taxPercentage ?? 0) / 100;
  return {
    lineTotalCents,
    taxCents: Math.round(lineTotalCents * taxRate),
  };
}

/**
 * Subtotal in cents after per-item discounts.
 *
 * Mirrors the DB line totals (subtotal minus the per-item discount, rounded
 * to the cent), so the displayed subtotal stays consistent with the lines
 * and with the charged total.
 */
export const selectSubtotalCents = createSelector(
  [selectCartItems],
  (items) =>
    items.reduce(
      (sum, item) => sum + computeCartItemMoney(item).lineTotalCents,
      0,
    ),
);

/**
 * Tax in cents, computed per cart item on the discounted line total.
 *
 * taxPercentage is an integer percentage (e.g. 19 for 19%, 5 for 5%, 0 for exempt).
 * Items without a taxPercentage are treated as exempt (0%).
 */
export const selectTaxCents = createSelector(
  [selectCartItems],
  (items) =>
    items.reduce(
      (sum, item) => sum + computeCartItemMoney(item).taxCents,
      0,
    ),
);

export const selectTotalCents = createSelector(
  [selectCartItems],
  (items) =>
    items.reduce(
      (sum, item) => {
        const money = computeCartItemMoney(item);
        return sum + money.lineTotalCents + money.taxCents;
      },
      0,
    ),
);

export const selectSelectedClient = createSelector(
  [selectSalesState],
  (sales) => sales.selectedClient,
);

export const selectSelectedLineId = createSelector(
  [selectSalesState],
  (sales) => sales.selectedLineId,
);

export const selectUndoAvailable = createSelector(
  [selectSalesState],
  (sales) => sales.undoStack.length > 0,
);

export const selectHeldCarts = createSelector(
  [selectSalesState],
  (sales) => sales.heldCarts,
);

export const selectHasHeldCarts = createSelector(
  [selectHeldCarts],
  (heldCarts) => heldCarts.length > 0,
);

export const selectEffectiveClient = createSelector(
  [selectSelectedClient],
  (selected) => selected ?? GENERIC_CLIENT,
);

export const selectDeliveryDraft = createSelector(
  [selectSalesState],
  (sales) => sales.delivery,
);

/**
 * Delivery fee in cents for the active sale. 0 when the sale is not a
 * domicilio or the tenant charges no fee.
 */
export const selectDeliveryFeeCents = createSelector(
  [selectDeliveryDraft],
  (delivery) => delivery?.feeCents ?? 0,
);

/**
 * Total due including any delivery fee. This is the amount the customer
 * actually pays and the number payment captures/validates against.
 */
export const selectGrandTotalCents = createSelector(
  [selectTotalCents, selectDeliveryFeeCents],
  (total, deliveryFee) => total + deliveryFee,
);
