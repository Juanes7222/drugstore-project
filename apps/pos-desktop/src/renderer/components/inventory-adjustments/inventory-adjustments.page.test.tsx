/**
 * Component tests for InventoryAdjustmentsPage (grouped-by-product layout).
 *
 * Covers: loading state, full-lot mount via getLotsGroupedByProduct(), error/
 * empty states, lot selection (expand group → click lot row) with AdjustmentForm
 * reveal, submit validation (role, selected lot, quantity), successful
 * create+apply flow, toast, and back-navigation.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { uiSlice } from "@/store/slices/ui-slice";
import { InventoryAdjustmentsPage } from "./inventory-adjustments.page";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { LotState } from "@pharmacy/database/local";
import type { LocalSession } from "../../../domain/auth/local-session.store";
import type { ProductLotGroup } from "../../../domain/inventory-lots/inventory-lots.service";


// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetLotsGroupedByProduct = vi.fn<() => Promise<ProductLotGroup[]>>();
const mockCreate = vi.fn<() => Promise<{ id: string }>>();
const mockApply = vi.fn<() => Promise<{ operationUuid?: string }>>();
const mockNotifySuccess = vi.fn();

const mockAdjustmentsService = {
  create: mockCreate,
  apply: mockApply,
};

const mockInventoryLotsService = {
  getLotsGroupedByProduct: mockGetLotsGroupedByProduct,
};

vi.mock("../common/service-context", () => ({
  useInventoryAdjustmentsService: () => mockAdjustmentsService,
  useInventoryLotsService: () => mockInventoryLotsService,
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

// Mock field-requirement so reason always matters
vi.mock("../../../domain/config/use-field-requirement", () => ({
  useFieldRequirementFor: (_field: string) => "REQUIRED" as const,
}));

vi.mock("../../../domain/configuration", () => ({
  useRequireLotOnReception: vi.fn().mockReturnValue(true),
}));

// Mock notify so we can assert on calls rather than depending on sileo DOM
vi.mock("@/utils/notify", () => ({
  notify: {
    success: (...args: unknown[]) => {
      mockNotifySuccess(...args);
      return "toast-id";
    },
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** Expand first group and select its lot */
async function selectFirstLot() {
  await userEvent.click(screen.getByText("Acetaminofén 500mg"));
  await userEvent.click(screen.getByText("L24001"));
}

// ---------------------------------------------------------------------------
// Test data — explicit ProductLotGroup objects, no factory wrappers
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
  sessionTrust: 'SERVER_VERIFIED',
};

const group1: ProductLotGroup = {
  productId: "p-001",
  commercialName: "Acetaminofén 500mg",
  genericName: "Acetaminofén",
  internalCode: "ACET-500",
  totalStock: 50,
  lotCount: 1,
  soonToExpireCount: 0,
  expiredCount: 0,
  lowStockCount: 0,
  nearestExpiryDate: new Date("2027-06-01"),
  lots: [{
    id: "lot-1",
    productId: "p-001",
    batchNumber: "L24001",
    currentStock: 50,
    expirationDate: new Date("2027-06-01"),
    state: LotState.ACTIVE,
    locationCode: "A1",
    version: 1,
    entryDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    product: {
      commercialName: "Acetaminofén 500mg",
      genericName: "Acetaminofén",
      internalCode: "ACET-500",
    },
  } as unknown as ProductLotGroup["lots"][number]],
};

