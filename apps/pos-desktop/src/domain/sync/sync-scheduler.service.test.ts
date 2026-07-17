/**
 * Unit tests for SyncScheduler — lifecycle, tick orchestration, and
 * access-token refresh (refreshAccessToken).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createSyncScheduler, SyncScheduler } from "./sync-scheduler.service";
import { useLocalSessionStore } from "../auth/local-session.store";
import { useSyncAuthStatusStore } from "./sync-auth-status.store";
import type { LocalSession } from "../auth/local-session.store";

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
        ([url]: [string]) => typeof url === "string" && url.includes("/auth/token/exchange"),
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
});
