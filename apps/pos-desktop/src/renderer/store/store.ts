/**
 * Redux store configuration — Pharmacy POS Terminal.
 */
import { configureStore } from "@reduxjs/toolkit";
import { salesSlice } from "./slices/sales-slice";
import { paymentSlice } from "./slices/payment-slice";
import { uiSlice } from "./slices/ui-slice";

export const store = configureStore({
  reducer: {
    sales: salesSlice.reducer,
    payment: paymentSlice.reducer,
    ui: uiSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // The cart holds no non-serializable values; keep the check enabled.
        ignoredActions: [],
        ignoredPaths: [],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
