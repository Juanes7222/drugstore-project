/**
 * Redux Toolkit slice owning cross-screen UI state.
 *
 * Responsibilities:
 *   - Track the active POS screen (sales, payment, receipt, returns, etc.).
 *   - Coordinate the sale-completing motion handoff between Payment and Receipt.
 *   - Manage the prescription-interception flow that pauses payment when
 *     cart items require a medical prescription.
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
import { PosScreen, PrescriptionFlowState, SaleCompletionPhase, UiState } from "./ui-types";

const initialPrescriptionFlow: PrescriptionFlowState = {
  pendingSaleId: null,
  pendingItemId: null,
  incompleteItemIds: [],
};

const initialState: UiState = {
  activeScreen: "sales",
  saleCompletionPhase: "idle",
  prescriptionFlow: initialPrescriptionFlow,
};

export const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setActiveScreen: (state, action: PayloadAction<PosScreen>) => {
      state.activeScreen = action.payload;
    },

    /* ---- Navigation shorthands ---- */

    navigateToReturns: (state) => {
      state.activeScreen = "returns";
    },

    navigateToInventoryAdjustments: (state) => {
      state.activeScreen = "inventory-adjustments";
    },

    navigateToPrescriptions: (state) => {
      state.activeScreen = "prescriptions";
    },

    navigateToAdminMenu: (state) => {
      state.activeScreen = "admin-menu";
    },

    navigateToSyncHealth: (state) => {
      state.activeScreen = "sync-health";
    },

    navigateToRecovery: (state) => {
      state.activeScreen = "recovery";
    },

    navigateBackToSales: (state) => {
      state.activeScreen = "sales";
    },

    /* ---- Sale completion handoff ---- */

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
      state.prescriptionFlow = initialPrescriptionFlow;
    },

    /* ---- Prescription interception flow ---- */

    setPrescriptionFlow: (
      state,
      action: PayloadAction<PrescriptionFlowState>,
    ) => {
      state.prescriptionFlow = action.payload;
      state.activeScreen = "prescriptions";
    },

    clearPrescriptionFlow: (state) => {
      state.prescriptionFlow = initialPrescriptionFlow;
    },

    /**
     * Remove the first item from the incomplete-item queue and advance
     * `pendingItemId` to the next one, or set it to `null` when the queue
     * is empty.
     */
    resolveNextPrescriptionItem: (state) => {
      if (!state.prescriptionFlow) {
        return;
      }

      const [, ...rest] = state.prescriptionFlow.incompleteItemIds;
      state.prescriptionFlow.incompleteItemIds = rest;
      state.prescriptionFlow.pendingItemId = rest.length > 0 ? rest[0] : null;
    },
  },
});

export const {
  setActiveScreen,
  navigateToReturns,
  navigateToInventoryAdjustments,
  navigateToPrescriptions,
  navigateToAdminMenu,
  navigateToSyncHealth,
  navigateToRecovery,
  navigateBackToSales,
  initiateSaleCompletion,
  navigateToReceipt,
  completeSaleCompletion,
  resetSaleFlow,
  setPrescriptionFlow,
  clearPrescriptionFlow,
  resolveNextPrescriptionItem,
} = uiSlice.actions;

/* ------------------------------------------------------------------ */
/* Selectors                                                          */
/* ------------------------------------------------------------------ */

export const selectActiveScreen = (state: { ui: UiState }): PosScreen =>
  state.ui.activeScreen;

export const selectSaleCompletionPhase = (
  state: { ui: UiState },
): SaleCompletionPhase => state.ui.saleCompletionPhase;

export const selectPrescriptionFlow = (
  state: { ui: UiState },
): PrescriptionFlowState => state.ui.prescriptionFlow;
