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

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
};

const setSessionRole = (role: string): void => {
  useLocalSessionStore.getState().setSession({ ...baseSession, role });
};

describe("NavigationSidebar", () => {
  beforeEach(() => {
    setSessionRole("CASHIER");
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

      expect(
        screen.getByRole("menuitem", { name: /ventas/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: /devoluciones/i }),
      ).toBeInTheDocument();
      // MANAGER sees inventory-adjustments, sync-health, user-management, audit-log
      expect(
        screen.getByRole("menuitem", { name: /ajustes/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: /salud de sinc/i }),
      ).toBeInTheDocument();
    });

    it("shows admin menu for OWNER role", () => {
      setSessionRole("OWNER");
      renderSidebar();

      expect(
        screen.getByRole("menuitem", { name: /admin/i }),
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
});
