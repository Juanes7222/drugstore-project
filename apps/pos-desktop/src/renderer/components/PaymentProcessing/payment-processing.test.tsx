/**
 * Component tests for the Payment screen.
 */
import { describe, expect, it, vi } from "vitest";
import { Provider } from "react-redux";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { PaymentProcessing } from "./payment-processing";
import { salesSlice } from "@/store/slices/sales-slice";
import { paymentSlice } from "@/store/slices/payment-slice";
import { uiSlice } from "@/store/slices/ui-slice";
import { PaymentGatewayService } from "@/services/payment-gateway-service";
import { SaleType } from "@pharmacy/shared-types";
// Initialize i18n singleton so formatCurrency can resolve the active locale.
import "@/i18n";

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

const createTestStore = (totalCents: number) => {
  const unitPriceCents = Math.round(totalCents / 1.19);

  const preloadedState = {
    sales: salesSlice.reducer(
      salesSlice.getInitialState(),
      salesSlice.actions.addItem({
        ...baseCartItem,
        unitPriceCents,
      }),
    ),
    payment: paymentSlice.reducer(
      paymentSlice.getInitialState(),
      paymentSlice.actions.initializePayment({ totalCents }),
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

describe("PaymentProcessing", () => {
  it("displays the total due and the initial cash method", () => {
    const store = createTestStore(66_164);
    renderPayment(store);

    expect(screen.getByTestId("payment-total-due")).toHaveTextContent(
      /\$\s*66\.164/,
    );
    expect(screen.getByText(/Efectivo|Cash/)).toBeInTheDocument();
  });

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
});
