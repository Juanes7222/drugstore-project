/**
 * Unit tests for the ui slice and its selectors.
 */
import { describe, expect, it } from "vitest";
import {
  clearPrescriptionFlow,
  completeSaleCompletion,
  initiateSaleCompletion,
  navigateBackToSales,
  navigateToAbout,
  navigateToAdminMenu,
  navigateToAuditLog,
  navigateToForgotPassword,
  navigateToInventoryAdjustments,
  navigateToLogin,
  navigateToPrescriptions,
  navigateToReceipt,
  navigateToRecovery,
  navigateToReturns,
  navigateToSyncHealth,
  navigateToTwoFactorSetup,
  navigateToUserManagement,
  resetSaleFlow,
  resolveNextPrescriptionItem,
  selectActiveScreen,
  selectPrescriptionFlow,
  selectSaleCompletionPhase,
  setActiveScreen,
  setPrescriptionFlow,
  uiSlice,
} from "./ui-slice";
import { PosScreen } from "./ui-types";

interface RootState {
  ui: ReturnType<typeof uiSlice.reducer>;
}

const buildRoot = (
  overrides: Partial<ReturnType<typeof uiSlice.reducer>> = {},
): RootState => ({
  ui: { ...uiSlice.getInitialState(), ...overrides },
});

describe("ui slice — initial state", () => {
  it("defaults activeScreen to sales and phase to idle", () => {
    const state = uiSlice.reducer(
      uiSlice.getInitialState(),
      { type: "unknown" },
    );

    expect(state.activeScreen).toBe("sales");
    expect(state.saleCompletionPhase).toBe("idle");
    expect(state.prescriptionFlow).toEqual({
      pendingSaleId: null,
      pendingItemId: null,
      incompleteItemIds: [],
    });
  });
});

describe("ui slice — navigation shorthands", () => {
  const assertNavigateTo =
    (action: unknown, expectedScreen: PosScreen) => () => {
      const state = uiSlice.reducer(
        uiSlice.getInitialState(),
        action as any,
      );

      expect(state.activeScreen).toBe(expectedScreen);
    };

  it("setActiveScreen changes the active screen", () => {
    const state = uiSlice.reducer(
      uiSlice.getInitialState(),
      setActiveScreen("returns"),
    );

    expect(state.activeScreen).toBe("returns");
  });

  it(
    "navigateToReturns",
    assertNavigateTo(navigateToReturns(), "returns"),
  );
  it(
    "navigateToInventoryAdjustments",
    assertNavigateTo(navigateToInventoryAdjustments(), "inventory-adjustments"),
  );
  it(
    "navigateToPrescriptions",
    assertNavigateTo(navigateToPrescriptions(), "prescriptions"),
  );
  it(
    "navigateToAdminMenu",
    assertNavigateTo(navigateToAdminMenu(), "admin-menu"),
  );
  it(
    "navigateToSyncHealth",
    assertNavigateTo(navigateToSyncHealth(), "sync-health"),
  );
  it(
    "navigateToRecovery",
    assertNavigateTo(navigateToRecovery(), "recovery"),
  );
  it(
    "navigateToUserManagement",
    assertNavigateTo(navigateToUserManagement(), "user-management"),
  );
  it(
    "navigateToAuditLog",
    assertNavigateTo(navigateToAuditLog(), "audit-log"),
  );
  it(
    "navigateToAbout",
    assertNavigateTo(navigateToAbout(), "about"),
  );
  it(
    "navigateToLogin",
    assertNavigateTo(navigateToLogin(), "login"),
  );
  it(
    "navigateToForgotPassword",
    assertNavigateTo(navigateToForgotPassword(), "forgot-password"),
  );
  it(
    "navigateToTwoFactorSetup",
    assertNavigateTo(navigateToTwoFactorSetup(), "2fa-setup"),
  );
  it(
    "navigateBackToSales",
    assertNavigateTo(navigateBackToSales(), "sales"),
  );
});

describe("ui slice — sale completion handoff", () => {
  it("initiateSaleCompletion sets the phase to initiating", () => {
    const state = uiSlice.reducer(
      uiSlice.getInitialState(),
      initiateSaleCompletion(),
    );

    expect(state.saleCompletionPhase).toBe("initiating");
    expect(state.activeScreen).toBe("sales"); // unchanged
  });

  it("navigateToReceipt sets screen to receipt and phase to completing", () => {
    const state = uiSlice.reducer(
      uiSlice.getInitialState(),
      navigateToReceipt(),
    );

    expect(state.activeScreen).toBe("receipt");
    expect(state.saleCompletionPhase).toBe("completing");
  });

  it("completeSaleCompletion advances phase to completed", () => {
    const afterInitiate = uiSlice.reducer(
      uiSlice.getInitialState(),
      initiateSaleCompletion(),
    );
    const state = uiSlice.reducer(afterInitiate, completeSaleCompletion());

    expect(state.saleCompletionPhase).toBe("completed");
  });

  it("resetSaleFlow resets screen, phase, and prescription flow", () => {
    let state = uiSlice.reducer(
      uiSlice.getInitialState(),
      setPrescriptionFlow({
        pendingSaleId: "s-1",
        pendingItemId: "i-1",
        incompleteItemIds: ["i-1", "i-2"],
      }),
    );

    state = uiSlice.reducer(state, completeSaleCompletion());
    state = uiSlice.reducer(state, resetSaleFlow());

    expect(state.activeScreen).toBe("sales");
    expect(state.saleCompletionPhase).toBe("idle");
    expect(state.prescriptionFlow).toEqual({
      pendingSaleId: null,
      pendingItemId: null,
      incompleteItemIds: [],
    });
  });
});

