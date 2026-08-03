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
import type {
  CartItem,
  SaleDeliveryDraft,
} from "@/store/slices/sales-types";

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
  invimaCertificate: "INVIMA-2019M-001234",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  lotCode: "L24056",
  lotExpirationDate: "2027-06-01",
  // 620 000 cents = $ 6.200 (formatCurrency divides by 100).
  unitPriceCents: 620_000,
  overrideUnitPriceCents: null,
  discountPercentage: null,
  costCents: 3_000,
  taxPercentage: 19,
  quantity: 1,
  commissionType: null,
  commissionValue: null,
  commissionStartsAt: null,
  commissionEndsAt: null,
  ...overrides,
});

const deliveryDraft = (
  overrides: Partial<SaleDeliveryDraft> = {},
): SaleDeliveryDraft => ({
  state: "PENDING",
  address: "Calle 10 #20-30",
  contactName: null,
  contactPhone: null,
  notes: null,
  scheduledAt: null,
  feeCents: 5_000,
  ...overrides,
});

const createTestStore = (
  items: CartItem[],
  delivery: SaleDeliveryDraft | null = null,
) =>
  configureStore({
    reducer: {
      sales: salesSlice.reducer,
      payment: paymentSlice.reducer,
      ui: uiSlice.reducer,
    },
    preloadedState: {
      sales: { items, selectedClient: null, delivery },
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
  actionError: string | null = null,
  onClearError = vi.fn(),
  isCreating = false,
) =>
  render(
    <Provider store={store}>
      <CartPanel
        onCheckout={onCheckout}
        onSelectClient={onSelectClient}
        onClearClient={onClearClient}
        actionError={actionError}
        onClearError={onClearError}
        isCreating={isCreating}
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

    // The checkout button only renders when the cart has items.
    it("does not render the checkout button when the cart is empty", () => {
      const store = createTestStore([]);
      renderCartPanel(store);

      expect(
        screen.queryByRole("button", { name: /COBRAR/ }),
      ).not.toBeInTheDocument();
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

      // unitPriceCents = 620 000 → es-CO format: "$ 6.200"
      // With qty=1, the unit price, line total, and subtotal all match, so
      // getAllByText is used to avoid the "multiple elements" error.
      const matches = screen.getAllByText(/\$\s*6\.200/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("renders the line total (unitPrice * quantity)", () => {
      const store = createTestStore([baseItem({ quantity: 3 })]);
      renderCartPanel(store);

      // 620 000 * 3 = 1 860 000 cents → "$ 18.600"
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

  describe("CP-06: delivery fee in totals", () => {
    it("renders the delivery fee row and the fee-inclusive grand total", () => {
      const store = createTestStore([baseItem()], deliveryDraft());
      renderCartPanel(store);

      // subtotal 620 000 + IVA 117 800 = 737 800; + fee 5 000 = 742 800 cents
      // → "$ 7.428"; the fee itself renders as "$ 50".
      expect(screen.getByText("Domicilio")).toBeInTheDocument();
      expect(screen.getByText(/\$\s*50$/)).toBeInTheDocument();
      expect(screen.getByText(/\$\s*7\.428/)).toBeInTheDocument();
    });

    it("omits the fee row and the fee when the draft carries no fee", () => {
      const store = createTestStore(
        [baseItem()],
        deliveryDraft({ feeCents: 0 }),
      );
      renderCartPanel(store);

      // grand total stays at 737 800 cents → "$ 7.378"
      expect(screen.queryByText("Domicilio")).not.toBeInTheDocument();
      expect(screen.queryByText(/\$\s*50$/)).not.toBeInTheDocument();
      expect(screen.getByText(/\$\s*7\.378/)).toBeInTheDocument();
    });
  });
});
