/**
 * Redux store configuration — Pharmacy POS Terminal.
 */
import { configureStore } from "@reduxjs/toolkit";
import { salesSlice } from "./slices/sales-slice";

export const store = configureStore({
  reducer: {
    sales: salesSlice.reducer,
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
