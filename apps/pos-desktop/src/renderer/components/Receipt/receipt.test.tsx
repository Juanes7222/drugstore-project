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
import {
  uiSlice,
  resetSaleFlow,
  completeSaleCompletion,
} from "@/store/slices/ui-slice";
import { salesSlice } from "@/store/slices/sales-slice";
import { paymentSlice } from "@/store/slices/payment-slice";
import { SaleType } from "@pharmacy/shared-types";
import { generateReceiptHtml } from "../../../domain/fiscal/receipt-generator";
import { Receipt } from "./receipt";
import type { CartItem } from "@/store/slices/sales-types";
import type { SaleDeliveryDraft } from "@/store/slices/sales-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../../domain/fiscal/receipt-generator", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../domain/fiscal/receipt-generator")
    >();
  return {
    ...actual,
    generateReceiptHtml: vi.fn(() => "<div>mock receipt</div>"),
    printReceipt: vi.fn(),
  };
});

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
    // Pass-through for SVG motion elements used by the animated icons
    // (SuccessCheckIcon draws its checkmark stroke).
    path: ({
      children,
      initial: _initial,
      animate: _animate,
      transition: _transition,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => <path {...props}>{children}</path>,
    // The icon system renders every icon through motion.svg for its
    // entrance pop, so the mock needs an svg passthrough as well.
    svg: ({
      children,
      initial: _initial,
      animate: _animate,
      transition: _transition,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => <svg {...props}>{children}</svg>,
  },
  useReducedMotion: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cartItem = (): CartItem => ({
  id: "line-1",
  productId: "p-001",
  name: "Acetaminofén 500mg",
  invimaCertificate: "INVIMA-2019M-001234",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  lotCode: "L24056",
  lotExpirationDate: "2027-06-01",
  unitPriceCents: 620_000,
  overrideUnitPriceCents: null,
  discountPercentage: null,
  costCents: null,
  taxPercentage: 19,
  quantity: 1,
  commissionType: null,
  commissionValue: null,
  commissionStartsAt: null,
  commissionEndsAt: null,
});

const deliveryDraft = (): SaleDeliveryDraft => ({
  state: "PENDING",
  address: "Calle 10 #20-30",
  contactName: "Ana Gómez",
  contactPhone: "5551234",
  notes: "Entregar antes de las 6pm",
  scheduledAt: null,
  feeCents: 12_500,
});

const createTestStore = (
  phase: "idle" | "initiating" | "completing" | "completed",
  options: { items?: CartItem[]; delivery?: SaleDeliveryDraft | null } = {},
) =>
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
        currentSaleId: null,
        pendingPurchaseOrderId: null,
        prescriptionFlow: {
          pendingSaleId: null,
          pendingItemId: null,
          incompleteItemIds: [],
        },
      },
      sales: {
        items: options.items ?? [],
        selectedClient: null,
        delivery: options.delivery ?? null,
        selectedLineId: null,
        undoStack: [],
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

  it("passes the delivery draft and its fee to the receipt generator", () => {
    const draft = deliveryDraft();
    const store = createTestStore("completing", {
      items: [cartItem()],
      delivery: draft,
    });
    renderReceipt(store);

    expect(vi.mocked(generateReceiptHtml)).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: draft,
        deliveryFeeCents: 12_500,
      }),
    );
  });

  it("emits the DOMICILIO section and the Domicilio fee row in the generated HTML", async () => {
    const store = createTestStore("completing", {
      items: [cartItem()],
      delivery: deliveryDraft(),
    });
    renderReceipt(store);

    const { generateReceiptHtml: realGenerateReceiptHtml } =
      await vi.importActual<
        typeof import("../../../domain/fiscal/receipt-generator")
      >("../../../domain/fiscal/receipt-generator");
    // The latest call is this render's — earlier tests accumulate calls.
    const html = realGenerateReceiptHtml(
      vi.mocked(generateReceiptHtml).mock.calls.at(-1)![0],
    );

    expect(html).toContain("*** DOMICILIO ***");
    expect(html).toContain("Calle 10 #20-30");
    expect(html).toContain("Tel: 5551234");
    expect(html).toContain('<td class="label">Domicilio</td>');
    // The generator formats feeCents as a peso decimal: 12 500 → "$12.500,00"
    expect(html).toContain("$12.500,00");
    expect(html).toContain("TOTAL + DOMICILIO");
  });

  it("omits the DOMICILIO section when the sale has no delivery", async () => {
    const store = createTestStore("completing", { items: [cartItem()] });
    renderReceipt(store);

    const { generateReceiptHtml: realGenerateReceiptHtml } =
      await vi.importActual<
        typeof import("../../../domain/fiscal/receipt-generator")
      >("../../../domain/fiscal/receipt-generator");
    const html = realGenerateReceiptHtml(
      vi.mocked(generateReceiptHtml).mock.calls.at(-1)![0],
    );

    expect(html).not.toContain("*** DOMICILIO ***");
    expect(html).not.toContain('<td class="label">Domicilio</td>');
  });
});
