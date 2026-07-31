/**
 * Component tests for NavigationSidebar.
 *
 * Covers: role-gated visibility, badge count, expand/collapse behaviour,
 * and navigation dispatch.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore, type Store } from "@reduxjs/toolkit";
import { uiSlice } from "@/store/slices/ui-slice";
import { NavigationSidebar } from "./navigation-sidebar";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import type { LocalSession } from "../../../domain/auth/local-session.store";
import { useUserPreferencesStore } from "../../../stores/user-preferences.store";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Provide matchMedia so motion/react's useReducedMotion works in jsdom.
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

// Mock the local database and sync metrics to avoid PGlite initialisation
// in the badge polling effect.
vi.mock(
  "../../../infrastructure/local-database",
  () => ({ getLocalDatabase: vi.fn() }),
);
vi.mock(
  "../../../domain/sync/sync-metrics.service",
  () => ({ createSyncMetricsService: vi.fn() }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createTestStore = (activeScreen = "sales"): Store => {
  const store = configureStore({
    reducer: { ui: uiSlice.reducer },
  });
  store.dispatch({ type: "ui/setActiveScreen", payload: activeScreen });
  return store;
};

const renderSidebar = (store = createTestStore()) =>
  render(
    <Provider store={store}>
      <NavigationSidebar />
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

const setSessionRole = (role: string): void => {
  useLocalSessionStore.getState().setSession({ ...baseSession, role });
};

describe("NavigationSidebar", () => {
  beforeEach(() => {
    setSessionRole("CASHIER");
    // Reset the persisted pin state so tests start from a collapsed rail.
    useUserPreferencesStore.setState({ sidebarPinned: false });
  });

  describe("NAV-01: CASHIER visibility", () => {
    it("shows Sales and Returns for CASHIER role", () => {
      renderSidebar();

      expect(
        screen.getByRole("menuitem", { name: /ventas/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: /devoluciones/i }),
      ).toBeInTheDocument();
    });

    it("hides Admin and Sync Health for CASHIER", () => {
      renderSidebar();

      expect(
        screen.queryByRole("menuitem", { name: /admin/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("menuitem", { name: /salud de sinc/i }),
      ).not.toBeInTheDocument();
    });

    it("hides Inventory Adjustments for CASHIER", () => {
      renderSidebar();

      expect(
        screen.queryByRole("menuitem", { name: /ajustes/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("NAV-02: ADMIN visibility", () => {
    beforeEach(() => {
      setSessionRole("MANAGER");
    });

    it("shows all navigation items for MANAGER role", () => {
      renderSidebar();

      // Exact names — /ventas/i would also match "Historial Ventas".
      expect(
        screen.getByRole("menuitem", { name: "Ventas" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "Devoluciones" }),
      ).toBeInTheDocument();
      // MANAGER sees productos (inventory hub), sync-health, user-management, audit-log
      expect(
        screen.getByRole("menuitem", { name: "Productos" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: /salud de sinc/i }),
      ).toBeInTheDocument();
    });

    it("shows admin menu for OWNER role", () => {
      setSessionRole("OWNER");
      renderSidebar();

      expect(
        screen.getByRole("menuitem", { name: "Configuración" }),
      ).toBeInTheDocument();
    });
  });

  describe("NAV-03: badge count", () => {
    it("does not show a badge when count is 0", () => {
      renderSidebar();

      // Badge is only rendered when badgeCount > 0
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });
  });

  describe("NAV-04: collapsed by default", () => {
    it("renders the nav element with data-expanded false", () => {
      renderSidebar();

      const nav = screen.getByRole("navigation");
      expect(nav).toHaveAttribute("data-expanded", "false");
    });

    it("renders labels hidden when collapsed", () => {
      renderSidebar();

      // Labels have data-visible="false" when collapsed
      const labels = document.querySelectorAll("[data-visible='false']");
      expect(labels.length).toBeGreaterThan(0);
    });
  });

  describe("NAV-05: expands on hover", () => {
    it("sets data-expanded to true when the mouse enters", () => {
      renderSidebar();

      const nav = screen.getByRole("navigation");
      fireEvent.mouseEnter(nav);

      expect(nav).toHaveAttribute("data-expanded", "true");
    });

    it("sets data-expanded back to false when the mouse leaves", () => {
      renderSidebar();

      const nav = screen.getByRole("navigation");
      fireEvent.mouseEnter(nav);
      fireEvent.mouseLeave(nav);

      expect(nav).toHaveAttribute("data-expanded", "false");
    });

    it("shows labels when expanded via mouseEnter", () => {
      renderSidebar();

      const nav = screen.getByRole("navigation");
      fireEvent.mouseEnter(nav);

      const visibleLabels = document.querySelectorAll("[data-visible='true']");
      expect(visibleLabels.length).toBeGreaterThan(0);
    });
  });

  describe("NAV-06: navigation dispatch", () => {
    it("dispatches setActiveScreen when a nav item is clicked", () => {
      const store = createTestStore();
      const dispatch = vi.spyOn(store, "dispatch");
      renderSidebar(store);

      fireEvent.click(
        screen.getByRole("menuitem", { name: /devoluciones/i }),
      );

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ui/setActiveScreen",
          payload: "returns",
        }),
      );
    });

    it("sets aria-current on the active screen button", () => {
      const store = createTestStore("returns");
      renderSidebar(store);

      const returnsButton = screen.getByRole("menuitem", {
        name: /devoluciones/i,
      });
      expect(returnsButton).toHaveAttribute("aria-current", "page");
    });

    it("does not set aria-current on inactive screen buttons", () => {
      const store = createTestStore("sales");
      renderSidebar(store);

      const returnsButton = screen.getByRole("menuitem", {
        name: /devoluciones/i,
      });
      expect(returnsButton).not.toHaveAttribute("aria-current");
    });
  });

  describe("alwaysExpanded prop", () => {
    it("keeps the sidebar expanded when alwaysExpanded is true", () => {
      render(
        <Provider store={createTestStore()}>
          <NavigationSidebar alwaysExpanded={true} />
        </Provider>,
      );

      const nav = screen.getByRole("navigation");
      expect(nav).toHaveAttribute("data-expanded", "true");
    });
  });

  it("renders a navigation landmark with an accessible label", () => {
    renderSidebar();

    expect(
      screen.getByRole("navigation", { name: /navegación/i }),
    ).toBeInTheDocument();
  });

  it("renders the menubar role with vertical orientation", () => {
    renderSidebar();

    expect(
      screen.getByRole("menubar"),
    ).toHaveAttribute("aria-orientation", "vertical");
  });

  describe("NAV-07: category grouping", () => {
    it("renders category headers only when expanded", () => {
      setSessionRole("OWNER");
      renderSidebar();

      // Collapsed: headers are present in the DOM but invisible.
      const headers = document.querySelectorAll(".pos-sidebar__group-label");
      expect(headers.length).toBeGreaterThan(0);

      fireEvent.mouseEnter(screen.getByRole("navigation"));

      expect(headers[0]).toHaveAttribute("data-visible", "true");
    });

    it("groups items under their category header", () => {
      setSessionRole("OWNER");
      renderSidebar();

      // First category header should be "Operación" — home/ventas live under it.
      const headers = document.querySelectorAll(".pos-sidebar__group-label");
      expect(headers[0]).toHaveTextContent(/operación/i);
    });
  });

  describe("NAV-08: pin toggle", () => {
    it("starts collapsed when unpinned", () => {
      renderSidebar();

      expect(
        screen.getByRole("navigation"),
      ).toHaveAttribute("data-expanded", "false");
    });

    it("pins the sidebar open when the pin button is clicked", () => {
      renderSidebar();

      const pin = screen.getByRole("button", { name: /expandir menú/i });
      fireEvent.click(pin);

      expect(
        screen.getByRole("navigation"),
      ).toHaveAttribute("data-expanded", "true");
      expect(
        useUserPreferencesStore.getState().sidebarPinned,
      ).toBe(true);
    });

    it("keeps the sidebar expanded after mouse leave when pinned", () => {
      renderSidebar();

      const pin = screen.getByRole("button", { name: /expandir menú/i });
      fireEvent.click(pin);
      fireEvent.mouseEnter(screen.getByRole("navigation"));
      fireEvent.mouseLeave(screen.getByRole("navigation"));

      expect(
        screen.getByRole("navigation"),
      ).toHaveAttribute("data-expanded", "true");
    });

    it("unpins when clicked again", () => {
      renderSidebar();

      const pin = screen.getByRole("button", { name: /expandir menú/i });
      fireEvent.click(pin);
      fireEvent.click(pin);

      expect(
        screen.getByRole("navigation"),
      ).toHaveAttribute("data-expanded", "false");
    });
  });
});
