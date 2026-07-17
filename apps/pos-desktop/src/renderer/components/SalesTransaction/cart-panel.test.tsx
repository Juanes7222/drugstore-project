/**
 * Component tests for CartPanel.
 *
 * Covers: empty cart message, product items rendering, checkout
 * callback, and quantity/remove controls.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { salesSlice } from "@/store/slices/sales-slice";
import { paymentSlice } from "@/store/slices/payment-slice";
import { uiSlice } from "@/store/slices/ui-slice";
import { SaleType } from "@pharmacy/shared-types";
import { CartPanel } from "./cart-panel";
import type { CartItem } from "@/store/slices/sales-types";

// Mock ClientSelector since it requires ServiceContext not needed here
vi.mock("./client-selector", () => ({
  ClientSelector: () => <div data-testid="client-selector" />,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseItem = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: "line-1",
  productId: "p-001",
  name: "Acetaminofén 500mg",
  genericName: "Paracetamol",
  invimaCertificate: "INVIMA-2019M-001234",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  lotCode: "L24056",
  lotExpirationDate: "2027-06-01",
  unitPriceCents: 6_200,
  taxPercentage: 19,
  quantity: 1,
  ...overrides,
});

const createTestStore = (items: CartItem[]) =>
  configureStore({
    reducer: {
      sales: salesSlice.reducer,
      payment: paymentSlice.reducer,
      ui: uiSlice.reducer,
    },
    preloadedState: {
      sales: { items, selectedClient: null },
      payment: paymentSlice.reducer(
        paymentSlice.getInitialState(),
        { type: "unknown" },
      ),
      ui: uiSlice.reducer(
        uiSlice.getInitialState(),
        { type: "unknown" },
      ),
    },
  });

const renderCartPanel = (
  store: ReturnType<typeof createTestStore>,
  onCheckout = vi.fn(),
  onSelectClient = vi.fn(),
  onClearClient = vi.fn(),
) =>
  render(
    <Provider store={store}>
      <CartPanel
        onCheckout={onCheckout}
        onSelectClient={onSelectClient}
        onClearClient={onClearClient}
      />
    </Provider>,
  );

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CartPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("CP-01: empty cart", () => {
    it("shows the empty-cart message when there are no items", () => {
      const store = createTestStore([]);
      renderCartPanel(store);

      expect(screen.getByText("El carrito está vacío")).toBeInTheDocument();
    });

    it("disables the checkout button when the cart is empty", () => {
      const store = createTestStore([]);
      renderCartPanel(store);

      expect(
        screen.getByRole("button", { name: /COBRAR/ }),
      ).toBeDisabled();
    });
  });

  describe("CP-02: cart with items", () => {
    it("renders the item name and quantity", () => {
      const store = createTestStore([baseItem()]);
      renderCartPanel(store);

      expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("renders the unit price formatted", () => {
      const store = createTestStore([baseItem()]);
      renderCartPanel(store);

      // unitPriceCents = 6 200 → es-CO format: "$ 6.200"
      // With qty=1, the unit price, line total, and subtotal all match, so
      // getAllByText is used to avoid the "multiple elements" error.
      const matches = screen.getAllByText(/\$\s*6\.200/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("renders the line total (unitPrice * quantity)", () => {
      const store = createTestStore([baseItem({ quantity: 3 })]);
      renderCartPanel(store);

      // 6 200 * 3 = 18 600 → "$ 18.600"
      // The line total and the subtotal both display the same amount, so
      // getAllByText is used to avoid the "multiple elements" error.
      const matches = screen.getAllByText(/\$\s*18\.600/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("enables the checkout button when items are present", () => {
      const store = createTestStore([baseItem()]);
      renderCartPanel(store);

      expect(
        screen.getByRole("button", { name: /COBRAR/ }),
      ).not.toBeDisabled();
    });
  });

  describe("CP-03: checkout callback", () => {
    it("calls onCheckout when the checkout button is clicked", () => {
      const onCheckout = vi.fn();
      const store = createTestStore([baseItem()]);
      renderCartPanel(store, onCheckout);

      fireEvent.click(screen.getByRole("button", { name: /COBRAR/ }));

      expect(onCheckout).toHaveBeenCalledOnce();
    });
  });

  describe("CP-04: update quantity", () => {
    it("dispatches updateQuantity when the + button is clicked", () => {
      const store = createTestStore([baseItem({ id: "line-1", quantity: 1 })]);
      const dispatch = vi.spyOn(store, "dispatch");
      renderCartPanel(store);

      // The "+" button has aria-label "Agregar"
      const addButtons = screen.getAllByRole("button", { name: "Agregar" });
      fireEvent.click(addButtons[0]);

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "sales/updateQuantity",
          payload: { id: "line-1", quantity: 2 },
        }),
      );
    });

    it("dispatches updateQuantity when the - button is clicked", () => {
      const store = createTestStore([baseItem({ id: "line-1", quantity: 3 })]);
      const dispatch = vi.spyOn(store, "dispatch");
      renderCartPanel(store);

      // The "-" button has aria-label "Eliminar" (same as ×),
      // but there is only one row so any "Eliminar" button works.
      const removeButtons = screen.getAllByRole("button", { name: "Eliminar" });
      // The first "Eliminar" button is the "-" (quantity decrease)
      fireEvent.click(removeButtons[0]);

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "sales/updateQuantity",
          payload: { id: "line-1", quantity: 2 },
        }),
      );
    });
  });

  describe("CP-05: remove item", () => {
    it("dispatches removeItem when the × button is clicked", () => {
      const store = createTestStore([baseItem({ id: "line-1" })]);
      const dispatch = vi.spyOn(store, "dispatch");
      renderCartPanel(store);

      // The "×" button is the last "Eliminar" button in the row
      // (after the "-" button). Since the table has one row, we
      // get two "Eliminar" buttons: one for "-" and one for "×".
      const removeButtons = screen.getAllByRole("button", { name: "Eliminar" });
      // The second "Eliminar" button is the × (remove item)
      fireEvent.click(removeButtons[1]);

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "sales/removeItem",
          payload: "line-1",
        }),
      );
    });
  });

  it("shows the cart title with the item count", () => {
    const store = createTestStore([baseItem()]);
    renderCartPanel(store);

    expect(screen.getByText("Carrito (1 items)")).toBeInTheDocument();
  });
});
