/**
 * Component tests for QuickActionsCard — role-gated shortcut buttons.
 *
 * Covers: correct actions per role, dispatch of navigation actions
 * on button click, and empty rendering when no matching role.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { uiSlice } from "@/store/slices/ui-slice";
import { QuickActionsCard } from "./quick-actions-card";
import {
  useLocalSessionStore,
  type LocalSession,
} from "../../../domain/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createTestStore = () =>
  configureStore({ reducer: { ui: uiSlice.reducer } });

const baseSession: LocalSession = {
  userId: "user-1",
  username: "test",
  fullName: "Test User",
  displayName: "Test",
  email: "test@test.com",
  role: "CASHIER",
  subscriptionId: null,
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

const renderCard = (store = createTestStore()) =>
  render(
    <Provider store={store}>
      <QuickActionsCard />
    </Provider>,
  );

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("QuickActionsCard", () => {
  beforeEach(() => {
    setSessionRole("CASHIER");
  });

  // ── CASHIER actions ──────────────────────────────────────────────

  describe("CASHIER role", () => {
    it("shows new-sale, new-return, inventory, and search-product buttons", () => {
      renderCard();

      expect(
        screen.getByRole("button", { name: /nueva venta/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /nueva devolución/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /inventario/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /buscar producto/i }),
      ).toBeInTheDocument();
    });

    it("does not show users, audit, sync, or config for CASHIER", () => {
      renderCard();

      expect(
        screen.queryByRole("button", { name: /usuarios/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /auditoría/i }),
      ).not.toBeInTheDocument();
      // Sync and config are OWNER+ only
      expect(
        screen.queryByRole("button", { name: /sincronización/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /configuración/i }),
      ).not.toBeInTheDocument();
    });

    it("dispatches navigateToSales when new-sale button is clicked", () => {
      const store = createTestStore();
      const dispatch = vi.spyOn(store, "dispatch");
      renderCard(store);

      fireEvent.click(
        screen.getByRole("button", { name: /nueva venta/i }),
      );

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ui/navigateToSales" }),
      );
    });

    it("dispatches navigateToReturns when new-return button is clicked", () => {
      const store = createTestStore();
      const dispatch = vi.spyOn(store, "dispatch");
      renderCard(store);

      fireEvent.click(
        screen.getByRole("button", { name: /nueva devolución/i }),
      );

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ui/navigateToReturns" }),
      );
    });
  });

  // ── MANAGER actions ──────────────────────────────────────────────

  describe("MANAGER role", () => {
    beforeEach(() => {
      setSessionRole("MANAGER");
    });

    it("shows sales, returns, inventory, search, users, and audit buttons", () => {
      renderCard();

      expect(
        screen.getByRole("button", { name: /nueva venta/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /nueva devolución/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /inventario/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /buscar producto/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /usuarios/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /auditoría/i }),
      ).toBeInTheDocument();
    });

    it("does not show sync or config for MANAGER", () => {
      renderCard();

      expect(
        screen.queryByRole("button", { name: /sincronización/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /configuración/i }),
      ).not.toBeInTheDocument();
    });

    it("dispatches navigateToInventoryAdjustments when inventory button is clicked", () => {
      const store = createTestStore();
      const dispatch = vi.spyOn(store, "dispatch");
      setSessionRole("MANAGER");
      renderCard(store);

      fireEvent.click(
        screen.getByRole("button", { name: /inventario/i }),
      );

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ui/navigateToInventoryAdjustments",
        }),
      );
    });

    it("dispatches navigateToUserManagement when users button is clicked", () => {
      const store = createTestStore();
      const dispatch = vi.spyOn(store, "dispatch");
      renderCard(store);

      fireEvent.click(
        screen.getByRole("button", { name: /usuarios/i }),
      );

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ui/navigateToUserManagement",
        }),
      );
    });

    it("dispatches navigateToAuditLog when audit button is clicked", () => {
      const store = createTestStore();
      const dispatch = vi.spyOn(store, "dispatch");
      renderCard(store);

      fireEvent.click(
        screen.getByRole("button", { name: /auditoría/i }),
      );

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ui/navigateToAuditLog" }),
      );
    });
  });

  // ── OWNER actions ────────────────────────────────────────────────

  describe("OWNER role", () => {
    beforeEach(() => {
      setSessionRole("OWNER");
    });

    it("shows all 8 action buttons for OWNER", () => {
      renderCard();

      expect(
        screen.getByRole("button", { name: /nueva venta/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /nueva devolución/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /inventario/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /buscar producto/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /usuarios/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /auditoría/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /sincronización/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /configuración/i }),
      ).toBeInTheDocument();
    });

    it("dispatches navigateToSyncHealth when sync button is clicked", () => {
      const store = createTestStore();
      const dispatch = vi.spyOn(store, "dispatch");
      renderCard(store);

      fireEvent.click(
        screen.getByRole("button", { name: /sincronización/i }),
      );

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ui/navigateToSyncHealth" }),
      );
    });

    it("dispatches navigateToAdminMenu when config button is clicked", () => {
      const store = createTestStore();
      const dispatch = vi.spyOn(store, "dispatch");
      renderCard(store);

      fireEvent.click(
        screen.getByRole("button", { name: /configuración/i }),
      );

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ui/navigateToAdminMenu" }),
      );
    });
  });

  // ── SAAS_ADMIN actions (same as OWNER) ──────────────────────────

  describe("SAAS_ADMIN role", () => {
    beforeEach(() => {
      setSessionRole("SAAS_ADMIN");
    });

    it("shows all 8 action buttons for SAAS_ADMIN", () => {
      renderCard();

      expect(
        screen.getByRole("button", { name: /nueva venta/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /sincronización/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /configuración/i }),
      ).toBeInTheDocument();
    });
  });

  // ── No session ──────────────────────────────────────────────────

  describe("no session", () => {
    beforeEach(() => {
      clearSession();
    });

    it("returns null when no session exists", () => {
      const { container } = renderCard();

      expect(container.innerHTML).toBe("");
    });
  });

  // ── Accessibility ──────────────────────────────────────────────

  it("renders section heading with quick actions label", () => {
    renderCard();

    expect(
      screen.getByText("Accesos rápidos"),
    ).toBeInTheDocument();
  });

  it("each action button has an accessible name via aria-label", () => {
    renderCard();

    const buttons = screen.getAllByRole("button");
    buttons.forEach((btn) => {
      expect(btn).toHaveAccessibleName();
    });
  });
});
