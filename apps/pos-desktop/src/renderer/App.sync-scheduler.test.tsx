/**
 * Tests for the SyncScheduler lifecycle wiring inside InnerApp.
 *
 * The component (App.tsx) starts the scheduler in a useEffect once a
 * valid authenticated session (with accessToken) is available.
 *
 * These tests mock the service context and session store to verify
 * the wiring without real database or network access.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { FC, ReactNode } from "react";

// ---------------------------------------------------------------------------
// Hoisted refs — allow test bodies to mutate values that the vi.mock
// closures read, enabling session/screen changes across render cycles.
// ---------------------------------------------------------------------------

const { mockSessionRef } = vi.hoisted(() => {
  const mockSessionRef: { current: Record<string, unknown> | null } = {
    current: null,
  };
  return { mockSessionRef };
});

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// Configuration: disable DB_PROOF so the real app renders.
vi.mock("@infra/config", () => ({
  DB_PROOF_ENABLED: false,
  API_BASE_URL: "http://localhost:3000",
}));

// Redux store: return a stable activeScreen so InnerApp does not
// try to render AppShell (which has many dependencies).  "login" is
// the simplest early-return path that still runs the sync useEffect.
const mockAppDispatch = vi.fn();
const mockActiveScreen = { current: "login" };

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => mockAppDispatch,
  useAppSelector: (selector: (state: any) => unknown) =>
    selector({ ui: { activeScreen: mockActiveScreen.current } }),
}));

// Online status: stable true so the InnerApp doesn't crash.
vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

// Local session store — returns the ref value so tests can control it.
// We mock the module so the component reads from mockSessionRef.
vi.mock("../domain/auth/local-session.store", () => ({
  useLocalSessionStore: (
    selector: (s: { session: unknown }) => unknown,
  ) => selector({ session: mockSessionRef.current }),
}));

// Service context — return a controllable mock sync scheduler.
const mockSyncScheduler = {
  updateAccessToken: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  syncNow: vi.fn(),
};

const mockServices: Record<string, unknown> = {
  returnsService: { createReturn: vi.fn() },
  inventoryAdjustmentsService: { createAdjustment: vi.fn() },
  prescriptionsService: { createPrescription: vi.fn() },
  backupService: { createBackup: vi.fn() },
  recoveryLogService: { log: vi.fn() },
  invoiceService: { generateInvoiceForSale: vi.fn() },
  contingencyService: { isInContingency: vi.fn() },
  fiscalNumberingService: { nextNumber: vi.fn() },
  fiscalScheduler: { start: vi.fn() },
  printerConfigService: { listAll: vi.fn() },
  printQueueService: { enqueueJob: vi.fn() },
  printRouter: { print: vi.fn() },
  printerHealthService: { start: vi.fn() },
  configExportService: { exportConfig: vi.fn() },
  printingMetricsService: { getHealthLine: vi.fn() },
  cashDrawerService: { openDrawer: vi.fn() },
  customerDisplayService: { showWelcome: vi.fn() },
  updateService: { checkForUpdates: vi.fn() },
  syncScheduler: mockSyncScheduler,
};

// Replace ServiceProvider with a pass-through and useServiceContext
// with a mock so InnerApp receives the mock services.
vi.mock("./components/common/service-context", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./components/common/service-context")
  >();
  const MockProvider: FC<{ children: ReactNode }> = ({ children }) => (
    <>{children}</>
  );
  return {
    ...actual,
    ServiceProvider: MockProvider,
    useServiceContext: () => mockServices,
  };
});

// Child component mocks — prevent deep dependency chains from throwing.
vi.mock("@/components/auth/login.page", () => ({
  LoginPage: () => <div data-testid="login-page">Login</div>,
}));

vi.mock("@/components/assistant/assistant-layer", () => ({
  AssistantLayer: () => null,
}));

// Toaster from the sileo package — not needed for these tests.
vi.mock("sileo", () => ({
  Toaster: () => null,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { App } from "./App";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSession = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  userId: "user-1",
  username: "cajero1",
  fullName: "Cajero Uno",
  displayName: "Cajero",
  role: "CASHIER",
  subscriptionId: "sub-1",
  workstationId: "ws-1",
  accessToken: "tok_abc123",
  refreshToken: "tok_ref",
  expiresAt: new Date("2099-12-31"),
  sessionId: "session-1",
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("App — SyncScheduler lifecycle wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionRef.current = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("with a valid session (accessToken present)", () => {
    it("calls updateAccessToken with the session token", () => {
      mockSessionRef.current = makeSession({ accessToken: "tok_session" });

      render(<App />);

      expect(mockSyncScheduler.updateAccessToken).toHaveBeenCalledWith(
        "tok_session",
      );
    });

    it("calls start() on the sync scheduler", () => {
      mockSessionRef.current = makeSession({ accessToken: "tok_session" });

      render(<App />);

      expect(mockSyncScheduler.start).toHaveBeenCalledOnce();
    });

    it("calls updateAccessToken before start()", () => {
      mockSessionRef.current = makeSession({ accessToken: "tok_session" });

      render(<App />);

      expect(
        mockSyncScheduler.updateAccessToken.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mockSyncScheduler.start.mock.invocationCallOrder[0],
      );
    });
  });

  describe("without a session (accessToken absent)", () => {
    it("does not call updateAccessToken", () => {
      mockSessionRef.current = null;

      render(<App />);

      expect(mockSyncScheduler.updateAccessToken).not.toHaveBeenCalled();
    });

    it("does not call start()", () => {
      mockSessionRef.current = null;

      render(<App />);

      expect(mockSyncScheduler.start).not.toHaveBeenCalled();
    });

    it("does not call syncScheduler methods when session exists but lacks accessToken", () => {
      mockSessionRef.current = makeSession({ accessToken: null });

      render(<App />);

      expect(mockSyncScheduler.updateAccessToken).not.toHaveBeenCalled();
      expect(mockSyncScheduler.start).not.toHaveBeenCalled();
    });
  });

  describe("idempotency — start() called only once", () => {
    it("does not call start() again on a plain re-render", () => {
      mockSessionRef.current = makeSession({ accessToken: "tok1" });

      const { rerender } = render(<App />);
      expect(mockSyncScheduler.start).toHaveBeenCalledTimes(1);

      // Re-render with the same session — effect deps haven't changed
      rerender(<App />);

      expect(mockSyncScheduler.start).toHaveBeenCalledTimes(1);
    });

    it("does not call start() again when session token changes (isSyncStarted guard)", () => {
      mockSessionRef.current = makeSession({ accessToken: "tok1" });

      const { rerender } = render(<App />);
      expect(mockSyncScheduler.start).toHaveBeenCalledTimes(1);

      // Change the session to a new token — the effect dep
      // session?.accessToken changes, so the effect re-runs, but
      // isSyncStarted.current is true, blocking the second call.
      mockSessionRef.current = makeSession({ accessToken: "tok2" });
      rerender(<App />);

      // start() is NOT called a second time
      expect(mockSyncScheduler.start).toHaveBeenCalledTimes(1);
      // updateAccessToken is also NOT called again
      expect(mockSyncScheduler.updateAccessToken).toHaveBeenCalledTimes(1);
    });

    it("does not call start() again when active screen changes", () => {
      mockSessionRef.current = makeSession({ accessToken: "tok1" });

      const { rerender } = render(<App />);
      expect(mockSyncScheduler.start).toHaveBeenCalledTimes(1);

      // Change the active screen — the component re-renders but the
      // effect deps (session?.accessToken, svc) are stable, so the
      // effect does not re-fire.  isSyncStarted remains true.
      mockActiveScreen.current = "sales";
      rerender(<App />);

      expect(mockSyncScheduler.start).toHaveBeenCalledTimes(1);
    });
  });
});
