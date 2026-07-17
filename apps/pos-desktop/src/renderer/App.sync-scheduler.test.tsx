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
// The selector callback reads `mockActiveScreen.current` dynamically
// so tests that change it (e.g., active-screen-change test) work.
// `offlineAuth` slice is included for components that check connectivity.
const mockAppDispatch = vi.fn();
const mockActiveScreen = { current: "login" };

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => mockAppDispatch,
  useAppSelector: (selector: (state: any) => unknown) =>
    selector({
      ui: { activeScreen: mockActiveScreen.current },
      offlineAuth: {
        connectionState: "online",
        isBlessingModalOpen: false,
      },
    }),
}));

// Online status: stable true so the InnerApp doesn't crash.
vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

// Local session store — returns the ref value so tests can control it.
// We mock the module so the component reads from mockSessionRef.
// The mock also exposes getState() so the real SyncScheduler (used in
// the integration tests) can read the session via getState().session.
vi.mock("../domain/auth/local-session.store", () => {
  const mockFn = Object.assign(
    (selector: (s: { session: unknown }) => unknown) =>
      selector({ session: mockSessionRef.current }),
    {
      getState: () => ({
        session: mockSessionRef.current,
        updateSession: vi.fn(),
      }),
      subscribe: vi.fn(),
    },
  );
  return {
    useLocalSessionStore: mockFn,
    // hasMinRole is imported by NavigationSidebar and other components.
    hasMinRole: (
      session: { session: unknown } | null,
      _minRole: string,
    ): boolean => Boolean(session),
  };
});

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
// Mock EVERY page-level component imported in App.tsx so that the
// integration tests (which use a real SyncScheduler and real stores)
// don't crash on missing Redux slices, database access, or service deps.
vi.mock("@/components/auth/login.page", () => ({
  LoginPage: () => <div data-testid="login-page">Login</div>,
}));

vi.mock("@/components/assistant/assistant-layer", () => ({
  AssistantLayer: () => null,
}));

vi.mock("@/components/auth/offline/offline-mode-banner", () => ({
  OfflineModeBanner: () => null,
}));

vi.mock("@/components/auth/offline/pending-blessing-modal", () => ({
  PendingBlessingModal: () => null,
}));

vi.mock("@/components/SalesTransaction/sales-transaction", () => ({
  SalesTransaction: () => null,
}));

vi.mock("@/components/PaymentProcessing/payment-processing", () => ({
  PaymentProcessing: () => null,
}));

vi.mock("@/components/Receipt/receipt", () => ({
  Receipt: () => null,
}));

vi.mock("@/components/Navigation/navigation-sidebar", () => ({
  NavigationSidebar: () => null,
}));

vi.mock("@/components/common/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/update/update-check-interceptor", () => ({
  UpdateCheckInterceptor: () => null,
}));

// Toaster from the sileo package — not needed for these tests.
vi.mock("sileo", () => ({
  Toaster: () => null,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { App } from "./App";
import { createSyncScheduler } from "../domain/sync/sync-scheduler.service";
import { useSyncAuthStatusStore } from "../domain/sync/sync-auth-status.store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeMockPrisma = () =>
  ({
    $transaction: vi.fn(),
    syncQueue: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _max: { clientSequence: 0n } }),
    },
  } as any);

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

