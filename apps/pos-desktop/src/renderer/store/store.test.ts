/**
 * Tests for the Redux store configuration.
 *
 * Verifies that configureStore creates a store with all three reducers
 * mounted, that the initial state shape matches expectations, and that
 * held carts are hydrated from and persisted to localStorage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaleType } from "@pharmacy/shared-types";
import { addItem, holdCart } from "./slices/sales-slice";
import type { CartItem, HeldCart } from "./slices/sales-types";
import { store, type RootState } from "./store";

// Mirrors STORAGE_KEY in held-carts-persistence.ts.
const STORAGE_KEY = "pos-held-carts";

const cartItemFixture = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: "line-1",
  productId: "p-001",
  name: "Acetaminofén 500mg",
  invimaCertificate: "INVIMA-2025-001",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  lotCode: "LOT-A01",
  lotExpirationDate: "2027-06-01",
  unitPriceCents: 500_000,
  overrideUnitPriceCents: null,
  discountPercentage: null,
  costCents: null,
  taxPercentage: 19,
  quantity: 1,
  commissionType: null,
  commissionValue: null,
  commissionStartsAt: null,
  commissionEndsAt: null,
  ...overrides,
});

const heldCartFixture = (overrides: Partial<HeldCart> = {}): HeldCart => ({
  id: "held-1",
  savedAt: 1_700_000_000_000,
  items: [cartItemFixture()],
  selectedClient: null,
  delivery: null,
  ...overrides,
});

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

  it("initialises ui with home as the active screen and idle completion", () => {
    const state = store.getState() as RootState;
    expect(state.ui.activeScreen).toBe("home");
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

describe("held carts persistence wiring", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("hydrates sales.heldCarts from localStorage when the store is created", async () => {
    const held = heldCartFixture();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([held]));

    vi.resetModules();
    const { store: freshStore } = await import("./store");

    expect(freshStore.getState().sales.heldCarts).toEqual([held]);
  });

  it("persists heldCarts to localStorage on every dispatch via subscribe", () => {
    store.dispatch(addItem(cartItemFixture()));
    store.dispatch(
      holdCart({ id: "held-1", savedAt: 1_700_000_000_000 }),
    );

    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    ) as HeldCart[];

    expect(stored).toEqual([heldCartFixture()]);
  });
});
