/**
 * Integration tests for the InnerApp route guard (role-based access).
 *
 * Covers the two guard guarantees plus the auth fallback:
 *   RG-01 — a screen the session role may not open never mounts (its
 *           mount-time data requests cannot fire), the shell shows the
 *           i18n access notice while the redirect is pending, and the
 *           redirect to "home" is dispatched.
 *   RG-02 — authorized screens are untouched.
 *   RG-03 — unauthenticated visitors stay on the login fallback.
 *
 * Every page component imported by App.tsx is replaced by a stub so the
 * test exercises only the router wiring: the real NavigationSidebar, the
 * real Zustand session store, the real ui slice and the real i18n copy.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { render, screen, waitFor, act } from "@testing-library/react";
import { configureStore, type Store } from "@reduxjs/toolkit";
import { App } from "./App";
import { uiSlice, setActiveScreen } from "@/store/slices/ui-slice";
import type { PosScreen } from "@/store/slices/ui-types";
import { LicenseStatus, RoleType } from "@pharmacy/shared-types";
import {
  useLocalSessionStore,
  type LocalSession,
} from "../domain/auth/local-session.store";
import { useLicenseStore } from "../domain/licensing/license.store";

// ---------------------------------------------------------------------------
// Mount recorder — proves the unauthorized page component never executed,
// regardless of how quickly the redirect effect flushes.
// ---------------------------------------------------------------------------

const mountRecorder = vi.hoisted(() => ({ adminMenuPage: 0 }));

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

// Services consumed by InnerApp effects right after login. No PGlite, no
// network — every collaborator is a no-op.
vi.mock("@/components/common/service-context", () => ({
  ServiceProvider: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
  useServiceContext: () => ({
    cashShiftService: { hydrateStore: vi.fn() },
    syncScheduler: { updateAccessToken: vi.fn(), start: vi.fn() },
    reportScheduler: { start: vi.fn() },
  }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("@/hooks/use-require-active-shift", () => ({
  useRequireActiveShift: () => ({ hasActiveShift: true, isLoading: false }),
}));

vi.mock("../domain/licensing/license.service", () => ({
  createLicenseService: vi.fn(() => ({ restoreLicense: vi.fn() })),
}));

// Real NavigationSidebar badge polling — DB and metrics are stubbed out.
vi.mock("../infrastructure/local-database", () => ({
  getLocalDatabase: vi.fn(() =>
    Promise.reject(new Error("local database disabled in tests")),
  ),
}));
vi.mock("../domain/sync/sync-metrics.service", () => ({
  createSyncMetricsService: vi.fn(() => ({
    getQueueCounts: vi.fn().mockResolvedValue({
      permanentFailure: 0,
      pending: 0,
      failed: 0,
    }),
  })),
}));

// Page components — stubbed with stable test ids. The tenant config page
// records every execution so non-mounting can be asserted directly.
vi.mock("@/components/config/tenant-config.page", () => ({
  TenantConfigPage: () => {
    mountRecorder.adminMenuPage += 1;
    return <div data-testid="page-admin-menu" />;
  },
}));

vi.mock("@/components/Home/home", () => ({
  Home: () => <div data-testid="page-home" />,
}));
vi.mock("@/components/SalesTransaction/sales-transaction", () => ({
  SalesTransaction: () => <div data-testid="page-sales" />,
}));
vi.mock("@/components/PaymentProcessing/payment-processing", () => ({
  PaymentProcessing: () => <div data-testid="page-payment" />,
}));
vi.mock("@/components/Receipt/receipt", () => ({
  Receipt: () => <div data-testid="page-receipt" />,
}));
vi.mock("@/components/cash-shift/cash-shift.page", () => ({
  CashShiftPage: () => <div data-testid="page-cash-shift" />,
}));
vi.mock("@/components/clients/clients.page", () => ({
  ClientsPage: () => <div data-testid="page-clients" />,
}));
vi.mock("../../domain/fiscal/fiscal.page", () => ({
  FiscalPage: () => <div data-testid="page-fiscal" />,
}));
vi.mock("../../domain/sales-pos/sales-history.page", () => ({
  SalesHistoryPage: () => <div data-testid="page-sales-history" />,
}));
vi.mock("@/components/returns/returns.page", () => ({
  ReturnsPage: () => <div data-testid="page-returns" />,
}));
vi.mock("@/components/inventory-adjustments/inventory-adjustments.page", () => ({
  InventoryAdjustmentsPage: () => (
    <div data-testid="page-inventory-adjustments" />
  ),
}));
vi.mock("@/components/inventory-lots/inventory-lots.page", () => ({
  InventoryLotsPage: () => <div data-testid="page-inventory-lots" />,
}));
vi.mock("@/components/products/products.page", () => ({
  ProductsPage: () => <div data-testid="page-products" />,
}));
vi.mock("@/components/productos/productos-main.page", () => ({
  ProductosMainPage: () => <div data-testid="page-productos-main" />,
}));
vi.mock("@/components/purchases/purchases-main.page", () => ({
  PurchasesMainPage: () => <div data-testid="page-purchases-main" />,
}));
vi.mock("@/components/purchases/suppliers.page", () => ({
  SuppliersPage: () => <div data-testid="page-suppliers" />,
}));
vi.mock("@/components/purchases/purchase-orders.page", () => ({
  PurchaseOrdersPage: () => <div data-testid="page-purchase-orders" />,
}));
vi.mock("@/components/purchases/purchase-receptions.page", () => ({
  PurchaseReceptionsPage: () => (
    <div data-testid="page-purchase-receptions" />
  ),
}));
vi.mock("@/components/purchases/supplier-returns.page", () => ({
  SupplierReturnsPage: () => <div data-testid="page-supplier-returns" />,
}));
vi.mock("@/components/prescriptions/prescriptions.page", () => ({
  PrescriptionsPage: () => <div data-testid="page-prescriptions" />,
}));
vi.mock("@/components/reports/reports.page", () => ({
  ReportsPage: () => <div data-testid="page-reports" />,
}));
vi.mock("@/components/sync/sync-health.page", () => ({
  SyncHealthPage: () => <div data-testid="page-sync-health" />,
}));
vi.mock("@/components/local-sync/local-network.page", () => ({
  LocalNetworkPage: () => <div data-testid="page-local-network" />,
}));
vi.mock("@/components/recovery/recovery.page", () => ({
  RecoveryPage: () => <div data-testid="page-recovery" />,
}));
vi.mock("@/components/update/about.page", () => ({
  AboutPage: () => <div data-testid="page-about" />,
}));
vi.mock("@/components/licensing/license-status.page", () => ({
  LicenseStatusPage: () => <div data-testid="page-license-status" />,
}));
vi.mock("@/components/licensing/licensing-plans.page", () => ({
  LicensingPlansPage: () => <div data-testid="page-licensing-plans" />,
}));
vi.mock("@/components/licensing/activation.page", () => ({
  ActivationPage: () => <div data-testid="page-activation" />,
}));
vi.mock("@/components/company-setup/company-setup-wizard", () => ({
  CompanySetupWizard: () => <div data-testid="page-company-setup" />,
}));
vi.mock("../../domain/fiscal/certificate.page", () => ({
  CertificateSetupPage: () => <div data-testid="page-certificate-setup" />,
}));
vi.mock("@/components/printing/printing-container", () => ({
  PrintingContainer: () => <div data-testid="page-printing" />,
}));
vi.mock("@/components/printing/printers.page", () => ({
  PrintersPage: () => <div data-testid="page-printers" />,
}));
vi.mock("@/components/printing/print-queue.page", () => ({
  PrintQueuePage: () => <div data-testid="page-print-queue" />,
}));
vi.mock("@/components/printing/setup-wizard.page", () => ({
  SetupWizardPage: () => <div data-testid="page-setup-wizard" />,
}));
vi.mock("@/components/auth/login.page", () => ({
  LoginPage: () => <div data-testid="page-login" />,
}));
vi.mock("@/components/auth/forgot-password.page", () => ({
  ForgotPasswordPage: () => <div data-testid="page-forgot-password" />,
}));
vi.mock("@/components/auth/reset-password.page", () => ({
  ResetPasswordPage: () => <div data-testid="page-reset-password" />,
}));
vi.mock("@/components/auth/user-management.page", () => ({
  UserManagementPage: () => <div data-testid="page-user-management" />,
}));
vi.mock("@/components/auth/audit-log-view", () => ({
  AuditLogView: () => <div data-testid="page-audit-log" />,
}));
vi.mock("@/components/auth/sessions/session-view", () => ({
  SessionView: () => <div data-testid="page-offline-sessions" />,
}));
vi.mock("@/components/auth/offline/offline-mode-banner", () => ({
  OfflineModeBanner: () => null,
}));
vi.mock("@/components/auth/offline/pending-blessing-modal", () => ({
  PendingBlessingModal: () => null,
}));
vi.mock("./components/assistant/assistant-layer", () => ({
  AssistantLayer: () => null,
}));
vi.mock("@/components/update/update-check-interceptor", () => ({
  UpdateCheckInterceptor: () => null,
}));
vi.mock("@/components/DatabaseProof/database-proof", () => ({
  DatabaseProof: () => null,
}));

// AppShell passthrough — keeps the shell children (sidebar + page) mounted
// without dragging in Tauri window chrome.
vi.mock("@/components/common/app-shell", () => ({
  AppShell: ({
    children,
  }: {
    children?: ReactNode;
    cashierName?: string;
    initialSyncState?: string;
  }) => <div data-testid="app-shell">{children}</div>,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSession = (role: RoleType | string): LocalSession => ({
  userId: "user-1",
  username: "cajero1",
  fullName: "Cajero Uno",
  displayName: "Cajero Uno",
  email: "cajero@pharmacy.com",
  role,
  subscriptionId: "sub-1",
  workstationId: "ws-1",
  accessToken: "access-token-abc",
  refreshToken: "refresh-token-xyz",
  expiresAt: new Date("2099-12-31"),
  sessionId: "session-1",
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
  sessionTrust: "SERVER_VERIFIED",
});

const setSessionRole = (role: RoleType): void => {
  useLocalSessionStore.getState().setSession(makeSession(role));
};

const createTestStore = (activeScreen: PosScreen): Store => {
  const store = configureStore({
    reducer: { ui: uiSlice.reducer },
  });
  store.dispatch(setActiveScreen(activeScreen));
  return store;
};

const renderApp = (store: Store) =>
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  );

describe("InnerApp route guard", () => {
  beforeEach(() => {
    mountRecorder.adminMenuPage = 0;
    useLocalSessionStore.getState().clearSession();
    // Keep the activation gate open so the guarded screens are reachable.
    useLicenseStore.setState({ status: LicenseStatus.ACTIVE });
  });

  afterEach(() => {
    useLocalSessionStore.getState().clearSession();
  });

  describe("RG-01: unauthorized screen for CASHIER", () => {
    it("keeps the admin page unmounted and shows the access notice while the redirect is pending", () => {
      setSessionRole(RoleType.CASHIER);
      const store = createTestStore("admin-menu");

      // Defer every dispatch so the guard effect has fired but the state
      // update has not landed yet — this is exactly the window the
      // render-time backstop exists for.
      const deferred: { type: string }[] = [];
      const dispatchSpy = vi
        .spyOn(store, "dispatch")
        .mockImplementation(((action: { type: string }) => {
          deferred.push(action);
          return action;
        }) as unknown as typeof store.dispatch);

      renderApp(store);

      // The unauthorized page never executed — not even transiently.
      expect(mountRecorder.adminMenuPage).toBe(0);
      expect(screen.queryByTestId("page-admin-menu")).not.toBeInTheDocument();

      // The backstop announces the block inside the app shell.
      const notice = screen.getByRole("status");
      expect(notice).toBeVisible();
      expect(notice).toHaveTextContent(/no tienes permisos/i);
      expect(screen.getByRole("navigation")).toBeInTheDocument();

      // Land the deferred redirect so the tree ends in a consistent state.
      act(() => {
        dispatchSpy.mockRestore();
        deferred.forEach((action) => store.dispatch(action as never));
      });

      expect(screen.getByTestId("page-home")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("dispatches the redirect to home once the guard effect lands", async () => {
      setSessionRole(RoleType.CASHIER);
      const store = createTestStore("admin-menu");
      const dispatchSpy = vi.spyOn(store, "dispatch");

      renderApp(store);

      await waitFor(() =>
        expect(screen.getByTestId("page-home")).toBeInTheDocument(),
      );

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ui/setActiveScreen",
          payload: "home",
        }),
      );
      expect(mountRecorder.adminMenuPage).toBe(0);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("RG-02: authorized screen for OWNER", () => {
    it("mounts the admin page without the access notice or a redirect", () => {
      setSessionRole(RoleType.OWNER);
      const store = createTestStore("admin-menu");

      renderApp(store);

      expect(screen.getByTestId("page-admin-menu")).toBeInTheDocument();
      expect(mountRecorder.adminMenuPage).toBe(1);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("RG-03: unauthenticated visitor", () => {
    it("stays on the login fallback regardless of the deep-linked screen", () => {
      const store = createTestStore("admin-menu");

      renderApp(store);

      expect(screen.getByTestId("page-login")).toBeVisible();
      expect(
        screen.queryByTestId("page-admin-menu"),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("RG-04: authorized default screen", () => {
    it("renders home for a CASHIER session without the access notice", () => {
      setSessionRole(RoleType.CASHIER);
      const store = createTestStore("home");

      renderApp(store);

      expect(screen.getByTestId("page-home")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
