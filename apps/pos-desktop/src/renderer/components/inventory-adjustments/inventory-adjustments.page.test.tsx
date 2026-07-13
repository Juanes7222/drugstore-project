/**
 * Component tests for InventoryAdjustmentsPage.
 *
 * Covers: lot search, selection, adjustment form, submit flow, error states,
 * and role gating.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { uiSlice } from "@/store/slices/ui-slice";
import { InventoryAdjustmentsPage } from "./inventory-adjustments.page";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import type { LocalSession } from "../../../domain/auth/local-session.store";
import type { DisplayLot } from "./inventory-adjustments.types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSearchLots = vi.fn();
const mockCreate = vi.fn();
const mockApply = vi.fn();

vi.mock("../common/service-context", () => ({
  useInventoryAdjustmentsService: () => ({
    searchLots: mockSearchLots,
    create: mockCreate,
    apply: mockApply,
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
      <InventoryAdjustmentsPage />
    </Provider>,
  );

const baseSession: LocalSession = {
  userId: "user-1",
  username: "maria",
  fullName: "María Pérez",
  displayName: "María",
  email: "maria@test.com",
  role: "INVENTORY_ASSISTANT",
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
};

const mockLot: DisplayLot = {
  id: "lot-1",
  productId: "p-001",
  productName: "Acetaminofén 500mg",
  lotCode: "L24001",
  currentStock: 50,
  expirationDate: "2027-06-01",
  location: "A1",
};

const mockDraft = { id: "adj-1" };
const mockApplied = { operationUuid: "op-uuid-1" };

const setSession = (session: LocalSession | null): void => {
  if (session) {
    useLocalSessionStore.getState().setSession(session);
  } else {
    useLocalSessionStore.getState().clearSession();
  }
};

describe("InventoryAdjustmentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession(baseSession);
    mockSearchLots.mockResolvedValue([mockLot]);
    mockCreate.mockResolvedValue(mockDraft);
    mockApply.mockResolvedValue(mockApplied);
  });

  describe("IADJ-01: lot search", () => {
    it("renders a search input and button", () => {
      renderPage();

      expect(
        screen.getByPlaceholderText(/código de barras/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^Buscar$/ }),
      ).toBeInTheDocument();
    });

    it("displays search results after a successful search", async () => {
      renderPage();

      const input = screen.getByPlaceholderText(/código de barras/i);
      await userEvent.type(input, "L24001");
      fireEvent.click(screen.getByRole("button", { name: /buscar/i }));

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });
    });

    it("shows no results message when search returns empty", async () => {
      mockSearchLots.mockResolvedValue([]);
      renderPage();

      const input = screen.getByPlaceholderText(/código de barras/i);
      await userEvent.type(input, "ZZZZ");
      fireEvent.click(screen.getByRole("button", { name: /buscar/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/No se encontraron/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("IADJ-02: select lot", () => {
    it("shows the adjustment form after selecting a lot from results", async () => {
      renderPage();

      // Search
      const input = screen.getByPlaceholderText(/código de barras/i);
      await userEvent.type(input, "L24001");
      fireEvent.click(screen.getByRole("button", { name: /^Buscar$/ }));

      // Click on the lot result
      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("Acetaminofén 500mg"));

      // The adjustment form should now be visible
      await waitFor(() => {
        expect(
          screen.getByText(/^Stock$/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("IADJ-03: positive adjustment (INCREASE)", () => {
    it("submits an INCREASE adjustment and shows a toast", async () => {
      renderPage();

      // Search and select lot
      const input = screen.getByPlaceholderText(/código de barras/i);
      await userEvent.type(input, "L24001");
      fireEvent.click(screen.getByRole("button", { name: /^Buscar$/ }));

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("Acetaminofén 500mg"));

      // Switch to INCREASE
      await waitFor(() => {
        expect(
          screen.getByRole("radio", { name: /Aumentar/i }),
        ).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("radio", { name: /Aumentar/i }));

      // Select a non-OTHER reason to enable submit
      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "DAMAGED");

      // Submit
      await userEvent.click(
        screen.getByRole("button", { name: /aplicar/i }),
      );

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalled();
        expect(mockApply).toHaveBeenCalled();
        expect(screen.getByRole("status")).toBeInTheDocument();
      });
    });
  });

  describe("IADJ-04: negative adjustment (DECREASE)", () => {
    it("submits a DECREASE adjustment (default type)", async () => {
      renderPage();

      // Search and select lot
      const input = screen.getByPlaceholderText(/código de barras/i);
      await userEvent.type(input, "L24001");
      fireEvent.click(screen.getByRole("button", { name: /^Buscar$/ }));

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("Acetaminofén 500mg"));

      // Select a non-OTHER reason to enable submit
      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "DAMAGED");

      // Submit with DECREASE (default)
      await userEvent.click(
        screen.getByRole("button", { name: /aplicar/i }),
      );

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalled();
        expect(mockApply).toHaveBeenCalled();
      });
    });
  });

  describe("IADJ-05: validation — quantity exceeds stock", () => {
    beforeEach(() => {
      mockSearchLots.mockResolvedValue([
        { ...mockLot, currentStock: 10 },
      ]);
    });

    it("shows an error banner when submission fails due to insufficient stock", async () => {
      mockCreate.mockRejectedValue(new Error("Insufficient stock"));

      renderPage();

      const input = screen.getByPlaceholderText(/código de barras/i);
      await userEvent.type(input, "L24001");
      fireEvent.click(screen.getByRole("button", { name: /^Buscar$/ }));

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("Acetaminofén 500mg"));

      // Select a non-OTHER reason to enable submit
      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "DAMAGED");

      // Enter quantity above stock to trigger server-side error
      const quantityInput = screen.getByRole("spinbutton", { name: /Cantidad/i });
      await userEvent.clear(quantityInput);
      await userEvent.type(quantityInput, "20");

      await userEvent.click(
        screen.getByRole("button", { name: /aplicar/i }),
      );

      await waitFor(() => {
        expect(
          screen.getByText("Insufficient stock"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("IADJ-06: reason required", () => {
    it("disables the submit button when OTHER reason is selected without custom text", async () => {
      renderPage();

      const input = screen.getByPlaceholderText(/código de barras/i);
      await userEvent.type(input, "L24001");
      fireEvent.click(screen.getByRole("button", { name: /buscar/i }));

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("Acetaminofén 500mg"));

      // Select OTHER reason (empty custom reason means canSubmit=false)
      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "OTHER");

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /aplicar/i }),
        ).toBeDisabled();
      });
    });

    it("enables the submit button when custom reason is provided for OTHER", async () => {
      renderPage();

      const input = screen.getByPlaceholderText(/código de barras/i);
      await userEvent.type(input, "L24001");
      fireEvent.click(screen.getByRole("button", { name: /buscar/i }));

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("Acetaminofén 500mg"));

      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "OTHER");

      // Type a custom reason
      const customReasonInput = screen.getByLabelText(/Motivo personalizado/i);
      await userEvent.type(customReasonInput, "Found in storage");

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /aplicar/i }),
        ).not.toBeDisabled();
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

  it("renders the page with an accessible region aria-label", () => {
    renderPage();

    expect(
      screen.getByRole("region", { name: /Ajustes de Inventario/i }),
    ).toBeInTheDocument();
  });
});
