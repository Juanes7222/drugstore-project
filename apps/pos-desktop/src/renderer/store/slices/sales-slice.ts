/**
 * Redux Toolkit slice owning the active sale/cart state.
 *
 * Responsibilities:
 *   - Track line items, quantities, and selected lots.
 *   - Expose computed totals via selectors (subtotal, IVA 19%, grand total).
 *
 * The slice never imports the catalog implementation — it only receives
 * already-shaped CartItem objects from components/services.
 */
import { createSelector, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { CartItem, SalesState } from "./sales-types";

const TAX_RATE = 0.19;

const initialState: SalesState = {
  items: [],
};

export const salesSlice = createSlice({
  name: "sales",
  initialState,
  reducers: {
    addItem: (state, action: PayloadAction<CartItem>) => {
      const incoming = action.payload;
      const existing = state.items.find((item) => item.id === incoming.id);

      if (existing) {
        existing.quantity += incoming.quantity;
      } else {
        state.items.push(incoming);
      }
    },

    removeItem: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      state.items = state.items.filter((item) => item.id !== id);
    },

    updateQuantity: (
      state,
      action: PayloadAction<{ id: string; quantity: number }>,
    ) => {
      const { id, quantity } = action.payload;
      const item = state.items.find((cartItem) => cartItem.id === id);

      if (!item) {
        return;
      }

      if (quantity <= 0) {
        state.items = state.items.filter((cartItem) => cartItem.id !== id);
      } else {
        item.quantity = quantity;
      }
    },

    clearCart: (state) => {
      state.items = [];
    },
  },
});

export const { addItem, removeItem, updateQuantity, clearCart } =
  salesSlice.actions;

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

export const selectSubtotalCents = createSelector(
  [selectCartItems],
  (items) =>
    items.reduce(
      (sum, item) => sum + item.unitPriceCents * item.quantity,
      0,
    ),
);

export const selectTaxCents = createSelector(
  [selectSubtotalCents],
  (subtotal) => Math.round(subtotal * TAX_RATE),
);

export const selectTotalCents = createSelector(
  [selectSubtotalCents, selectTaxCents],
  (subtotal, tax) => subtotal + tax,
);
