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
  activeScreen: "home",
  screenHistory: [],
  saleCompletionPhase: "idle",
  prescriptionFlow: initialPrescriptionFlow,
  currentSaleId: null,
};

/**
 * Shared navigation transition: push the current screen onto the history
 * stack (capped) and land on `screen`. Applied by every `navigateTo*`
 * shorthand so `navigateBack` can return to the screen the user actually
 * came from.
 */
function goTo(state: UiState, screen: PosScreen): void {
  // No-op navigation (same screen) must not push a duplicate history entry.
  if (screen === state.activeScreen) return;
  state.screenHistory.push(state.activeScreen);
  if (state.screenHistory.length > 50) {
    state.screenHistory.shift();
  }
  state.activeScreen = screen;
}

export const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setActiveScreen: (state, action: PayloadAction<PosScreen>) => {
      state.activeScreen = action.payload;
    },

    /* ---- Navigation shorthands ---- */

    navigateToReturns: (state) => {
      goTo(state, "returns");
    },

    navigateToCashShift: (state) => {
      goTo(state, "cash-shift");
    },

    navigateToInventoryAdjustments: (state) => {
      goTo(state, "inventory-adjustments");
    },

    navigateToInventoryLots: (state) => {
      goTo(state, "inventory-lots");
    },

    navigateToProducts: (state) => {
      goTo(state, "products");
    },

    navigateToPrescriptions: (state) => {
      goTo(state, "prescriptions");
    },

    navigateToAdminMenu: (state) => {
      goTo(state, "admin-menu");
    },

    navigateToFiscal: (state) => {
      goTo(state, "fiscal");
    },

    navigateToSalesHistory: (state) => {
      goTo(state, "sales-history");
    },

    navigateToSyncHealth: (state) => {
      goTo(state, "sync-health");
    },

    navigateToLocalNetwork: (state) => {
      goTo(state, "local-network");
    },

    navigateToProductosMain: (state) => {
      goTo(state, "productos-main");
    },

    navigateToPurchasesMain: (state) => {
      goTo(state, "purchases-main");
    },
    navigateToSuppliers: (state) => {
      goTo(state, "suppliers");
    },

    navigateToPurchaseOrders: (state) => {
      goTo(state, "purchase-orders");
    },

    navigateToPurchaseReceptions: (state) => {
      goTo(state, "purchase-receptions");
    },

    navigateToSupplierReturns: (state) => {
      goTo(state, "supplier-returns");
    },

    navigateToReports: (state) => {
      goTo(state, "reports");
    },

    navigateToInventoryCount: (state) => {
      goTo(state, "inventory-count");
    },

    navigateToRecovery: (state) => {
      goTo(state, "recovery");
    },

    navigateToUserManagement: (state) => {
      goTo(state, "user-management");
    },

    navigateToAuditLog: (state) => {
      goTo(state, "audit-log");
    },

    navigateToClients: (state) => {
      goTo(state, "clients");
    },

    navigateToLicenseStatus: (state) => {
      goTo(state, "license-status");
    },

    navigateToPrinting: (state) => {
      goTo(state, "printing");
    },

    navigateToPrinters: (state) => {
      goTo(state, "printers");
    },

    navigateToPrintQueue: (state) => {
      goTo(state, "print-queue");
    },

    navigateToSetupWizard: (state) => {
      goTo(state, "setup-wizard");
    },

    navigateToHome: (state) => {
      goTo(state, "home");
    },

    navigateToAbout: (state) => {
      goTo(state, "about");
    },

    navigateToLogin: (state) => {
      goTo(state, "login");
    },

    navigateToSales: (state) => {
      goTo(state, "sales");
    },

    navigateToForgotPassword: (state) => {
      goTo(state, "forgot-password");
    },



    navigateToTwoFactorSetup: (state) => {
      goTo(state, "2fa-setup");
    },

    navigateBackToSales: (state) => {
      goTo(state, "sales");
    },

    /**
     * Go back to the screen the user actually came from: pop the most
     * recent entry off `screenHistory`. Falls back to `home` when the
     * stack is empty (deep-link / fresh session), never to `sales` —
     * there is no universal "sales is in control" contract in the POS.
     */
    navigateBack: (state) => {
      const previous = state.screenHistory.pop();
      state.activeScreen = previous ?? "home";
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

    setCurrentSaleId: (state, action: PayloadAction<string | null>) => {
      state.currentSaleId = action.payload;
    },

    resetSaleFlow: (state) => {
      state.activeScreen = "sales";
      // The sale flow terminally returns to sales; history accumulated
      // during the sale (e.g. detours into products) must not survive it.
      state.screenHistory = [];
      state.saleCompletionPhase = "idle";
      state.prescriptionFlow = initialPrescriptionFlow;
      state.currentSaleId = null;
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
  setCurrentSaleId,
  navigateToReturns,
  navigateToCashShift,
  navigateToInventoryAdjustments,
  navigateToInventoryLots,
  navigateToProducts,
  navigateToPrescriptions,
  navigateToAdminMenu,
  navigateToSyncHealth,
  navigateToLocalNetwork,
  navigateToProductosMain,
  navigateToPurchasesMain,
  navigateToSuppliers,
  navigateToPurchaseOrders,
  navigateToPurchaseReceptions,
  navigateToSupplierReturns,
  navigateToReports,
  navigateToInventoryCount,
  navigateToRecovery,
  navigateToUserManagement,
  navigateToAuditLog,
  navigateToClients,
  navigateToLicenseStatus,
  navigateToPrinting,
  navigateToPrinters,
  navigateToPrintQueue,
  navigateToSetupWizard,
  navigateToHome,
  navigateToAbout,
  navigateToFiscal,
  navigateToSalesHistory,
  navigateToLogin,
  navigateToSales,
  navigateToForgotPassword,
  navigateToTwoFactorSetup,
  navigateBackToSales,
  navigateBack,
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

export const selectCurrentSaleId = (state: { ui: UiState }): string | null =>
  state.ui.currentSaleId;
