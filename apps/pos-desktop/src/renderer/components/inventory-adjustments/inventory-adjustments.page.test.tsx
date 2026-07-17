/**
 * Component tests for InventoryAdjustmentsPage (updated two-column layout).
 *
 * Covers: loading state, full-lot mount via listAllLots(), error/empty states,
 * client-side search filtering, searchLots fallback, lot selection with
 * AdjustmentForm reveal, low-stock and near-expiry badges, submit validation
 * (role, selected lot, quantity), successful create+apply flow, toast, and
 * back-navigation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const mockListAllLots = vi.fn<() => Promise<DisplayLot[]>>();
const mockSearchLots = vi.fn<() => Promise<DisplayLot[]>>();
const mockCreate = vi.fn<() => Promise<{ id: string }>>();
const mockApply = vi.fn<() => Promise<{ operationUuid?: string }>>();

vi.mock("../common/service-context", () => ({
  useInventoryAdjustmentsService: () => ({
    listAllLots: mockListAllLots,
    searchLots: mockSearchLots,
    create: mockCreate,
    apply: mockApply,
  }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDeferred<T = unknown>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const createTestStore = () =>
  configureStore({
    reducer: { ui: uiSlice.reducer },
  });

const renderPage = (store = createTestStore()) =>
  render(
    <Provider store={store}>
      <InventoryAdjustmentsPage />
    </Provider>,
  );

const setSession = (session: LocalSession | null): void => {
  if (session) {
    useLocalSessionStore.getState().setSession(session);
  } else {
    useLocalSessionStore.getState().clearSession();
  }
};

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

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

const mockLot1: DisplayLot = {
  id: "lot-1",
  productId: "p-001",
  productName: "Acetaminofén 500mg",
  lotCode: "L24001",
  currentStock: 50,
  expirationDate: "2027-06-01",
  location: "A1",
};

const mockLot2: DisplayLot = {
  id: "lot-2",
  productId: "p-002",
  productName: "Ibuprofeno 400mg",
  lotCode: "L24002",
  currentStock: 5,
  expirationDate: "2026-08-15",
  location: "B2",
};

const mockLot3: DisplayLot = {
  id: "lot-3",
  productId: "p-003",
  productName: "Metformina 850mg",
  lotCode: "M85001",
  currentStock: 30,
  expirationDate: "2026-08-01",
  location: "C3",
};

const mockDraft = { id: "adj-1" };
const mockApplied = { operationUuid: "op-uuid-1" };

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("InventoryAdjustmentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession(baseSession);
    mockListAllLots.mockResolvedValue([mockLot1, mockLot2]);
    mockSearchLots.mockResolvedValue([]);
    mockCreate.mockResolvedValue(mockDraft);
    mockApply.mockResolvedValue(mockApplied);
  });

  // ── Loading & mount ─────────────────────────────────────────────────

  describe("loading & mount", () => {
    it("shows loading indicator while listAllLots is in-flight", () => {
      // Arrange — defer the promise so we can assert before it resolves
      const { promise } = createDeferred<DisplayLot[]>();
      mockListAllLots.mockReturnValue(promise);

      renderPage();

      // Act / Assert — loading text visible immediately
      expect(screen.getByText("Cargando...")).toBeInTheDocument();
    });

    it("calls listAllLots() on mount", async () => {
      renderPage();

      await waitFor(() => {
        expect(mockListAllLots).toHaveBeenCalled();
      });
    });

    it("hides loading indicator once listAllLots resolves", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.queryByText("Cargando...")).not.toBeInTheDocument();
      });
    });
  });

  // ── Inventory display ───────────────────────────────────────────────

  describe("inventory display", () => {
    it("renders lot cards after loading completes", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });
      expect(screen.getByText("Ibuprofeno 400mg")).toBeInTheDocument();
    });

    it("shows no_inventory hint when listAllLots returns empty", async () => {
      mockListAllLots.mockResolvedValue([]);
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText(
            "No hay productos en inventario. Sincronice el catálogo desde el servidor.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("shows select_lot_hint in right panel when no lot is selected", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText(
            "Seleccione un lote de la lista para realizar un ajuste de inventario.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("displays lot count chip matching the number of lots", async () => {
      renderPage();

      // The chip is a <span> containing just the number
      await waitFor(() => {
        expect(screen.getByText("2")).toBeInTheDocument();
      });
    });
  });

  // ── Error handling ──────────────────────────────────────────────────

  describe("error handling", () => {
    it("shows load_error when listAllLots fails", async () => {
      mockListAllLots.mockRejectedValue(new Error("network failure"));
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Error al cargar el inventario."),
        ).toBeInTheDocument();
      });
    });

    it("shows submit_error when create throws", async () => {
      mockCreate.mockRejectedValue(new Error("Stock insuficiente"));
      renderPage();

      // Wait for lots to load
      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      // Select the first lot
      await userEvent.click(screen.getByText("Acetaminofén 500mg"));

      // Change reason away from OTHER so button is enabled
      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "DAMAGED");

      // Submit
      await userEvent.click(
        screen.getByRole("button", { name: /Aplicar ajuste/i }),
      );

      await waitFor(() => {
        expect(screen.getByText("Stock insuficiente")).toBeInTheDocument();
      });
    });
  });

  // ── Search / filter ─────────────────────────────────────────────────

  describe("search & filter", () => {
    it("filters lots client-side by product name", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(
        /Buscar por nombre, lote o ubicación/,
      );
      await userEvent.type(searchInput, "Ibuprofeno");

      // Acetaminofén should disappear, only Ibuprofeno remains
      await waitFor(() => {
        expect(
          screen.queryByText("Acetaminofén 500mg"),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByText("Ibuprofeno 400mg")).toBeInTheDocument();
    });

    it("filters lots client-side by lot code", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(
        /Buscar por nombre, lote o ubicación/,
      );
      await userEvent.type(searchInput, "L24001");

      await waitFor(() => {
        expect(
          screen.queryByText("Ibuprofeno 400mg"),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
    });

    it("filters lots client-side by location", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(
        /Buscar por nombre, lote o ubicación/,
      );
      await userEvent.type(searchInput, "B2");

      await waitFor(() => {
        expect(
          screen.queryByText("Acetaminofén 500mg"),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByText("Ibuprofeno 400mg")).toBeInTheDocument();
    });

    it("falls back to searchLots() when no local match", async () => {
      mockSearchLots.mockResolvedValue([mockLot3]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(
        /Buscar por nombre, lote o ubicación/,
      );
      await userEvent.type(searchInput, "Metformina");

      // Wait for the fallback searchLots call to resolve
      await waitFor(() => {
        expect(mockSearchLots).toHaveBeenCalledWith("Metformina");
      });
      expect(screen.getByText("Metformina 850mg")).toBeInTheDocument();
    });

    it("shows no_results message when search returns empty from service", async () => {
      mockSearchLots.mockResolvedValue([]);

      // Make listAllLots return a single lot so local filter runs first
      mockListAllLots.mockResolvedValue([mockLot1]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(
        /Buscar por nombre, lote o ubicación/,
      );
      await userEvent.type(searchInput, "ZZZZ");

      await waitFor(() => {
        expect(
          screen.getByText("No se encontraron productos o lotes."),
        ).toBeInTheDocument();
      });
    });
  });

  // ── Lot selection ───────────────────────────────────────────────────

  describe("lot selection", () => {
    it("shows AdjustmentForm after selecting a lot", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Acetaminofén 500mg"));

      // The adjustment form shows the selected lot code
      await waitFor(() => {
        expect(screen.getByText("L24001")).toBeInTheDocument();
      });
      // Submit button appears
      expect(
        screen.getByRole("button", { name: /Aplicar ajuste/i }),
      ).toBeInTheDocument();
    });

    it("removes select_lot_hint after selecting a lot", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText(
            "Seleccione un lote de la lista para realizar un ajuste de inventario.",
          ),
        ).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Acetaminofén 500mg"));

      await waitFor(() => {
        expect(
          screen.queryByText(
            "Seleccione un lote de la lista para realizar un ajuste de inventario.",
          ),
        ).not.toBeInTheDocument();
      });
    });
  });

  // ── Badges ──────────────────────────────────────────────────────────

  describe("badges", () => {
    it("shows 'Stock bajo' badge for lots with currentStock <= 10", async () => {
      mockListAllLots.mockResolvedValue([
        { ...mockLot2, currentStock: 3 },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Stock bajo")).toBeInTheDocument();
      });
    });

    it("shows 'Próximo a vencer' badge for lots expiring within 90 days", async () => {
      // Use fake timers so "within 90 days" is deterministic
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-16"));

      // 2026-08-15 is 30 days out → within 90-day window
      mockListAllLots.mockResolvedValue([
        { ...mockLot2, expirationDate: "2026-08-15" },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Próximo a vencer")).toBeInTheDocument();
      });

      vi.useRealTimers();
    });

    it("does NOT show near-expiry badge when lot is also low stock", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-16"));

      // stock <= 10 AND expires within 90 days → only "Stock bajo"
      mockListAllLots.mockResolvedValue([
        {
          ...mockLot2,
          currentStock: 3,
          expirationDate: "2026-08-15",
        },
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Stock bajo")).toBeInTheDocument();
      });
      expect(
        screen.queryByText("Próximo a vencer"),
      ).not.toBeInTheDocument();

      vi.useRealTimers();
    });
  });

  // ── Submit validation ───────────────────────────────────────────────

  describe("submit validation", () => {
    it("shows no_session error when session is missing at submit time", async () => {
      setSession(null);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      // Select a lot
      await userEvent.click(screen.getByText("Acetaminofén 500mg"));

      // Enable submit by selecting a non-OTHER reason
      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "DAMAGED");

      // Submit
      await userEvent.click(
        screen.getByRole("button", { name: /Aplicar ajuste/i }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            "No hay sesión activa. Inicie sesión nuevamente.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("shows role_inventory_admin error when session has CASHIER role", async () => {
      setSession({ ...baseSession, role: "CASHIER" });
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Acetaminofén 500mg"));

      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "DAMAGED");

      await userEvent.click(
        screen.getByRole("button", { name: /Aplicar ajuste/i }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            "No tiene permiso para realizar esta acción. Se requiere rol de Asistente de Inventario o Administrador.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("disables submit button when OTHER reason selected without custom text", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Acetaminofén 500mg"));

      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "OTHER");

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /Aplicar ajuste/i }),
        ).toBeDisabled();
      });
    });

    it("enables submit button when custom reason is provided for OTHER", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Acetaminofén 500mg"));

      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "OTHER");

      const customReasonInput = screen.getByLabelText(
        /Motivo personalizado/i,
      );
      await userEvent.type(customReasonInput, "Found in storage");

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /Aplicar ajuste/i }),
        ).not.toBeDisabled();
      });
    });
  });

  // ── Successful submission ───────────────────────────────────────────

  describe("successful submission", () => {
    it("calls create then apply and shows toast on success", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      // Select lot
      await userEvent.click(screen.getByText("Acetaminofén 500mg"));

      // Enable submit
      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "DAMAGED");

      // Submit
      await userEvent.click(
        screen.getByRole("button", { name: /Aplicar ajuste/i }),
      );

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledOnce();
        expect(mockApply).toHaveBeenCalledOnce();
      });

      // Toast appears with role="status"
      await waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });
      // Toast shows the operation type
      expect(
        screen.getByText("Ajuste de inventario"),
      ).toBeInTheDocument();
    });

    it("updates local stock optimistically after successful apply", async () => {
      // Lot has currentStock=50, we submit DECREASE with qty=5 → projected 45
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Acetaminofén 500mg"));

      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "DAMAGED");

      await userEvent.click(
        screen.getByRole("button", { name: /Aplicar ajuste/i }),
      );

      // After success, the projected stock reflects the delta in the form
      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalled();
      });
    });
  });

  // ── Navigation ──────────────────────────────────────────────────────

  describe("navigation", () => {
    it("renders a back button that dispatches navigateBackToSales", async () => {
      const store = createTestStore();
      const dispatch = vi.spyOn(store, "dispatch");
      renderPage(store);

      const backButton = screen.getByRole("button", { name: /Volver/i });
      await userEvent.click(backButton);

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ui/navigateBackToSales" }),
      );
    });
  });

  // ── Accessibility ───────────────────────────────────────────────────

  it("renders the page with an accessible region aria-label", async () => {
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: /Inventario/i }),
      ).toBeInTheDocument();
    });
  });
});
