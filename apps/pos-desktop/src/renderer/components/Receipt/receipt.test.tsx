/**
 * Component tests for Receipt.
 *
 * Covers: success message rendering, "Nueva venta" button, sale
 * completion handoff via animation callback and idle-phase shortcut.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { uiSlice, resetSaleFlow, completeSaleCompletion } from "@/store/slices/ui-slice";
import { salesSlice } from "@/store/slices/sales-slice";
import { paymentSlice } from "@/store/slices/payment-slice";
import { Receipt } from "./receipt";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../../domain/fiscal/receipt-generator", () => ({
  generateReceiptHtml: vi.fn(() => "<div>mock receipt</div>"),
  printReceipt: vi.fn(),
}));

vi.mock("../../../domain/configuration/local-config.store", () => ({
  getTenantInfo: () => ({
    nit: "000.000.000-0",
    name: "Farmacia Test",
    address: "Calle 123",
    phone: "555-0000",
    resolutionNumber: "RES-001",
    resolutionDate: "2025-01-01",
    resolutionPrefix: "FE",
  }),
}));

vi.mock("motion/react", () => ({
  motion: {
    section: ({
      children,
      onAnimationComplete,
      ...props
    }: {
      children: React.ReactNode;
      onAnimationComplete?: () => void;
      [key: string]: unknown;
    }) => {
      // Fire animation complete immediately on mount so tests don't need
      // to wait for real animation frames.
      if (onAnimationComplete) {
        setTimeout(onAnimationComplete, 0);
      }
      return <section {...props}>{children}</section>;
    },
  },
  useReducedMotion: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createTestStore = (phase: "idle" | "initiating" | "completing" | "completed") =>
  configureStore({
    reducer: {
      ui: uiSlice.reducer,
      sales: salesSlice.reducer,
      payment: paymentSlice.reducer,
    },
    preloadedState: {
      ui: {
        activeScreen: "receipt" as const,
        saleCompletionPhase: phase,
        prescriptionFlow: {
          pendingSaleId: null,
          pendingItemId: null,
          incompleteItemIds: [],
        },
      },
      sales: {
        items: [],
        selectedClient: null,
      },
      payment: {
        methods: [],
        cashReceivedCents: 0,
      },
    },
  });

const renderReceipt = (store: ReturnType<typeof createTestStore>) =>
  render(
    <Provider store={store}>
      <Receipt />
    </Provider>,
  );

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Receipt", () => {
  beforeEach(() => {
    vi.clearAllTimers();
  });

  it("renders the success title", () => {
    const store = createTestStore("completing");
    renderReceipt(store);

    // The es-CO locale renders receipt.title as "Pago confirmado".
    expect(screen.getByText("Pago confirmado")).toBeInTheDocument();
  });

  it("renders a 'Nueva venta' button", () => {
    const store = createTestStore("completing");
    renderReceipt(store);

    expect(
      screen.getByRole("button", { name: /Nueva venta/ }),
    ).toBeInTheDocument();
  });

  it("dispatches resetSaleFlow when 'Nueva venta' is clicked", () => {
    const store = createTestStore("completing");
    const dispatch = vi.spyOn(store, "dispatch");
    renderReceipt(store);

    fireEvent.click(screen.getByRole("button", { name: /Nueva venta/ }));

    expect(dispatch).toHaveBeenCalledWith(resetSaleFlow());
  });

  it("dispatches completeSaleCompletion when the animation completes", async () => {
    const store = createTestStore("completing");
    const dispatch = vi.spyOn(store, "dispatch");
    renderReceipt(store);

    // The mock fires onAnimationComplete via setTimeout(0), so we need
    // to wait for the microtask queue to flush.
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(completeSaleCompletion());
    });
  });

  it("dispatches completeSaleCompletion immediately when phase is idle on mount", () => {
    const store = createTestStore("idle");
    const dispatch = vi.spyOn(store, "dispatch");
    renderReceipt(store);

    expect(dispatch).toHaveBeenCalledWith(completeSaleCompletion());
  });

  it("has an accessible region labelled 'receipt'", () => {
    const store = createTestStore("completing");
    renderReceipt(store);

    // The <section> uses aria-label={t("receipt.title")} which is "Pago confirmado".
    expect(
      screen.getByRole("region", { name: /Pago confirmado/ }),
    ).toBeInTheDocument();
  });
});
