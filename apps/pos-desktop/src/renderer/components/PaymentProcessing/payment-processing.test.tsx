/**
 * Component tests for the Payment screen.
 *
 * Covers: PP-01 through PP-04 (existing), PP-05 (change display),
 * PP-07 (add method), PP-10 (prescription interception),
 * PP-11 (completing state).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Provider } from "react-redux";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { PaymentProcessing } from "./payment-processing";
import { addItem, salesSlice } from "@/store/slices/sales-slice";
import { paymentSlice, initializePayment, setCashReceived } from "@/store/slices/payment-slice";
import { uiSlice, setPrescriptionFlow } from "@/store/slices/ui-slice";
import { PaymentGatewayService } from "@/services/payment-gateway-service";
import { SaleType } from "@pharmacy/shared-types";
import type { CartItem } from "@/store/slices/sales-types";
// Initialize i18n singleton so formatCurrency can resolve the active locale.
import "@/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseCartItem = {
  id: "line-1",
  productId: "p-001",
  name: "Test product",
  genericName: "Test generic",
  invimaCertificate: "INVIMA-TEST",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  lotCode: "L1",
  lotExpirationDate: "2027-01-01",
  taxPercentage: 19,
  quantity: 1,
};

const createTestStore = (totalCents: number, extraItems: CartItem[] = []) => {
  const unitPriceCents = Math.round(totalCents / 1.19);

  let salesState = salesSlice.reducer(
    salesSlice.getInitialState(),
    salesSlice.actions.addItem({
      ...baseCartItem,
      unitPriceCents,
    }),
  );
  for (const item of extraItems) {
    salesState = salesSlice.reducer(salesState, addItem(item));
  }

  const preloadedState = {
    sales: salesState,
    payment: paymentSlice.reducer(
      paymentSlice.getInitialState(),
      initializePayment({ totalCents }),
    ),
    ui: uiSlice.getInitialState(),
  };

  return configureStore({
    reducer: {
      sales: salesSlice.reducer,
      payment: paymentSlice.reducer,
      ui: uiSlice.reducer,
    },
    preloadedState,
  });
};

const renderPayment = (
  store: ReturnType<typeof createTestStore>,
  gatewayService?: PaymentGatewayService,
) => {
  return render(
    <Provider store={store}>
      <PaymentProcessing gatewayService={gatewayService} />
    </Provider>,
  );
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("PaymentProcessing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // --- PP-01 ---

  it("displays the total due and the initial cash method", () => {
    const store = createTestStore(66_164);
    renderPayment(store);

    expect(screen.getByTestId("payment-total-due")).toHaveTextContent(
      /\$\s*66\.164/,
    );
    expect(screen.getByText(/Efectivo|Cash/)).toBeInTheDocument();
  });

  // --- PP-02 / PP-03 ---

  it("keeps the confirm button disabled until the split matches the total", () => {
    const store = createTestStore(66_164);
    renderPayment(store);

    const amountInput = screen.getAllByLabelText(/Valor|Amount/)[0] as HTMLInputElement;
    const confirmButton = screen.getByRole("button", {
      name: /Confirmar pago|Confirm payment/,
    });

    // Exact initial amount → enabled.
    expect(confirmButton).not.toBeDisabled();

    // Reduce the cash amount → disabled because the split is short.
    fireEvent.change(amountInput, { target: { value: "50000" } });
    expect(confirmButton).toBeDisabled();

    // Restore the exact amount → enabled again.
    fireEvent.change(amountInput, { target: { value: "66164" } });
    expect(confirmButton).not.toBeDisabled();
  });

  // --- PP-04 ---

  it("recalculates change on every keystroke of the received amount", () => {
    const store = createTestStore(66_164);
    renderPayment(store);

    const receivedInput = screen.getByLabelText(/Recibido|Received/) as HTMLInputElement;

    fireEvent.change(receivedInput, { target: { value: "100000" } });
    expect(screen.getByText(/\$\s*33\.836/)).toBeInTheDocument();

    fireEvent.change(receivedInput, { target: { value: "66164" } });
    expect(screen.getByText(/\$\s*0/)).toBeInTheDocument();

    fireEvent.change(receivedInput, { target: { value: "50000" } });
    expect(screen.getByText(/-\$\s*16\.164/)).toBeInTheDocument();
  });

  // --- PP-05: change display ---

  it("displays positive change when cash received exceeds cash owed", () => {
    // Total = 66 164, single CASH method matches it.
    // Setting cashReceived higher than owed shows positive change.
    const store = createTestStore(66_164);
    // Pre-set cash received so the change is visible immediately.
    store.dispatch(setCashReceived(100_000));
    renderPayment(store);

    // Owed = 66 164, received = 100 000 → change = 33 836
    expect(screen.getByText(/\$\s*33\.836/)).toBeInTheDocument();
  });

  // --- PP-07: add payment method ---

  it("adds a new card method when the add-method button is clicked", () => {
    const store = createTestStore(66_164);
    renderPayment(store);

    // Only one method row (CASH) should be visible initially.
    const addButton = screen.getByRole("button", {
      name: /Agregar método|Add method/,
    });
    fireEvent.click(addButton);

    // A second method row (CARD by default) should now be present.
    const amountInputs = screen.getAllByLabelText(/Valor|Amount/);
    expect(amountInputs).toHaveLength(2);
  });

  // --- PP-08 / PP-09: authorizations (already covered in existing test) ---

  it("shows distinct visual states for pending, approved, and rejected authorizations", async () => {
    const store = createTestStore(66_164);

    const gatewayService: PaymentGatewayService = {
      authorize: vi
        .fn()
        .mockResolvedValueOnce({
          status: "approved",
          reference: "POS-APPROVED-123",
        })
        .mockResolvedValueOnce({
          status: "rejected",
          rejectionReason: "Fondos insuficientes",
        }),
      generateReference: vi.fn().mockReturnValue("POS-REF"),
    };

    renderPayment(store, gatewayService);

    const amountInputs = screen.getAllByLabelText(/Valor|Amount/);
    fireEvent.change(amountInputs[0], { target: { value: "40000" } });

    // Add a card method and authorize it.
    const addButton = screen.getByRole("button", {
      name: /Agregar método|Add method/,
    });
    fireEvent.click(addButton);

    const cardAmountInput =
      amountInputs[1] ?? screen.getAllByLabelText(/Valor|Amount/)[1];
    fireEvent.change(cardAmountInput, { target: { value: "26164" } });

    let verifyButton = screen.getByRole("button", {
      name: /Verificar pago|Verify payment/,
    });
    fireEvent.click(verifyButton);

    // Pending state: spinner + processing label.
    await waitFor(() => {
      expect(screen.getByText(/Procesando|Processing/)).toBeInTheDocument();
    });

    // Approved state: reference visible.
    await waitFor(() => {
      expect(screen.getByText(/POS-APPROVED-123/)).toBeInTheDocument();
    });

    // Changing the amount resets the authorization to idle, allowing a retry.
    fireEvent.change(cardAmountInput, { target: { value: "26165" } });

    verifyButton = screen.getByRole("button", {
      name: /Verificar pago|Verify payment/,
    });
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(screen.getByText(/Rechazado|Rejected/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Fondos insuficientes/)).toBeInTheDocument();
  });

  // --- PP-10: prescription interception ---

  it("dispatches setPrescriptionFlow when confirming with items needing a prescription", () => {
    const items = [
      {
        ...baseCartItem,
        id: "line-1",
        unitPriceCents: 50_000,
        quantity: 1,
      },
      {
        id: "line-2",
        productId: "p-004",
        name: "Losartán 50mg",
        genericName: "Losartán potásico",
        invimaCertificate: "INVIMA-2019M-004567",
        saleType: SaleType.PRESCRIPTION,
        requiresPrescription: true,
        isRestricted: false,
        lotCode: "LS-2409",
        lotExpirationDate: "2027-06-01",
        unitPriceCents: 24_300,
        taxPercentage: 19,
        quantity: 1,
      },
    ] as CartItem[];

    // Build the sales state first so we can compute the exact total.
    let salesState = salesSlice.getInitialState();
    for (const item of items) {
      salesState = salesSlice.reducer(salesState, addItem(item));
    }
    const subtotal = salesState.items.reduce(
      (s, i) => s + i.unitPriceCents * i.quantity, 0,
    );
    const totalCents = subtotal + Math.round(subtotal * 0.19);

    const store = configureStore({
      reducer: {
        sales: salesSlice.reducer,
        payment: paymentSlice.reducer,
        ui: uiSlice.reducer,
      },
      preloadedState: {
        sales: salesState,
        payment: paymentSlice.reducer(
          paymentSlice.getInitialState(),
          initializePayment({ totalCents }),
        ),
        ui: uiSlice.getInitialState(),
      },
    });
    const dispatch = vi.spyOn(store, "dispatch");
    renderPayment(store);

    const confirmButton = screen.getByRole("button", {
      name: /Confirmar pago|Confirm payment/,
    });

    // The confirm button should be enabled (split covers the total).
    expect(confirmButton).not.toBeDisabled();

    fireEvent.click(confirmButton);

    // Should dispatch setPrescriptionFlow instead of initiateSaleCompletion.
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui/setPrescriptionFlow",
      }),
    );
    // payload.pendingSaleId should be a UUID, and incompleteItemIds should contain line-2.
    const setFlowCall = dispatch.mock.calls.find(
      ([action]: [unknown]) =>
        typeof action === "object" &&
        action !== null &&
        "type" in action &&
        (action as Record<string, unknown>).type === "ui/setPrescriptionFlow",
    );
    expect(setFlowCall).toBeDefined();
    const payload = (setFlowCall as [{ payload: { pendingSaleId: string; incompleteItemIds: string[] } }])[0].payload;
    expect(payload.incompleteItemIds).toEqual(["line-2"]);
  });

  it("does not intercept when cart has no prescription-required items", () => {
    const store = createTestStore(66_164);
    const dispatch = vi.spyOn(store, "dispatch");
    renderPayment(store);

    const confirmButton = screen.getByRole("button", {
      name: /Confirmar pago|Confirm payment/,
    });
    fireEvent.click(confirmButton);

    // Should dispatch initiateSaleCompletion, not setPrescriptionFlow.
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui/setPrescriptionFlow",
      }),
    );
  });

  // --- PP-11: completing state ---

  it("shows 'Procesando pago...' on the button after confirming", () => {
    const store = createTestStore(66_164);
    renderPayment(store);

    const confirmButton = screen.getByRole("button", {
      name: /Confirmar pago|Confirm payment/,
    });
    fireEvent.click(confirmButton);

    // The button text should change to "Procesando pago..."
    expect(screen.getByText("Procesando pago...")).toBeInTheDocument();
  });

  it("disables the confirm button while completing", () => {
    const store = createTestStore(66_164);
    renderPayment(store);

    const confirmButton = screen.getByRole("button", {
      name: /Confirmar pago|Confirm payment/,
    });
    fireEvent.click(confirmButton);

    expect(screen.getByRole("button", { name: /Procesando pago/ })).toBeDisabled();
  });

  it("disables the cancel button while completing", () => {
    const store = createTestStore(66_164);
    renderPayment(store);

    const cancelButton = screen.getByRole("button", { name: /Cancelar/ });
    fireEvent.click(
      screen.getByRole("button", { name: /Confirmar pago|Confirm payment/ }),
    );

    expect(cancelButton).toBeDisabled();
  });

  it("renders the cancel button that resets payment and navigates back", () => {
    const store = createTestStore(66_164);
    const dispatch = vi.spyOn(store, "dispatch");
    renderPayment(store);

    const cancelButton = screen.getByRole("button", { name: /Cancelar/ });
    fireEvent.click(cancelButton);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "payment/resetPayment" }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui/setActiveScreen",
        payload: "sales",
      }),
    );
  });
});