describe("ui slice — prescription interception flow", () => {
  it("setPrescriptionFlow sets the flow and navigates to prescriptions", () => {
    const state = uiSlice.reducer(
      uiSlice.getInitialState(),
      setPrescriptionFlow({
        pendingSaleId: "s-1",
        pendingItemId: "i-1",
        incompleteItemIds: ["i-1", "i-2", "i-3"],
      }),
    );

    expect(state.activeScreen).toBe("prescriptions");
    expect(state.prescriptionFlow).toEqual({
      pendingSaleId: "s-1",
      pendingItemId: "i-1",
      incompleteItemIds: ["i-1", "i-2", "i-3"],
    });
  });

  it("clearPrescriptionFlow resets the flow to nulls", () => {
    let state = uiSlice.reducer(
      uiSlice.getInitialState(),
      setPrescriptionFlow({
        pendingSaleId: "s-1",
        pendingItemId: "i-1",
        incompleteItemIds: ["i-1"],
      }),
    );

    state = uiSlice.reducer(state, clearPrescriptionFlow());

    expect(state.prescriptionFlow).toEqual({
      pendingSaleId: null,
      pendingItemId: null,
      incompleteItemIds: [],
    });
  });

  it("resolveNextPrescriptionItem removes the first incomplete item", () => {
    let state = uiSlice.reducer(
      uiSlice.getInitialState(),
      setPrescriptionFlow({
        pendingSaleId: "s-1",
        pendingItemId: "i-1",
        incompleteItemIds: ["i-1", "i-2", "i-3"],
      }),
    );

    state = uiSlice.reducer(state, resolveNextPrescriptionItem());

    expect(state.prescriptionFlow.pendingItemId).toBe("i-2");
    expect(state.prescriptionFlow.incompleteItemIds).toEqual(["i-2", "i-3"]);
  });

  it("resolveNextPrescriptionItem sets pendingItemId to null when last item resolved", () => {
    let state = uiSlice.reducer(
      uiSlice.getInitialState(),
      setPrescriptionFlow({
        pendingSaleId: "s-1",
        pendingItemId: "i-1",
        incompleteItemIds: ["i-1"],
      }),
    );

    state = uiSlice.reducer(state, resolveNextPrescriptionItem());

    expect(state.prescriptionFlow.pendingItemId).toBeNull();
    expect(state.prescriptionFlow.incompleteItemIds).toEqual([]);
  });

  it("resolveNextPrescriptionItem is a no-op when incompleteItemIds is empty", () => {
    // When the queue is already empty, destructuring produces an empty
    // rest array and pendingItemId stays null — state is unchanged.
    const state = uiSlice.reducer(
      uiSlice.getInitialState(),
      resolveNextPrescriptionItem(),
    );

    expect(state.prescriptionFlow).toEqual({
      pendingSaleId: null,
      pendingItemId: null,
      incompleteItemIds: [],
    });
  });

  it("returns early when prescriptionFlow is null", () => {
    // The guard at the top of the reducer checks for a falsy value.
    const state = uiSlice.reducer(
      { ...uiSlice.getInitialState(), prescriptionFlow: null as any },
      resolveNextPrescriptionItem(),
    );

    expect(state.prescriptionFlow).toBeNull();
  });
});

describe("ui selectors", () => {
  it("selectActiveScreen returns the current screen", () => {
    const root = buildRoot({ activeScreen: "returns" });

    expect(selectActiveScreen(root)).toBe("returns");
  });

  it("selectSaleCompletionPhase returns the current phase", () => {
    const root = buildRoot({ saleCompletionPhase: "completing" });

    expect(selectSaleCompletionPhase(root)).toBe("completing");
  });

  it("selectPrescriptionFlow returns the flow state", () => {
    const flow = {
      pendingSaleId: "s-1",
      pendingItemId: "i-1",
      incompleteItemIds: ["i-1", "i-2"],
    };
    const root = buildRoot({ prescriptionFlow: flow });

    expect(selectPrescriptionFlow(root)).toEqual(flow);
  });
});
