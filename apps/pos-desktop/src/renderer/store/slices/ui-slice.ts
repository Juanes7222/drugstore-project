/**
 * Redux Toolkit slice owning cross-screen UI state.
 *
 * Responsibilities:
 *   - Track the active POS screen (sales, payment, receipt).
 *   - Coordinate the sale-completing motion handoff between Payment and Receipt.
 *
 * Motion handoff protocol:
 *   1. Payment dispatches `initiateSaleCompletion` → phase becomes "initiating".
 *      Payment dims its controls and plays the initiating exit choreography.
 *   2. After the initiating beat, Payment dispatches `navigateToReceipt`
 *      → activeScreen becomes "receipt", phase becomes "completing".
 *   3. Receipt mounts, reads "completing", and plays the completing entry
 *      choreography. When its animation finishes it dispatches
 *      `completeSaleCompletion` → phase becomes "completed".
 *   4. A new sale dispatches `resetSaleFlow` → activeScreen returns to "sales"
 *      and the sale completion phase resets to "idle".
 */
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { PosScreen, SaleCompletionPhase, UiState } from "./ui-types";

const initialState: UiState = {
  activeScreen: "sales",
  saleCompletionPhase: "idle",
};

export const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setActiveScreen: (state, action: PayloadAction<PosScreen>) => {
      state.activeScreen = action.payload;
    },

    initiateSaleCompletion: (state) => {
      state.saleCompletionPhase = "initiating";
    },

    navigateToReceipt: (state) => {
      state.activeScreen = "receipt";
      state.saleCompletionPhase = "completing";
    },

    completeSaleCompletion: (state) => {
      state.saleCompletionPhase = "completed";
    },

    resetSaleFlow: (state) => {
      state.activeScreen = "sales";
      state.saleCompletionPhase = "idle";
    },
  },
});

export const {
  setActiveScreen,
  initiateSaleCompletion,
  navigateToReceipt,
  completeSaleCompletion,
  resetSaleFlow,
} = uiSlice.actions;

export const selectActiveScreen = (state: { ui: UiState }): PosScreen =>
  state.ui.activeScreen;

export const selectSaleCompletionPhase = (
  state: { ui: UiState },
): SaleCompletionPhase => state.ui.saleCompletionPhase;
