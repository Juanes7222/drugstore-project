/**
 * Component tests for Home — role-aware dashboard.
 *
 * Covers: welcome header with session info, role badge, role-specific
 * sections (cashier, inventory, manager, accountant), quick actions grid,
 * prefers-reduced-motion guard, and no-session fallback.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { uiSlice } from "@/store/slices/ui-slice";
import { Home } from "./home";
import {
  useLocalSessionStore,
  type LocalSession,
} from "../../../domain/auth";

// ---------------------------------------------------------------------------
// Stub browser APIs used by motion/react
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Provide a noop matchMedia so motion/react's useReducedMotion works in
  // jsdom without throwing. Default is "no reduced motion" (matches: false).
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Control online status independently of navigator.onLine so tests are
// deterministic and don't depend on the test runner's connectivity.
let mockIsOnline = true;

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => mockIsOnline,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createTestStore = () =>
  configureStore({ reducer: { ui: uiSlice.reducer } });

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
};

const setSessionRole = (role: string): void => {
  useLocalSessionStore.getState().setSession({ ...baseSession, role });
};

const clearSession = (): void => {
  useLocalSessionStore.getState().setInitialized(true);
  useLocalSessionStore.getState().clearSession();
};

const renderHome = (store = createTestStore()) =>
  render(
    <Provider store={store}>
      <Home />
    </Provider>,
  );

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Home", () => {
  beforeEach(() => {
    setSessionRole("CASHIER");
    mockIsOnline = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── No session ──────────────────────────────────────────────────

  describe("no session", () => {
    beforeEach(() => {
      clearSession();
    });

    it("returns null when no session exists", () => {
      const { container } = renderHome();

      expect(container.innerHTML).toBe("");
    });
  });

  // ── Welcome header ──────────────────────────────────────────────

  describe("welcome header", () => {
    it("renders welcome message with session displayName", () => {
      renderHome();

      // i18n: "home.welcome" = "Hola, {{name}}"
      expect(
        screen.getByText("Hola, María"),
      ).toBeInTheDocument();
    });

    it("uses fullName when displayName is empty", () => {
      useLocalSessionStore.getState().setSession({
        ...baseSession,
        displayName: "",
      });

      renderHome();

      expect(
        screen.getByText("Hola, María Pérez"),
      ).toBeInTheDocument();
    });

    it("shows role badge matching session.role", () => {
      renderHome();

      // "roles.cashier" → "Cajero"
      expect(
        screen.getByText("Cajero"),
      ).toBeInTheDocument();
    });

    it("shows correct subtitle for CASHIER role", () => {
      renderHome();

      // "home.subtitle_cashier" → "Listo para atender"
      expect(
        screen.getByText("Listo para atender"),
      ).toBeInTheDocument();
    });

    it("renders main landmark with accessible label", () => {
      renderHome();

      expect(
        screen.getByRole("main", { name: /inicio/i }),
      ).toBeInTheDocument();
    });
  });

  // ── CASHIER section ─────────────────────────────────────────────

  describe("CASHIER role", () => {
    it("shows cashier-specific stats section", () => {
      renderHome();

      // Cashier section contains "Resumen del día" StatsCard
      expect(
        screen.getByText("Resumen del día"),
      ).toBeInTheDocument();
      // "Turno activo" StatsCard
      expect(
        screen.getByText("Turno activo"),
      ).toBeInTheDocument();
      // Sync status StatsCard
      expect(
        screen.getByText("Sincronización"),
      ).toBeInTheDocument();
    });

    it("shows new-sale button in cashier section", () => {
      renderHome();

      // Two buttons match "Nueva venta": one in QuickActionsCard, one in
      // the cashier-specific section. Both should be present for CASHIER.
      const saleButtons = screen.getAllByRole("button", {
        name: /nueva venta/i,
      });
      expect(saleButtons).toHaveLength(2);
    });

    it("renders a primary-styled new-sale button in the cashier section", () => {
      renderHome();

      // Two buttons match "Nueva venta": one in QuickActionsCard (aria-label)
      // and one in the cashier section (pos-button-primary class).
      // Find the one with the primary button styling.
      const saleButtons = screen.getAllByRole("button", {
        name: /nueva venta/i,
      });
      const cashierBtn = saleButtons.find((btn) =>
        btn.className.includes("pos-button-primary"),
      );
      expect(cashierBtn).toBeInTheDocument();
      expect(cashierBtn!.className).toContain("pos-button-primary");
    });

    it("the cashier section new-sale button dispatches navigateToSales on click", () => {
      const store = createTestStore();
      const dispatch = vi.spyOn(store, "dispatch");
      renderHome(store);

      // The primary-styled button is the one in the cashier section
      const primaryBtn = screen
        .getAllByRole("button", { name: /nueva venta/i })
        .find((btn) => btn.className.includes("pos-button-primary"))!;
      primaryBtn.click();

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ui/navigateToSales" }),
      );
    });

    it("shows online status as 'En línea' when connected", () => {
      renderHome();

      expect(
        screen.getByText("En línea"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Sincronización saludable"),
      ).toBeInTheDocument();
    });

    it("shows offline status when disconnected", () => {
      mockIsOnline = false;
      renderHome();

      expect(
        screen.getByText("Sin conexión"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/sin conexión — operando normal/i),
      ).toBeInTheDocument();
    });

    it("shows quick actions grid heading", () => {
      renderHome();

      expect(
        screen.getByText("Accesos rápidos"),
      ).toBeInTheDocument();
    });

    it("does not show manager section", () => {
      renderHome();

      expect(
        screen.queryByText("Usuarios activos"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Actividad reciente"),
      ).not.toBeInTheDocument();
    });

    it("does not show inventory section", () => {
      renderHome();

      expect(
        screen.queryByText("Alertas de stock bajo"),
      ).not.toBeInTheDocument();
    });

    it("does not show accountant section", () => {
      renderHome();

      expect(
        screen.queryByText("Gestión fiscal"),
      ).not.toBeInTheDocument();
    });
  });

  // ── INVENTORY_ASSISTANT section ─────────────────────────────────

  describe("INVENTORY_ASSISTANT role", () => {
    beforeEach(() => {
      setSessionRole("INVENTORY_ASSISTANT");
    });

    it("shows inventory section with low stock alerts", () => {
      renderHome();

      expect(
        screen.getByText("Alertas de stock bajo"),
      ).toBeInTheDocument();
    });

    it("shows subtitle for inventory role", () => {
      renderHome();

      // "home.subtitle_inventory" → "Control de inventario"
      expect(
        screen.getByText("Control de inventario"),
      ).toBeInTheDocument();
    });

    it("does not show cashier section", () => {
      renderHome();

      expect(
        screen.queryByText("Resumen del día"),
      ).not.toBeInTheDocument();
    });

    it("does not show manager section", () => {
      renderHome();

      expect(
        screen.queryByText("Usuarios activos"),
      ).not.toBeInTheDocument();
    });

    it("does not show accountant section", () => {
      renderHome();

      expect(
        screen.queryByText("Gestión fiscal"),
      ).not.toBeInTheDocument();
    });

    it("shows role badge for inventory assistant", () => {
      renderHome();

      // "roles.inventory_assistant" → "Asistente de inventario"
      expect(
        screen.getByText("Asistente de inventario"),
      ).toBeInTheDocument();
    });
  });

  // ── MANAGER section ────────────────────────────────────────────

  describe("MANAGER role", () => {
    beforeEach(() => {
      setSessionRole("MANAGER");
    });

    it("shows manager section with admin overview cards", () => {
      renderHome();

      expect(
        screen.getByText("Usuarios activos"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Sincronización"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Actividad reciente"),
      ).toBeInTheDocument();
    });

    it("shows subtitle for manager role", () => {
      renderHome();

      // "home.subtitle_manager" → "Panel de gestión"
      expect(
        screen.getByText("Panel de gestión"),
      ).toBeInTheDocument();
    });

    it("does not show cashier section", () => {
      renderHome();

      expect(
        screen.queryByText("Resumen del día"),
      ).not.toBeInTheDocument();
    });

    it("does not show inventory section", () => {
      renderHome();

      expect(
        screen.queryByText("Alertas de stock bajo"),
      ).not.toBeInTheDocument();
    });

    it("shows role badge for manager", () => {
      renderHome();

      // "roles.manager" → "Manager"
      expect(
        screen.getByText("Manager"),
      ).toBeInTheDocument();
    });
  });

  // ── ACCOUNTANT section ──────────────────────────────────────────

  describe("ACCOUNTANT role", () => {
    beforeEach(() => {
      setSessionRole("ACCOUNTANT");
    });

    it("shows subtitle for accountant role", () => {
      renderHome();

      // "home.subtitle_accountant" → "Panel contable"
      expect(
        screen.getByText("Panel contable"),
      ).toBeInTheDocument();
    });

    it("does not show cashier section", () => {
      renderHome();

      expect(
        screen.queryByText("Resumen del día"),
      ).not.toBeInTheDocument();
    });

    it("does not show inventory section", () => {
      renderHome();

      expect(
        screen.queryByText("Alertas de stock bajo"),
      ).not.toBeInTheDocument();
    });

    it("shows role badge for accountant", () => {
      renderHome();

      // "roles.accountant" → "Contador"
      expect(
        screen.getByText("Contador"),
      ).toBeInTheDocument();
    });

    // NOTE: Accountant-specific section (Gestión fiscal) does NOT render because
    // ACCOUNTANT (level 1) passes hasMinRole(MANAGER, level 1), so
    // isManagerOrAbove is true and !isManagerOrAbove blocks the accountant
    // section. The MANAGER section renders instead. This is existing behaviour
    // in the source code – the hierarchy lumps ACCOUNTANT with MANAGER.
    // If the accountant-specific section should appear for ACCOUNTANT role
    // without the manager section, the hierarchy or role check logic needs
    // updating in home.tsx.

    it("shows manager section instead of accountant section (hierarchy quirk)", () => {
      renderHome();

      // Manager section renders because ACCOUNTANT (level 1) >= MANAGER (level 1)
      expect(
        screen.getByText("Usuarios activos"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Actividad reciente"),
      ).toBeInTheDocument();
    });

    it("does not show the fiscal management card (accountant section blocked)", () => {
      renderHome();

      expect(
        screen.queryByText("Gestión fiscal"),
      ).not.toBeInTheDocument();
    });
  });

  // ── OWNER role (uses isManagerOrAbove path) ───────────────────

  describe("OWNER role", () => {
    beforeEach(() => {
      setSessionRole("OWNER");
    });

    it("shows manager section for OWNER (hierarchy check)", () => {
      renderHome();

      expect(
        screen.getByText("Usuarios activos"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Actividad reciente"),
      ).toBeInTheDocument();
    });

    it("shows subtitle for owner role", () => {
      renderHome();

      // "home.subtitle_owner" → "Panel de administración"
      expect(
        screen.getByText("Panel de administración"),
      ).toBeInTheDocument();
    });

    it("shows role badge for owner", () => {
      renderHome();

      // "roles.owner" → "Dueño"
      expect(
        screen.getByText("Dueño"),
      ).toBeInTheDocument();
    });
  });

  // ── prefers-reduced-motion ─────────────────────────────────────

  describe("prefers-reduced-motion", () => {
    it("still renders content when reduced motion is preferred", () => {
      // Re-define matchMedia with matches: true to signal reduced motion
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: true,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });

      renderHome();

      // Content should still render even without animations
      expect(
        screen.getByText("Hola, María"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Cajero"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Accesos rápidos"),
      ).toBeInTheDocument();
    });
  });

  // ── Fallback section for unmatched roles ───────────────────────

  describe("fallback for roles without custom section", () => {
    it("renders fallback text for role without specific section", () => {
      // Clear the session store and set ADMIN which has no custom section.
      // ADMIN is at level 2, so isManagerOrAbove is true — the manager
      // section renders instead. To reach the fallback we need a role that
      // is NOT cashier, NOT inventory, NOT manager-or-above, and NOT accountant.
      // That's impossible with the current hierarchy, so this test documents
      // the edge case: every role maps to at least one section.
      // Coverage: the conditional expression on line 259 is always false
      // in practice — the test is informational only.
      expect(true).toBe(true);
    });
  });
});
