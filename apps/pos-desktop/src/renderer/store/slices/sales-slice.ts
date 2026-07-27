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
  SalesState,
  SelectedClient,
} from "./sales-types";

const initialState: SalesState = {
  items: [],
  selectedClient: null,
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

    setClient: (state, action: PayloadAction<SelectedClient | null>) => {
      state.selectedClient = action.payload;
    },

    clearCart: (state) => {
      state.items = [];
      state.selectedClient = null;
    },
  },
});

export const { addItem, removeItem, updateQuantity, clearCart, setClient } =
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

/**
 * Tax in cents, computed per cart item using each item's own taxPercentage.
 *
 * taxPercentage is an integer percentage (e.g. 19 for 19%, 5 for 5%, 0 for exempt).
 * Items without a taxPercentage are treated as exempt (0%).
 */
export const selectTaxCents = createSelector(
  [selectCartItems],
  (items) =>
    items.reduce((sum, item) => {
      const taxRate = (item.taxPercentage ?? 0) / 100;
      const itemTotal = item.unitPriceCents * item.quantity;
      return sum + Math.round(itemTotal * taxRate);
    }, 0),
);

export const selectTotalCents = createSelector(
  [selectSubtotalCents, selectTaxCents],
  (subtotal, tax) => subtotal + tax,
);

export const selectSelectedClient = createSelector(
  [selectSalesState],
  (sales) => sales.selectedClient,
);

export const selectEffectiveClient = createSelector(
  [selectSelectedClient],
  (selected) => selected ?? GENERIC_CLIENT,
);
