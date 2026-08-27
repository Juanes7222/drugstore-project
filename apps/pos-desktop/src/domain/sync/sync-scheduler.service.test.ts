/**
 * Unit tests for SyncScheduler — lifecycle, tick orchestration, and
 * access-token refresh (refreshAccessToken).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createSyncScheduler, SyncScheduler } from "./sync-scheduler.service";
import { useLocalSessionStore } from "../auth/local-session.store";
import { useSyncAuthStatusStore } from "./sync-auth-status.store";
import { dbWriteLock } from "../../infrastructure/write-lock";
import { createSecureStorage } from "../../infrastructure/secure-storage";
import { decodeOfflineToken } from "../auth/offline";
import { MAX_RETRY_ATTEMPTS } from "./sync-push.service";
import type { LocalSession } from "../auth/local-session.store";

// Mock createSyncPushService so it always returns a fake push service with
// the three-phase contract (preparePush / sendBatch / applyPushResult).
// This prevents updateAccessToken() from overwriting the mock with a real
// push service, which would fail due to the incomplete Prisma mock.
// MAX_RETRY_ATTEMPTS is mirrored here so the reset-on-re-auth assertions
// can import it without pulling in the real module.
vi.mock("./sync-push.service", () => ({
  createSyncPushService: vi.fn(() => makePushServiceMock()),
  MAX_RETRY_ATTEMPTS: 10,
}));

vi.mock("../purchases/supplier-sync.service", () => ({
  createSupplierSyncService: vi.fn(() => ({
    fetchSuppliers: vi.fn().mockResolvedValue([]),
    applySuppliers: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../purchases/purchase-order-sync.service", () => ({
  createPurchaseOrderSyncService: vi.fn(() => ({
    fetchPurchaseOrders: vi.fn().mockResolvedValue([]),
    applyPurchaseOrders: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../purchases/purchase-reception-sync.service", () => ({
  createPurchaseReceptionSyncService: vi.fn(() => ({
    fetchReceptions: vi.fn().mockResolvedValue([]),
    applyReceptions: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../purchases/supplier-return-sync.service", () => ({
  createSupplierReturnSyncService: vi.fn(() => ({
    fetchSupplierReturns: vi.fn().mockResolvedValue([]),
    applySupplierReturns: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../sales-pos/sales-sync.service", () => ({
  createSalesSyncService: vi.fn(() => ({
    fetchSales: vi.fn().mockResolvedValue([]),
    applySales: vi.fn().mockResolvedValue(undefined),
  })),
}));

// The scheduler recovers/rotates the offline-token cache through
// SecureStorage — swap it for a controllable seam.
vi.mock("../../infrastructure/secure-storage", () => ({
  createSecureStorage: vi.fn(),
}));

// The recovery path decodes the cached token's claims to check expiry.
vi.mock("../auth/offline", () => ({
  decodeOfflineToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeMockPrisma = () =>
  ({
    $transaction: vi.fn(),
    syncQueue: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _max: { clientSequence: 0n } }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as any);

/**
 * Fake push service with the three-phase contract. Tests override the
 * per-phase spies to assert what the scheduler runs (or skips).
 */
function makePushServiceMock() {
  const preparePush = vi.fn().mockResolvedValue({
    entries: [{ id: "entry-1" }],
    operations: [],
    headers: {},
  });
  const sendBatch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    bodyText: "[]",
  });
  const applyPushResult = vi.fn().mockResolvedValue({ pushed: 1, accepted: 1 });
  const pushPending = vi.fn().mockResolvedValue({ pushed: 0, accepted: 0 });
  return { preparePush, sendBatch, applyPushResult, pushPending };
}

/** Convenience: create a scheduler with the standard set of mocks. */
function makeScheduler(overrides?: Partial<Parameters<typeof createSyncScheduler>[0]>) {
  return createSyncScheduler({
    prisma: makeMockPrisma(),
    baseUrl: "http://localhost:3000",
    config: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
    catalog: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
    lots: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
    clients: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
    intervalMs: 300_000,
    ...overrides,
  });
}