/** Factory for successful /auth/refresh response. */
const REFRESH_OK = JSON.stringify({
  accessToken: "fresh-access-token",
  refreshToken: "fresh-refresh-token",
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
});
const OK_RESPONSE = new Response(REFRESH_OK, {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

/** Factory for 401 response (expired token). */
const UNAUTHORIZED_RESPONSE = new Response(
  JSON.stringify({ message: "Unauthorized" }),
  { status: 401, headers: { "Content-Type": "application/json" } },
);

/**
 * Default mock-scheduler instance used by all existing tests.
 * Saved here so the new integration test can restore it in afterEach.
 */
const originalMockScheduler = mockSyncScheduler;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("App — SyncScheduler lifecycle wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionRef.current = null;
    // Reset activeScreen to "login" — the idempotency test changes it to
    // "sales" and without this reset, all subsequent tests (including the
    // integration tests) inherit the wrong activeScreen.
    mockActiveScreen.current = "login";
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

    it("does not call start() again when session token changes — also verifies updateAccessToken is refreshed on re-login", () => {
      mockSessionRef.current = makeSession({ accessToken: "tok1" });

      const { rerender } = render(<App />);
      expect(mockSyncScheduler.start).toHaveBeenCalledTimes(1);
      expect(mockSyncScheduler.updateAccessToken).toHaveBeenCalledTimes(1);

      // Change the session to a new token — the effect dep
      // session?.accessToken changes, so the effect re-runs.
      // isSyncStarted.current is true, blocking start(), but
      // prevTokenRef detects the token change, so updateAccessToken
      // IS called again with the new token (simulating a re-login
      // after token expiry — the fix that prevents stale tokens).
      mockSessionRef.current = makeSession({ accessToken: "tok2" });
      rerender(<App />);

      // start() is NOT called a second time
      expect(mockSyncScheduler.start).toHaveBeenCalledTimes(1);
      // updateAccessToken IS called again with the new token
      expect(mockSyncScheduler.updateAccessToken).toHaveBeenCalledTimes(2);
      expect(mockSyncScheduler.updateAccessToken).toHaveBeenLastCalledWith(
        "tok2",
      );
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

  // -----------------------------------------------------------------------
  // Auth status integration — uses a REAL SyncScheduler so that
  // refreshAccessToken() writes to useSyncAuthStatusStore.
  // -----------------------------------------------------------------------

  describe("auth status indicator integration", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      useSyncAuthStatusStore.getState().reset();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      // Restore the default mock scheduler so other tests are unaffected.
      mockServices.syncScheduler = originalMockScheduler;
      useSyncAuthStatusStore.getState().reset();
    });

    it("sets auth status to 'fresh' when the token is still valid", async () => {
      mockSessionRef.current = makeSession({
        accessToken: "tok_fresh",
        // Token expires in 30 min — well beyond the default 10 min buffer
        // (2× 5 min interval), so refreshAccessToken skips the fetch and
        // writes 'fresh' to the auth status store.
        expiresAt: new Date(Date.now() + 30 * 60_000),
        offlineToken: "offline-token",
      });

      // Create a real SyncScheduler with mocked prisma.
      const realScheduler = createSyncScheduler({
        prisma: makeMockPrisma(),
        baseUrl: "http://localhost:3000",
        config: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        catalog: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        lots: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        clients: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        intervalMs: 300_000,
      });

      // Replace the mock scheduler with the real one.
      mockServices.syncScheduler = realScheduler;

      // Mock fetch (shouldn't be called since token is fresh, but just in
      // case a downstream service tries to use it).
      globalThis.fetch = vi.fn().mockResolvedValue(OK_RESPONSE);

      render(<App />);

      // The effect fires updateAccessToken + start() on the real scheduler.
      // start() fires tick() which calls refreshAccessToken().
      // Since the token is fresh (30 min > 10 min buffer), it sets 'fresh'
      // without making any network request.
      await vi.waitFor(
        () => {
          expect(useSyncAuthStatusStore.getState().status).toBe("fresh");
        },
        { timeout: 2000, interval: 50 },
      );
    });

    it("sets auth status to 'refreshed' after a successful standard refresh", async () => {
      mockSessionRef.current = makeSession({
        accessToken: "tok_stale",
        // Token expires in 2 min — inside the 10 min buffer, so
        // refreshAccessToken tries POST /auth/refresh.
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "offline-token-123",
      });

      const realScheduler = createSyncScheduler({
        prisma: makeMockPrisma(),
        baseUrl: "http://localhost:3000",
        config: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        catalog: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        lots: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        clients: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        intervalMs: 300_000,
      });

      mockServices.syncScheduler = realScheduler;

      // Mock /auth/refresh to succeed.
      // Use a plain object instead of `new Response()` to avoid any
      // jsdom Response/body-stream quirks that could cause `json()` to
      // reject (which would trigger the catch block and set 'failed').
      const refreshPayload = {
        accessToken: "fresh-access-token",
        refreshToken: "fresh-refresh-token",
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => refreshPayload,
      } as Response);

      render(<App />);

      await vi.waitFor(
        () => {
          const s = useSyncAuthStatusStore.getState();
          expect(s.status).toBe("refreshed");
        },
        { timeout: 2000, interval: 50 },
      );
    });

    it("sets auth status to 'exchanged' after standard refresh fails but exchange succeeds", async () => {
      mockSessionRef.current = makeSession({
        accessToken: "tok_stale",
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "offline-token-123",
      });

      const realScheduler = createSyncScheduler({
        prisma: makeMockPrisma(),
        baseUrl: "http://localhost:3000",
        config: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        catalog: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        lots: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        clients: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        intervalMs: 300_000,
      });

      mockServices.syncScheduler = realScheduler;

      // Use a URL-based mock so it works regardless of how many times
      // refreshAccessToken is called (once from start() pre-refresh and
      // once from tick()).  /auth/refresh always returns 401 (standard
      // refresh fails), /auth/token/exchange always returns 200.
      const EXCHANGE_OK = JSON.stringify({
        accessToken: "exchanged-access-token",
        refreshToken: "exchanged-refresh-token",
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        offlineToken: {
          token: "fresh-offline-token",
          expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        },
      });
      const exchangeOkResponse = new Response(EXCHANGE_OK, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/token/exchange')) {
          return Promise.resolve(exchangeOkResponse);
        }
        // /auth/refresh and everything else returns 401
        return Promise.resolve(UNAUTHORIZED_RESPONSE);
      }) as unknown as typeof globalThis.fetch;

      render(<App />);

      // start() pre-refreshes the token, which tries /auth/refresh (401)
      // then /auth/token/exchange (200).  tick() also calls refreshAccessToken
      // but the exchange always succeeds, so the final status is 'exchanged'.
      await vi.waitFor(
        () => {
          const s = useSyncAuthStatusStore.getState();
          expect(s.status).toBe("exchanged");
          // Also verify exchange count — only 1 because tick()'s second
          // refreshAccessToken finds the token already fresh (updateSession
          // was called, but since it's a mock that doesn't update
          // mockSessionRef.current, tick() will try again and succeed again.
          // The exchange count in the store increments each time, so we
          // accept >= 1.
          expect(s.exchangeCount).toBeGreaterThanOrEqual(1);
        },
        { timeout: 2000, interval: 50 },
      );
    });

    it("sets auth status to 'failed' when both refresh paths fail", async () => {
      mockSessionRef.current = makeSession({
        accessToken: "tok_expired",
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "offline-token-123",
      });

      const realScheduler = createSyncScheduler({
        prisma: makeMockPrisma(),
        baseUrl: "http://localhost:3000",
        config: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        catalog: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        lots: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        clients: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        intervalMs: 300_000,
      });

      mockServices.syncScheduler = realScheduler;

      // Both /auth/refresh and /auth/token/exchange return 401.
      const fail = vi
        .fn()
        .mockResolvedValue(UNAUTHORIZED_RESPONSE);
      globalThis.fetch = fail as unknown as typeof globalThis.fetch;

      render(<App />);

      await vi.waitFor(
        () => {
          expect(useSyncAuthStatusStore.getState().status).toBe("failed");
        },
        { timeout: 2000, interval: 50 },
      );
    });
  });
});
