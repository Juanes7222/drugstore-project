/**
 * Tests for the Redux store configuration.
 *
 * Verifies that configureStore creates a store with all three reducers
 * mounted and that the initial state shape matches expectations.
 */
import { describe, expect, it } from "vitest";
import { store, type RootState } from "./store";

describe("store configuration", () => {
  it("creates a store with the expected slice keys", () => {
    const state = store.getState();
    expect(state).toHaveProperty("sales");
    expect(state).toHaveProperty("payment");
    expect(state).toHaveProperty("ui");
  });

  it("initialises sales with an empty items array", () => {
    const state = store.getState() as RootState;
    expect(state.sales.items).toEqual([]);
  });

  it("initialises payment with an empty methods array and zero cash received", () => {
    const state = store.getState() as RootState;
    expect(state.payment.methods).toEqual([]);
    expect(state.payment.cashReceivedCents).toBe(0);
  });

  it("initialises ui with sales as the active screen and idle completion", () => {
    const state = store.getState() as RootState;
    expect(state.ui.activeScreen).toBe("sales");
    expect(state.ui.saleCompletionPhase).toBe("idle");
  });

  it("dipatches an action and reflects the updated state", () => {
    store.dispatch({ type: "ui/setActiveScreen", payload: "returns" });
    const state = store.getState() as RootState;
    expect(state.ui.activeScreen).toBe("returns");

    // Reset for subsequent tests
    store.dispatch({ type: "ui/setActiveScreen", payload: "sales" });
  });
});