/** Seed a fully populated session so refreshAccessToken has data to work with. */
function seedSession(overrides?: Partial<LocalSession>) {
  const future = new Date(Date.now() + 600_000); // 10 min from now
  const session: LocalSession = {
    userId: "user-1",
    username: "test-user",
    fullName: "Test User",
    displayName: "Test User",
    email: "test@example.com",
    role: "ADMIN",
    subscriptionId: "sub-1",
    workstationId: "ws-1",
    accessToken: "access-token-123",
    refreshToken: "refresh-token-123",
    expiresAt: future,
    sessionId: "session-1",
    totpEnabled: false,
    avatarUrl: null,
    avatarColor: null,
    mustChangePassword: false,
    sessionTrust: 'SERVER_VERIFIED',
    offlineToken: "offline-token-123",
    ...overrides,
  };
  useLocalSessionStore.getState().setSession(session);
}

/** Factory helpers for fetch mock responses. */
function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

/**
 * Controllable SecureStorage seam. `isAvailable` defaults to false so the
 * recovery path short-circuits unless a test explicitly enables the cache.
 */
function makeSecureStorageMock(overrides: Record<string, unknown> = {}) {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

/**
 * Shape of a cached offline token under `offline_token_{userId}`. The
 * string itself is opaque to the scheduler — `decodeOfflineToken` is mocked
 * and decides whether it is usable.
 */
const CACHED_OFFLINE_TOKEN =
  "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyLTEiLCJ0eXAiOiJvZmZsaW5lIn0.signature";

/** Claims for a cached token that is still valid (exp = 2030). */
const VALID_OFFLINE_CLAIMS = {
  sub: "user-1",
  sid: "",
  role: "",
  subscriptionId: null,
  locationIds: [],
  wfp: "",
  typ: "offline",
  jti: "",
  iat: 0,
  exp: 1_900_000_000,
};

/** Claims for a cached token whose exp is already in the past. */
const EXPIRED_OFFLINE_CLAIMS = {
  ...VALID_OFFLINE_CLAIMS,
  exp: Math.floor(Date.now() / 1000) - 60,
};

const REFRESH_RESPONSE = {
  accessToken: "fresh-access-token",
  refreshToken: "fresh-refresh-token",
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
};

const EXCHANGE_RESPONSE = {
  accessToken: "exchanged-access-token",
  refreshToken: "exchanged-refresh-token",
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  offlineToken: { token: "fresh-offline-token", expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() },
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SyncScheduler", () => {
  let scheduler: SyncScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    // Default fetch mock — tests override per scenario.
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(REFRESH_RESPONSE),
    );
    // Default recovery seam — no cached token available.
    vi.mocked(createSecureStorage).mockReturnValue(
      makeSecureStorageMock() as any,
    );
    vi.mocked(decodeOfflineToken).mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useLocalSessionStore.getState().clearSession();
    useSyncAuthStatusStore.getState().reset();

    useSyncAuthStatusStore.getState().reset();
  });

  // -----------------------------------------------------------------------
  // start / stop
  // -----------------------------------------------------------------------

  describe("start / stop", () => {
    it("start() sets an interval and fires an immediate tick", () => {
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

      scheduler = makeScheduler();

      scheduler.start();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300_000);
    });

    it("stop() clears the interval", () => {
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

      scheduler = makeScheduler();

      scheduler.start();
      scheduler.stop();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("start() is idempotent — does not set a second interval", () => {
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

      scheduler = makeScheduler();

      scheduler.start();
      scheduler.start();

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // syncNow (smoke)
  // -----------------------------------------------------------------------

  describe("syncNow", () => {
    it("syncNow() does not throw", async () => {
      seedSession();
      scheduler = makeScheduler();
      await expect(scheduler.syncNow()).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // refreshAccessToken — buffer calculation, fetch calls, store updates,
  // fallback paths, and graceful degradation.
  // All scenarios are exercised through syncNow() / tick(), which calls
  // refreshAccessToken as its first step.
  // -----------------------------------------------------------------------

  describe("refreshAccessToken", () => {
    // -------------------------------------------------------------------
    // No session / fresh token
    // -------------------------------------------------------------------

    it("sets no_session when there is no active session", async () => {
      // No session seeded — store is null.
      scheduler = makeScheduler();
      await scheduler.syncNow();

      expect(useSyncAuthStatusStore.getState().status).toBe("no_session");
    });

    it("sets fresh and does not call fetch when token is well within the buffer", async () => {
      // Token expires in 30 min — well beyond the 2x interval buffer (10 min).
      seedSession({
        expiresAt: new Date(Date.now() + 30 * 60_000),
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      scheduler = makeScheduler({ intervalMs: 300_000 }); // 5 min interval, 10 min buffer
      await scheduler.syncNow();

      // fetch may have been called by downstream services (sync push, catalog, etc.),
      // but NOT for /auth/refresh.
      const refreshCalls = fetchSpy.mock.calls.filter(
        ([url]) => typeof url === "string" && url.includes("/auth/refresh"),
      );
      expect(refreshCalls).toHaveLength(0);
      expect(useSyncAuthStatusStore.getState().status).toBe("fresh");
    });

    // -------------------------------------------------------------------
    // Standard refresh (Path 1)
    // -------------------------------------------------------------------

    it("calls POST /auth/refresh with the access token and updates session on success", async () => {
      // Token expires soon (2 min) — inside buffer (10 min).
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      scheduler = makeScheduler({ intervalMs: 300_000 }); // 5 min interval, 10 min buffer
      await scheduler.syncNow();

      // Verify fetch was called with the correct URL and auth header.
      const refreshCalls = fetchSpy.mock.calls.filter(
        ([url]) => typeof url === "string" && url.includes("/auth/refresh"),
      );
      expect(refreshCalls).toHaveLength(1);
      const [url, init] = refreshCalls[0];
      expect(url).toBe("http://localhost:3000/auth/refresh");
      expect((init as RequestInit).method).toBe("POST");
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: "Bearer access-token-123",
      });

      // Verify the session store was updated with the fresh token.
      const updatedSession = useLocalSessionStore.getState().session;
      expect(updatedSession?.accessToken).toBe("fresh-access-token");
      expect(updatedSession?.refreshToken).toBe("fresh-refresh-token");

      // Verify auth status.
      expect(useSyncAuthStatusStore.getState().status).toBe("refreshed");
    });

    it("does not call /auth/token/exchange when standard refresh succeeds", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "has-offline-token",
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      scheduler = makeScheduler({ intervalMs: 300_000 });
      await scheduler.syncNow();

      const exchangeCalls = fetchSpy.mock.calls.filter(
        ([url]) => typeof url === "string" && url.includes("/auth/token/exchange"),
      );
      expect(exchangeCalls).toHaveLength(0);
      expect(useSyncAuthStatusStore.getState().status).toBe("refreshed");
    });

    // -------------------------------------------------------------------
    // Offline token exchange fallback (Path 2)
    // -------------------------------------------------------------------

    it("falls back to offline token exchange when standard refresh returns 401", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "offline-token-123",
      });

      // First request fails (401), second succeeds.
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, { status: 401 }))
        .mockResolvedValue(jsonResponse(EXCHANGE_RESPONSE));
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler({ intervalMs: 300_000 });
      await scheduler.syncNow();

      // Verify both endpoints were called.
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/auth/refresh",
        expect.anything(),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/auth/token/exchange",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("offline-token-123"),
        }),
      );

      // Verify session was updated with exchange credentials.
      const updatedSession = useLocalSessionStore.getState().session;
      expect(updatedSession?.accessToken).toBe("exchanged-access-token");
      expect(updatedSession?.offlineToken).toBe("fresh-offline-token");

      // Verify auth status is 'exchanged'.
      expect(useSyncAuthStatusStore.getState().status).toBe("exchanged");
      expect(useSyncAuthStatusStore.getState().exchangeCount).toBe(1);
    });

    it("sets failed when both refresh and exchange return errors", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "offline-token-123",
      });

      // Both requests fail.
      const mockFetch = vi
        .fn()
        .mockResolvedValue(jsonResponse({ message: "Unauthorized" }, { status: 401 }))
        .mockResolvedValue(jsonResponse({ message: "Forbidden" }, { status: 403 }));
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler({ intervalMs: 300_000 });
      await scheduler.syncNow();

      expect(useSyncAuthStatusStore.getState().status).toBe("failed");
      // exchangeCount should remain 0 since exchange did not succeed.
      expect(useSyncAuthStatusStore.getState().exchangeCount).toBe(0);
    });

    it("does not attempt exchange when offlineToken is missing", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: undefined,
      });

      const mockFetch = vi
        .fn()
        .mockResolvedValue(jsonResponse({ message: "Unauthorized" }, { status: 401 }));
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler({ intervalMs: 300_000 });
      await scheduler.syncNow();

      // Verify no exchange was attempted — only /auth/refresh was called.
      const exchangeCalls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        (args: unknown[]) => typeof args[0] === "string" && (args[0] as string).includes("/auth/token/exchange"),
      );
      expect(exchangeCalls).toHaveLength(0);

      expect(useSyncAuthStatusStore.getState().status).toBe("failed");
    });

    // -------------------------------------------------------------------
    // Network errors
    // -------------------------------------------------------------------

    it("sets failed when standard refresh throws (network error)", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: undefined, // no exchange fallback
      });

      const mockFetch = vi.fn().mockRejectedValue(new Error("Network failure"));
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler({ intervalMs: 300_000 });
      await scheduler.syncNow();

      expect(useSyncAuthStatusStore.getState().status).toBe("failed");
    });

    it("falls back to exchange when standard refresh throws (network error)", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "offline-token-123",
      });

      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network failure")) // refresh throws
        .mockResolvedValue(jsonResponse(EXCHANGE_RESPONSE)); // exchange succeeds
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler({ intervalMs: 300_000 });
      await scheduler.syncNow();

      expect(useSyncAuthStatusStore.getState().status).toBe("exchanged");
      expect(useSyncAuthStatusStore.getState().exchangeCount).toBe(1);
    });

    it("sets failed when exchange throws (network error)", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "offline-token-123",
      });

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, { status: 401 }))
        .mockRejectedValueOnce(new Error("Exchange network failure"));
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler({ intervalMs: 300_000 });
      await scheduler.syncNow();

      expect(useSyncAuthStatusStore.getState().status).toBe("failed");
    });

    // -------------------------------------------------------------------
    // Buffer boundary
    // -------------------------------------------------------------------

    it("triggers refresh when token expires at or inside the buffer boundary", async () => {
      // bufferMs = intervalMs * 2 = 120_000.  When msUntilExpiry === bufferMs the
      // condition `msUntilExpiry > bufferMs` is false (120_000 > 120_000), so
      // refresh IS triggered — the token needs refreshing at this point.
      seedSession({
        expiresAt: new Date(Date.now() + 120_000), // exactly at buffer boundary
      });

      scheduler = makeScheduler({ intervalMs: 60_000 }); // buffer = 120_000

      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await scheduler.syncNow();

      const refreshCalls = fetchSpy.mock.calls.filter(
        ([url]) => typeof url === "string" && url.includes("/auth/refresh"),
      );
      expect(refreshCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("does not refresh when token is far outside the buffer", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 300_000), // 5 min
      });

      scheduler = makeScheduler({ intervalMs: 60_000 }); // buffer = 120_000
      // msUntilExpiry = 300_000 > 120_000 → fresh, no refresh.

      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await scheduler.syncNow();

      const refreshCalls = fetchSpy.mock.calls.filter(
        ([url]) => typeof url === "string" && url.includes("/auth/refresh"),
      );
      expect(refreshCalls).toHaveLength(0);
      expect(useSyncAuthStatusStore.getState().status).toBe("fresh");
    });
  });

  // -----------------------------------------------------------------------
  // triggerPush — immediate push after notifyPendingEntry()
  // -----------------------------------------------------------------------

  describe("triggerPush", () => {
    it("refreshes the token before sending the batch when online", async () => {
      seedSession({
        expiresAt: new Date(Date.now() - 60_000), // expired — triggers refresh
      });

      // Because createSyncPushService is mocked at module level,
      // this.pushService.sendBatch() always calls this spy — even after
      // refreshAccessToken() internally calls updateAccessToken().
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      scheduler = makeScheduler();

      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch");

      scheduler.triggerPush();

      await vi.advanceTimersByTimeAsync(0);

      // refreshAccessToken was called (posted to /auth/refresh)
      const refreshCalls = fetchSpy.mock.calls.filter(
        ([url]) =>
          typeof url === "string" && url.includes("/auth/refresh"),
      );
      expect(refreshCalls.length).toBeGreaterThanOrEqual(1);

      // The batch was sent after refreshAccessToken completed — the network
      // POST runs after the refresh; only the apply phase takes the lock.
      expect(push.sendBatch).toHaveBeenCalled();
    });

    it("returns early when offline — no refresh, no push", async () => {
      seedSession();
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      scheduler = makeScheduler();

      Object.defineProperty(navigator, "onLine", {
        value: false,
        configurable: true,
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch");

      scheduler.triggerPush();

      expect(push.sendBatch).not.toHaveBeenCalled();
      const refreshCalls = fetchSpy.mock.calls.filter(
        ([url]) =>
          typeof url === "string" && url.includes("/auth/refresh"),
      );
      expect(refreshCalls).toHaveLength(0);
    });

    it("skips the push when refresh fails and no offline token is held", async () => {
      seedSession({
        expiresAt: new Date(Date.now() - 60_000), // expired — triggers refresh
        offlineToken: undefined,
      });
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      scheduler = makeScheduler();

      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });

      // Both refresh and (skipped) exchange reject — auth is known-bad.
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "Unauthorized" }, { status: 401 }),
        );
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler.triggerPush();
      await vi.advanceTimersByTimeAsync(0);

      expect(push.preparePush).not.toHaveBeenCalled();
      expect(push.sendBatch).not.toHaveBeenCalled();
    });

    it("still pushes when refresh fails but an offline token is held", async () => {
      seedSession({
        expiresAt: new Date(Date.now() - 60_000), // expired — triggers refresh
        offlineToken: "offline-token-123",
      });
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      scheduler = makeScheduler();

      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });

      // Refresh and exchange both fail — the offline token is the only
      // credential, and it is enough to pass the auth-readiness gate.
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "Unauthorized" }, { status: 401 }),
        );
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler.triggerPush();
      await vi.advanceTimersByTimeAsync(0);

      expect(push.preparePush).toHaveBeenCalled();
      expect(push.sendBatch).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Shift-close background pause — sync steps skip while a close holds the
  // lock through its full-DB backup (write-lock cooperative pause).
  // -----------------------------------------------------------------------

  describe("shift-close background pause", () => {
    it("syncNow() skips the whole cycle while the background is paused", async () => {
      seedSession();
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      scheduler = makeScheduler();

      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });
      (scheduler as any).wasOnline = true;

      // Simulate a shift close running: the background is paused.
      vi.spyOn(dbWriteLock, "isBackgroundPaused").mockReturnValue(true);

      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await scheduler.syncNow();

      // The guard sits before refreshAccessToken, so no /auth/refresh fetch
      // and no sync work runs at all — nothing queues behind the close.
      expect(push.sendBatch).not.toHaveBeenCalled();
      const refreshCalls = fetchSpy.mock.calls.filter(
        ([url]) =>
          typeof url === "string" && url.includes("/auth/refresh"),
      );
      expect(refreshCalls).toHaveLength(0);
    });

    it("triggerPush() returns early while the background is paused", async () => {
      seedSession();
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      scheduler = makeScheduler();

      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });
      vi.spyOn(dbWriteLock, "isBackgroundPaused").mockReturnValue(true);

      const fetchSpy = vi.spyOn(globalThis, "fetch");
      scheduler.triggerPush();

      expect(push.sendBatch).not.toHaveBeenCalled();
      const refreshCalls = fetchSpy.mock.calls.filter(
        ([url]) =>
          typeof url === "string" && url.includes("/auth/refresh"),
      );
      expect(refreshCalls).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // onOnlineEvent — immediate push on offline→online transition
  // -----------------------------------------------------------------------

  describe("onOnlineEvent", () => {
    it("refreshes the token before sending the batch on offline→online transition", async () => {
      seedSession({
        expiresAt: new Date(Date.now() - 60_000), // expired — triggers refresh
      });

      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      scheduler = makeScheduler();

      // Simulate offline→online transition: wasOnline=false, isOnline()=true
      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });
      (scheduler as any).wasOnline = false;

      const fetchSpy = vi.spyOn(globalThis, "fetch");

      (scheduler as any).onOnlineEvent();

      await vi.advanceTimersByTimeAsync(0);

      const refreshCalls = fetchSpy.mock.calls.filter(
        ([url]) =>
          typeof url === "string" && url.includes("/auth/refresh"),
      );
      expect(refreshCalls.length).toBeGreaterThanOrEqual(1);

      expect(push.sendBatch).toHaveBeenCalled();
    });

    it("no-ops when wasOnline is already true (spurious online event)", async () => {
      seedSession();
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      scheduler = makeScheduler();

      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });
      (scheduler as any).wasOnline = true; // already online

      const fetchSpy = vi.spyOn(globalThis, "fetch");

      (scheduler as any).onOnlineEvent();

      expect(push.sendBatch).not.toHaveBeenCalled();
      const refreshCalls = fetchSpy.mock.calls.filter(
        ([url]) =>
          typeof url === "string" && url.includes("/auth/refresh"),
      );
      expect(refreshCalls).toHaveLength(0);
    });

    it("skips the immediate push when refresh fails and no offline token is held", async () => {
      seedSession({
        expiresAt: new Date(Date.now() - 60_000),
        offlineToken: undefined,
      });
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      scheduler = makeScheduler();

      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });
      (scheduler as any).wasOnline = false;

      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "Unauthorized" }, { status: 401 }),
        );
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      (scheduler as any).onOnlineEvent();
      await vi.advanceTimersByTimeAsync(0);

      expect(push.preparePush).not.toHaveBeenCalled();
      expect(push.sendBatch).not.toHaveBeenCalled();
    });

    it("still runs the immediate push when refresh fails but an offline token is held", async () => {
      seedSession({
        expiresAt: new Date(Date.now() - 60_000),
        offlineToken: "offline-token-123",
      });
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      scheduler = makeScheduler();

      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });
      (scheduler as any).wasOnline = false;

      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "Unauthorized" }, { status: 401 }),
        );
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      (scheduler as any).onOnlineEvent();
      await vi.advanceTimersByTimeAsync(0);

      expect(push.preparePush).toHaveBeenCalled();
      expect(push.sendBatch).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Auth-readiness gate — tick()
  // -----------------------------------------------------------------------

  describe("auth-readiness gate — tick", () => {
    it("skips the push phase when refresh fails and no offline token is held", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: undefined,
      });
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      // Refresh and exchange both reject — known-unauthenticated.
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "Unauthorized" }, { status: 401 }),
        );
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler();
      await scheduler.syncNow();

      expect(push.preparePush).not.toHaveBeenCalled();
      expect(push.sendBatch).not.toHaveBeenCalled();
    });

    it("still runs the push when refresh fails but an offline token is held", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "offline-token-123",
      });
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "Unauthorized" }, { status: 401 }),
        );
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler();
      await scheduler.syncNow();

      expect(push.preparePush).toHaveBeenCalled();
      expect(push.sendBatch).toHaveBeenCalled();
    });

    it("runs the push when refresh succeeds", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "offline-token-123",
      });
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      // Default beforeEach fetch resolves the refresh response successfully.
      scheduler = makeScheduler();
      await scheduler.syncNow();

      expect(push.preparePush).toHaveBeenCalled();
      expect(push.sendBatch).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Auth-readiness gate — runBurstTick()
  // -----------------------------------------------------------------------

  describe("auth-readiness gate — runBurstTick", () => {
    it("skips the push when refresh fails and no offline token is held", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: undefined,
      });
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "Unauthorized" }, { status: 401 }),
        );
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler();
      (scheduler as any).armBurst();
      await (scheduler as any).runBurstTick();

      expect(push.preparePush).not.toHaveBeenCalled();
      expect(push.sendBatch).not.toHaveBeenCalled();
    });

    it("still runs the push when refresh fails but an offline token is held", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "offline-token-123",
      });
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "Unauthorized" }, { status: 401 }),
        );
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler();
      (scheduler as any).armBurst();
      await (scheduler as any).runBurstTick();

      expect(push.preparePush).toHaveBeenCalled();
      expect(push.sendBatch).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // SecureStorage recovery — refreshAccessToken path 2 with no in-memory
  // offline token: the scheduler falls back to the cached token written at
  // online login, and rotates the cache after a successful exchange.
  // -----------------------------------------------------------------------

  describe("refreshAccessToken — SecureStorage offline-token recovery", () => {
    it("runs the exchange with a cached offline token when the session has none", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: undefined,
        userId: "user-1",
      });
      vi.mocked(createSecureStorage).mockReturnValue(
        makeSecureStorageMock({
          isAvailable: vi.fn().mockResolvedValue(true),
          getItem: vi.fn().mockResolvedValue(CACHED_OFFLINE_TOKEN),
        }) as any,
      );
      vi.mocked(decodeOfflineToken).mockReturnValue(
        VALID_OFFLINE_CLAIMS as any,
      );

      // Refresh rejected, exchange succeeds with the recovered token.
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ message: "Unauthorized" }, { status: 401 }),
        )
        .mockResolvedValue(jsonResponse(EXCHANGE_RESPONSE));
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler();
      await scheduler.syncNow();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/auth/token/exchange",
        expect.objectContaining({
          body: expect.stringContaining(CACHED_OFFLINE_TOKEN),
        }),
      );
      const updatedSession = useLocalSessionStore.getState().session;
      expect(updatedSession?.accessToken).toBe("exchanged-access-token");
      expect(useSyncAuthStatusStore.getState().status).toBe("exchanged");
    });

    it("does not attempt the exchange when the cached token is expired", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: undefined,
        userId: "user-1",
      });
      vi.mocked(createSecureStorage).mockReturnValue(
        makeSecureStorageMock({
          isAvailable: vi.fn().mockResolvedValue(true),
          getItem: vi.fn().mockResolvedValue(CACHED_OFFLINE_TOKEN),
        }) as any,
      );
      vi.mocked(decodeOfflineToken).mockReturnValue(
        EXPIRED_OFFLINE_CLAIMS as any,
      );

      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "Unauthorized" }, { status: 401 }),
        );
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler();
      await scheduler.syncNow();

      const exchangeCalls = mockFetch.mock.calls.filter(
        (args: unknown[]) =>
          typeof args[0] === "string" &&
          (args[0] as string).includes("/auth/token/exchange"),
      );
      expect(exchangeCalls).toHaveLength(0);
      expect(useSyncAuthStatusStore.getState().status).toBe("failed");
    });

    it("rotates the SecureStorage cache with the new token after a successful exchange", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: undefined,
        userId: "user-1",
      });
      const storage = makeSecureStorageMock({
        isAvailable: vi.fn().mockResolvedValue(true),
        getItem: vi.fn().mockResolvedValue(CACHED_OFFLINE_TOKEN),
      });
      vi.mocked(createSecureStorage).mockReturnValue(storage as any);
      vi.mocked(decodeOfflineToken).mockReturnValue(
        VALID_OFFLINE_CLAIMS as any,
      );

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ message: "Unauthorized" }, { status: 401 }),
        )
        .mockResolvedValue(jsonResponse(EXCHANGE_RESPONSE));
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      scheduler = makeScheduler();
      await scheduler.syncNow();

      expect(storage.setItem).toHaveBeenCalledWith(
        "offline_token_user-1",
        "fresh-offline-token",
      );
      expect(storage.setItem).toHaveBeenCalledWith(
        "offline_token_expiry_user-1",
        EXCHANGE_RESPONSE.offlineToken.expiresAt,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Snapshot re-sync — a session offline-token change without an
  // access-token change must still rebuild the push service (the fresh-token
  // early return in refreshAccessToken is the path that triggers it).
  // -----------------------------------------------------------------------

  describe("push service re-sync on offline-token change (fresh-token path)", () => {
    it("rebuilds the push service with the new offline token when only the offline token changed", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 30 * 60_000), // fresh — early return
        offlineToken: "offline-token-A",
      });
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      scheduler = makeScheduler();
      vi.clearAllMocks();

      // The access token stays the same; only the offline token rotates.
      useLocalSessionStore
        .getState()
        .updateSession({ offlineToken: "offline-token-B" });

      await scheduler.syncNow();

      expect(createSyncPushService).toHaveBeenCalledWith(
        expect.objectContaining({ offlineToken: "offline-token-B" }),
      );
      // The rebuilt service is the one the tick pushed with.
      expect(push.preparePush).toHaveBeenCalled();
      expect(push.sendBatch).toHaveBeenCalled();
    });

    it("does not rebuild the push service when the offline token is unchanged", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 30 * 60_000), // fresh — early return
        offlineToken: "offline-token-A",
      });
      const { createSyncPushService } = await import("./sync-push.service");
      const push = makePushServiceMock();
      vi.mocked(createSyncPushService).mockReturnValue(push);

      scheduler = makeScheduler();
      vi.clearAllMocks();

      await scheduler.syncNow();

      expect(createSyncPushService).not.toHaveBeenCalled();
      expect(push.sendBatch).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Reset-on-re-auth — successful refresh/exchange resets FAILED entries'
  // nextRetryAt so the queue drains immediately instead of waiting out
  // stale exponential-backoff timers.
  // -----------------------------------------------------------------------

  describe("reset FAILED retry timers after re-auth", () => {
    // The scheduler resets with a hardcoded budget of 10 that mirrors
    // MAX_RETRY_ATTEMPTS in sync-push.service — assert against the exported
    // constant so a divergence between the two surfaces here.
    it("resets nextRetryAt on FAILED entries after a successful refresh", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "offline-token-123",
      });
      const prisma = makeMockPrisma();

      scheduler = makeScheduler({ prisma });
      await scheduler.syncNow();

      expect(prisma.syncQueue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: "FAILED", retryCount: { lt: MAX_RETRY_ATTEMPTS } },
          data: { nextRetryAt: expect.any(Date) },
        }),
      );
    });

    it("resets nextRetryAt on FAILED entries after a successful exchange", async () => {
      seedSession({
        expiresAt: new Date(Date.now() + 2 * 60_000),
        offlineToken: "offline-token-123",
      });
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ message: "Unauthorized" }, { status: 401 }),
        )
        .mockResolvedValue(jsonResponse(EXCHANGE_RESPONSE));
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
      const prisma = makeMockPrisma();

      scheduler = makeScheduler({ prisma });
      await scheduler.syncNow();

      expect(prisma.syncQueue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: "FAILED", retryCount: { lt: MAX_RETRY_ATTEMPTS } },
          data: { nextRetryAt: expect.any(Date) },
        }),
      );
    });
  });
});
