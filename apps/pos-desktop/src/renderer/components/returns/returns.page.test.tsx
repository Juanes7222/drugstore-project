/**
 * Component tests for ReturnsPage.
 *
 * Covers: tab rendering, sale search, verified and unverified return
 * workflows, and error handling.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { uiSlice } from "@/store/slices/ui-slice";
import { ReturnsPage } from "./returns.page";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import type { LocalSession } from "../../../domain/auth/local-session.store";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSearchSale = vi.fn();
const mockCreate = vi.fn();
const mockConfirm = vi.fn();

// DB-backed active payment methods (DIAN categories) — the shared picker
// renders these instead of a hardcoded list.
const { refundMethods } = vi.hoisted(() => ({
  refundMethods: [
    { id: "pm-cash", category: "CASH", name: "Efectivo", isCash: true },
    {
      id: "pm-debit",
      category: "DEBIT_CARD",
      name: "Tarjeta Débito",
      isCash: false,
    },
  ],
}));

vi.mock("../common/service-context", () => ({
  useReturnsService: () => ({
    searchSale: mockSearchSale,
    create: mockCreate,
    confirm: mockConfirm,
  }),
}));

vi.mock("@/hooks/use-active-payment-methods", () => ({
  useActivePaymentMethods: () => ({
    methods: refundMethods,
    loading: false,
    error: null,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createTestStore = () =>
  configureStore({
    reducer: { ui: uiSlice.reducer },
    preloadedState: {
      ui: uiSlice.reducer(
        uiSlice.getInitialState(),
        { type: "unknown" },
      ),
    },
  });

const renderPage = (store = createTestStore()) =>
  render(
    <Provider store={store}>
      <ReturnsPage />
    </Provider>,
  );

const baseSession: LocalSession = {
  userId: "user-1",
  username: "maria",
  fullName: "María Pérez",
  displayName: "María",
  email: "maria@test.com",
  role: "CASHIER",
  subscriptionId: "sub-1",
  workstationId: "ws-1",
  accessToken: "fake-token",
  refreshToken: "fake-refresh",
  expiresAt: new Date("2099-01-01"),
  sessionId: "session-1",
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
  sessionTrust: 'SERVER_VERIFIED',
};

const setSession = (session: LocalSession | null): void => {
  if (session) {
    useLocalSessionStore.getState().setSession(session);
  } else {
    useLocalSessionStore.getState().clearSession();
  }
};

const mockSaleSearchResult = {
  id: "sale-1",
  localNumber: 42,
  createdAt: "2026-07-13T10:00:00Z",
  clientName: "Carlos López",
  workstationId: "ws-1",
  items: [
    {
      id: "item-1",
      productId: "p-001",
      productName: "Acetaminofén 500mg",
      quantity: 2,
      unitPriceCents: 6_200,
      taxRate: 19,
      totalCents: 12_400,
      lotCode: "L24001",
    },
  ],
  totalCents: 12_400,
};

const mockReturnDraft = { id: "return-1" };
const mockConfirmed = { operationUuid: "op-uuid-1" };

describe("ReturnsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession(baseSession);
    mockSearchSale.mockResolvedValue(null);
    mockCreate.mockResolvedValue(mockReturnDraft);
    mockConfirm.mockResolvedValue(mockConfirmed);
  });

  describe("RETP-01: tabs", () => {
    it("renders the Verified and Unverified tabs", () => {
      renderPage();

      expect(
        screen.getByRole("tab", { name: /^Devolución verificada$/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: /^Devolución no verificada$/ }),
      ).toBeInTheDocument();
    });

    it("shows Verified tab as active by default", () => {
      renderPage();

      const verifiedTab = screen.getByRole("tab", { name: /^Devolución verificada$/ });
      expect(verifiedTab).toHaveAttribute("aria-selected", "true");
    });
  });

  describe("RETP-02: verified search input", () => {
    it("renders a search input and button on the verified tab", () => {
      renderPage();

      expect(
        screen.getByPlaceholderText(/Número de venta o UUID/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Buscar venta/i }),
      ).toBeInTheDocument();
    });

    it("disables the search button when the query is empty", () => {
      renderPage();

      expect(
        screen.getByRole("button", { name: /Buscar venta/i }),
      ).toBeDisabled();
    });
  });

  describe("RETP-03: sale found", () => {
    beforeEach(() => {
      mockSearchSale.mockResolvedValue(mockSaleSearchResult);
    });

    it("displays the found sale items after a successful search", async () => {
      renderPage();

      const input = screen.getByPlaceholderText(/Número de venta o UUID/i);
      await userEvent.type(input, "42");
      fireEvent.click(screen.getByRole("button", { name: /Buscar venta/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/Acetaminofén 500mg/i),
        ).toBeInTheDocument();
      });
    });

    it("shows the sequential number of the found sale", async () => {
      renderPage();

      const input = screen.getByPlaceholderText(/Número de venta o UUID/i);
      await userEvent.type(input, "42");
      fireEvent.click(screen.getByRole("button", { name: /Buscar venta/i }));

      await waitFor(() => {
        expect(screen.getByText(/#42/)).toBeInTheDocument();
      });
    });
  });

  describe("RETP-04: create verified return", () => {
    beforeEach(() => {
      mockSearchSale.mockResolvedValue(mockSaleSearchResult);
    });

    it("calls returnsService.create and confirm when submitting", async () => {
      renderPage();

      // Search for sale
      const input = screen.getByPlaceholderText(/Número de venta o UUID/i);
      await userEvent.type(input, "42");
      fireEvent.click(screen.getByRole("button", { name: /Buscar venta/i }));

      // Wait for items to appear
      await waitFor(() => {
        expect(
          screen.getByText(/Acetaminofén 500mg/i),
        ).toBeInTheDocument();
      });

      // Select the item and submit
      await waitFor(() => {
        expect(
          screen.getByRole("checkbox", { name: /Acetaminofén/i }),
        ).toBeInTheDocument();
      });
      fireEvent.click(
        screen.getByRole("checkbox", { name: /Acetaminofén/i }),
      );

      const submitButton = screen.getByRole("button", {
        name: /Procesar devolución/i,
      });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({ saleId: "sale-1" }),
        );
        expect(mockConfirm).toHaveBeenCalled();
      });
    });

    it("shows a success toast after a successful return", async () => {
      renderPage();

      const input = screen.getByPlaceholderText(/Número de venta o UUID/i);
      await userEvent.type(input, "42");
      fireEvent.click(screen.getByRole("button", { name: /Buscar venta/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/Acetaminofén 500mg/i),
        ).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(
          screen.getByRole("checkbox", { name: /Acetaminofén/i }),
        ).toBeInTheDocument();
      });
      fireEvent.click(
        screen.getByRole("checkbox", { name: /Acetaminofén/i }),
      );

      fireEvent.click(
        screen.getByRole("button", { name: /Procesar devolución/i }),
      );

      await waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });
    });
  });

  describe("RETP-05: unverified flow inputs", () => {
    it("shows manual entry fields when switching to the Unverified tab", () => {
      renderPage();

      fireEvent.click(
        screen.getByRole("tab", { name: /^Devolución no verificada$/ }),
      );

      expect(
        screen.getByPlaceholderText(/producto/i),
      ).toBeInTheDocument();
    });
  });

  describe("RETP-06: unverified requires PIN", () => {
    beforeEach(() => {
      setSession({ ...baseSession, role: "MANAGER" });
    });

    it("shows a PIN input field on the unverified tab", () => {
      renderPage();

      fireEvent.click(
        screen.getByRole("tab", { name: /^Devolución no verificada$/ }),
      );

      expect(
        screen.getByLabelText(/pin/i),
      ).toBeInTheDocument();
    });

    it("disables the submit until a 4-digit PIN is entered", async () => {
      renderPage();

      fireEvent.click(
        screen.getByRole("tab", { name: /^Devolución no verificada$/ }),
      );

      // Add a product item
      await userEvent.type(
        screen.getByPlaceholderText(/Buscar producto/i),
        "Ibuprofeno",
      );
      await userEvent.type(
        screen.getByPlaceholderText(/Lote de caché/i),
        "LOT-001",
      );
      fireEvent.click(screen.getByRole("button", { name: /Agregar/i }));

      // Submit button is disabled without PIN
      const submitBtn = screen.getByRole("button", {
        name: /Enviar devolución no verificada/i,
      });
      await waitFor(() => {
        expect(submitBtn).toBeDisabled();
      });

      // Type a short PIN — still disabled (pin.trim().length < 4)
      const pinInput = screen.getByLabelText(/Confirmación PIN de gerente/i);
      await userEvent.type(pinInput, "12");
      await waitFor(() => {
        expect(submitBtn).toBeDisabled();
      });

      // Complete a valid PIN — now enabled
      await userEvent.type(pinInput, "3456");
      await waitFor(() => {
        expect(submitBtn).toBeEnabled();
      });
    });
  });

  describe("RETP-07: error toast", () => {
    it("shows an error banner when returnsService.searchSale throws", async () => {
      mockSearchSale.mockRejectedValue(new Error("Network error"));

      renderPage();

      const input = screen.getByPlaceholderText(/Número de venta o UUID/i);
      await userEvent.type(input, "42");
      fireEvent.click(screen.getByRole("button", { name: /Buscar venta/i }));

      await waitFor(() => {
        expect(
          screen.getByRole("alert"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("RETP-08: submit unverified return", () => {
    beforeEach(() => {
      setSession({ ...baseSession, role: "ADMIN" });
    });

    it("calls returnsService.create with a placeholder sale id and confirm with managerOverride", async () => {
      renderPage();

      fireEvent.click(
        screen.getByRole("tab", { name: /^Devolución no verificada$/ }),
      );

      await userEvent.type(
        screen.getByPlaceholderText(/Buscar producto/i),
        "Acetaminofén 500mg",
      );
      await userEvent.type(
        screen.getByPlaceholderText(/Lote de caché/i),
        "LOT-001",
      );
      fireEvent.click(screen.getByRole("button", { name: /Agregar/i }));

      await userEvent.type(
        screen.getByLabelText(/Confirmación PIN de gerente/i),
        "1234",
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: /Enviar devolución no verificada/i,
        }),
      );

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            saleId: expect.stringMatching(/^UNVERIFIED-/),
            reason: "UNVERIFIED_RETURN",
          }),
        );
        expect(mockConfirm).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ managerOverride: true }),
        );
      });
    });

    it("shows a success toast after a successful unverified return", async () => {
      renderPage();

      fireEvent.click(
        screen.getByRole("tab", { name: /^Devolución no verificada$/ }),
      );

      await userEvent.type(
        screen.getByPlaceholderText(/Buscar producto/i),
        "Acetaminofén 500mg",
      );
      await userEvent.type(
        screen.getByPlaceholderText(/Lote de caché/i),
        "LOT-001",
      );
      fireEvent.click(screen.getByRole("button", { name: /Agregar/i }));

      await userEvent.type(
        screen.getByLabelText(/Confirmación PIN de gerente/i),
        "1234",
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: /Enviar devolución no verificada/i,
        }),
      );

      await waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });
    });
  });

  it("renders a back button that dispatches navigateBackToSales", () => {
    const store = createTestStore();
    const dispatch = vi.spyOn(store, "dispatch");
    renderPage(store);

    const backButton = screen.getByRole("button", { name: /volver/i });
    fireEvent.click(backButton);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ui/navigateBackToSales" }),
    );
  });

  it("renders the page with an accessible aria-label", () => {
    renderPage();

    expect(
      screen.getByRole("region", { name: /^Devoluciones$/ }),
    ).toBeInTheDocument();
  });
});