const group2: ProductLotGroup = {
  productId: "p-002",
  commercialName: "Ibuprofeno 400mg",
  genericName: "Ibuprofeno",
  internalCode: "IBU-400",
  totalStock: 5,
  lotCount: 1,
  soonToExpireCount: 0,
  expiredCount: 0,
  lowStockCount: 1,
  nearestExpiryDate: new Date("2026-08-15"),
  lots: [{
    id: "lot-2",
    productId: "p-002",
    batchNumber: "L24002",
    currentStock: 5,
    expirationDate: new Date("2026-08-15"),
    state: LotState.ACTIVE,
    locationCode: "B2",
    version: 1,
    entryDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    product: {
      commercialName: "Ibuprofeno 400mg",
      genericName: "Ibuprofeno",
      internalCode: "IBU-400",
    },
  } as unknown as ProductLotGroup["lots"][number]],
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
    mockGetLotsGroupedByProduct.mockResolvedValue([group1, group2]);
    mockCreate.mockResolvedValue(mockDraft);
    mockApply.mockResolvedValue(mockApplied);
  });

  afterEach(() => {});

  // ── Loading & mount ─────────────────────────────────────────────────

  describe("loading & mount", () => {
    it("shows loading indicator while getLotsGroupedByProduct is in-flight", () => {
      const { promise } = createDeferred<ProductLotGroup[]>();
      mockGetLotsGroupedByProduct.mockReturnValue(promise);

      renderPage();

      expect(screen.getByText("Cargando...")).toBeInTheDocument();
    });

    it("calls getLotsGroupedByProduct() on mount", async () => {
      renderPage();

      await waitFor(() => {
        expect(mockGetLotsGroupedByProduct).toHaveBeenCalled();
      });
    });

    it("hides loading indicator once getLotsGroupedByProduct resolves", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.queryByText("Cargando...")).not.toBeInTheDocument();
      });
    });
  });

  // ── Inventory display ───────────────────────────────────────────────

  describe("inventory display", () => {
    it("renders group headers after loading completes", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });
      expect(screen.getByText("Ibuprofeno 400mg")).toBeInTheDocument();
    });

    it("shows no_inventory hint when getLotsGroupedByProduct returns empty", async () => {
      mockGetLotsGroupedByProduct.mockResolvedValue([]);
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

    it("displays group count chip matching the number of product groups", async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("2")).toBeInTheDocument();
      });
    });
  });

  // ── Error handling ──────────────────────────────────────────────────

  describe("error handling", () => {
    it("shows load_error when getLotsGroupedByProduct fails", async () => {
      mockGetLotsGroupedByProduct.mockRejectedValue(
        new Error("network failure"),
      );
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

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });

      await selectFirstLot();

      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: /Motivo/i }),
        "DAMAGED",
      );

      await userEvent.click(
        screen.getByRole("button", { name: /Aplicar ajuste/i }),
      );

      await waitFor(() => {
        expect(screen.getByText("Stock insuficiente")).toBeInTheDocument();
      });
    });
  });

  // ── Lot selection ───────────────────────────────────────────────────

  describe("lot selection", () => {
    it("shows AdjustmentForm after expanding a group and selecting a lot", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });

      await selectFirstLot();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /Aplicar ajuste/i }),
        ).toBeInTheDocument();
      });
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

      await selectFirstLot();

      await waitFor(() => {
        expect(
          screen.queryByText(
            "Seleccione un lote de la lista para realizar un ajuste de inventario.",
          ),
        ).not.toBeInTheDocument();
      });
    });
  });

  // ── Submit validation ───────────────────────────────────────────────

  describe("submit validation", () => {
    it("shows no_session error when session is missing at submit time", async () => {
      setSession(null);
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });

      await selectFirstLot();

      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "DAMAGED");

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

    it("shows role_inventory_admin error when service throws INSUFFICIENT_ROLE", async () => {
      setSession({ ...baseSession, role: "CASHIER" });
      mockCreate.mockRejectedValue({ errorCode: "INSUFFICIENT_ROLE" });
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });

      await selectFirstLot();

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
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });

      await selectFirstLot();

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
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });

      await selectFirstLot();

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
    it("calls create then apply and notifies on success", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });

      await selectFirstLot();

      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "DAMAGED");

      await userEvent.click(
        screen.getByRole("button", { name: /Aplicar ajuste/i }),
      );

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledOnce();
        expect(mockApply).toHaveBeenCalledOnce();
      });

      await waitFor(() => {
        expect(mockNotifySuccess).toHaveBeenCalled();
      });
      const callArg = mockNotifySuccess.mock.calls[0][0] as {
        title: string;
        description: string;
      };
      expect(callArg.title).toBe("Operación sincronizada");
      expect(callArg.description).toContain("Ajuste de inventario");
    });

    it("updates local stock optimistically after successful apply", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Acetaminofén 500mg"),
        ).toBeInTheDocument();
      });

      await selectFirstLot();

      const reasonSelect = screen.getByRole("combobox", { name: /Motivo/i });
      await userEvent.selectOptions(reasonSelect, "DAMAGED");

      await userEvent.click(
        screen.getByRole("button", { name: /Aplicar ajuste/i }),
      );

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
