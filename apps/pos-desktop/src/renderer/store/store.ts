/**
 * Redux store configuration — Pharmacy POS Terminal.
 */
import { configureStore } from "@reduxjs/toolkit";
import { salesSlice } from "./slices/sales-slice";
import { paymentSlice } from "./slices/payment-slice";
import { uiSlice } from "./slices/ui-slice";
import { offlineAuthSlice } from "./slices/offline-auth-slice";
import { loadHeldCarts, saveHeldCarts } from "./held-carts-persistence";

export const store = configureStore({
  reducer: {
    sales: salesSlice.reducer,
    payment: paymentSlice.reducer,
    ui: uiSlice.reducer,
    offlineAuth: offlineAuthSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // The cart holds no non-serializable values; keep the check enabled.
        ignoredActions: [],
        ignoredPaths: [],
      },
    }),
  // Set-aside carts (F8) survive app restarts.
  preloadedState: {
    sales: {
      ...salesSlice.getInitialState(),
      heldCarts: loadHeldCarts(),
    },
  },
});

// Persist held carts on every change; the snapshot is small and capped.
store.subscribe(() => {
  saveHeldCarts(store.getState().sales.heldCarts);
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
