/**
 * Tests for SyncScheduler.updateAccessToken() — token refresh and
 * sub-service re-creation after login.
 *
 * These tests complement the existing sync-scheduler.service.test.ts
 * by covering the wire-up that was added to support post-login auth.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock all sub-service factories — we need to verify which factories are
// called during updateAccessToken() and with what arguments.
// ---------------------------------------------------------------------------

vi.mock("../configuration/config-sync.service", () => ({
  createConfigSyncService: vi.fn(() => ({
    fetchConfiguration: vi.fn(),
    applyConfiguration: vi.fn(),
  })),
}));

vi.mock("../catalog/catalog-sync.service", () => ({
  createCatalogSyncService: vi.fn(() => ({
    fetchCatalog: vi.fn(),
    applyCatalog: vi.fn(),
  })),
}));

vi.mock("../inventory-lots/lot-sync.service", () => ({
  createLotSyncService: vi.fn(() => ({
    fetchLots: vi.fn(),
    applyLots: vi.fn(),
  })),
}));

vi.mock("../clients/client-pull.service", () => ({
  createClientPullService: vi.fn(() => ({
    fetchClassifications: vi.fn(),
    applyClassifications: vi.fn(),
    fetchClients: vi.fn(),
    applyClients: vi.fn(),
  })),
}));

vi.mock("../cash-shift/open-shift-pull.service", () => ({
  createOpenShiftPullService: vi.fn(() => ({
    fetchOpenShift: vi.fn(),
    applyOpenShift: vi.fn(),
    refreshOpenShift: vi.fn(),
  })),
}));

vi.mock("./sync-push.service", () => ({
  createSyncPushService: vi.fn(() => ({
    preparePush: vi.fn(),
    sendBatch: vi.fn(),
    applyPushResult: vi.fn(),
  })),
}));

vi.mock("./sync-metrics.service", () => ({
  createSyncMetricsService: vi.fn(() => ({
    getQueueCounts: vi.fn().mockResolvedValue({}),
    getBackupSummary: vi.fn().mockResolvedValue({ lastBackupAt: null }),
  })),
}));

vi.mock("../backup/backup.service", () => ({
  createBackupService: vi.fn(() => ({
    shouldRunPeriodicBackup: vi.fn(),
    createBackup: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { createSyncScheduler, type SyncScheduler } from "./sync-scheduler.service";
import { createConfigSyncService } from "../configuration/config-sync.service";
import { createCatalogSyncService } from "../catalog/catalog-sync.service";
import { createLotSyncService } from "../inventory-lots/lot-sync.service";
import { createClientPullService } from "../clients/client-pull.service";
import { createSyncPushService } from "./sync-push.service";
import { createOpenShiftPullService } from "../cash-shift/open-shift-pull.service";
import { createBackupService } from "../backup/backup.service";
import { createSyncMetricsService } from "./sync-metrics.service";
import { useLocalSessionStore } from "../auth/local-session.store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = "http://localhost:3000";

const makeSchedulerConfig = (overrides: Record<string, unknown> = {}) => ({
  prisma: {} as any,
  baseUrl: BASE_URL,
  config: { baseUrl: BASE_URL },
  catalog: { baseUrl: BASE_URL },
  lots: { baseUrl: BASE_URL },
  clients: { baseUrl: BASE_URL },
  accessToken: "initial-token",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SyncScheduler.updateAccessToken", () => {
  let scheduler: SyncScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // updateAccessToken — sub-service re-creation
  // -----------------------------------------------------------------------

  describe("updateAccessToken re-creates sub-services", () => {
    it("re-creates ConfigSyncService with the new token", () => {
      scheduler = createSyncScheduler(makeSchedulerConfig());
      vi.clearAllMocks();

      scheduler.updateAccessToken("token-v2");

      expect(createConfigSyncService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ accessToken: "token-v2" }),
      );
    });

    it("re-creates CatalogSyncService with the new token", () => {
      scheduler = createSyncScheduler(makeSchedulerConfig());
      vi.clearAllMocks();

      scheduler.updateAccessToken("token-v2");

      expect(createCatalogSyncService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ accessToken: "token-v2" }),
      );
    });

    it("re-creates LotSyncService with the new token", () => {
      scheduler = createSyncScheduler(makeSchedulerConfig());
      vi.clearAllMocks();

      scheduler.updateAccessToken("token-v2");

      expect(createLotSyncService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ accessToken: "token-v2" }),
      );
    });

    it("re-creates ClientPullService with the new token", () => {
      scheduler = createSyncScheduler(makeSchedulerConfig());
      vi.clearAllMocks();

      scheduler.updateAccessToken("token-v2");

      expect(createClientPullService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ accessToken: "token-v2" }),
      );
    });

    it("re-creates OpenShiftPullService with the new token and the session workstation", () => {
      // The open-shift pull's conflict heuristic needs a workstation id; a
      // seeded session must flow into its context on re-creation.
      useLocalSessionStore.getState().setSession({
        userId: "user-1",
        username: "test-user",
        fullName: "Test User",
        displayName: "Test User",
        email: null,
        role: "ADMIN",
        subscriptionId: null,
        workstationId: "ws-open-shift",
        accessToken: "access-token-123",
        refreshToken: "refresh-token-123",
        expiresAt: new Date(Date.now() + 600_000),
        sessionId: "session-1",
        totpEnabled: false,
        avatarUrl: null,
        avatarColor: null,
        mustChangePassword: false,
        sessionTrust: "SERVER_VERIFIED",
      } as any);
      scheduler = createSyncScheduler(makeSchedulerConfig());
      vi.clearAllMocks();

      scheduler.updateAccessToken("token-v2");

      expect(createOpenShiftPullService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ accessToken: "token-v2" }),
        { workstationId: "ws-open-shift" },
      );
    });

    it("re-creates SyncPushService with the new token", () => {
      scheduler = createSyncScheduler(makeSchedulerConfig());
      vi.clearAllMocks();

      scheduler.updateAccessToken("token-v2");

      expect(createSyncPushService).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: "token-v2" }),
      );
    });
  });

  describe("updateAccessToken preserves static services", () => {
    it("does not re-create BackupService", () => {
      scheduler = createSyncScheduler(makeSchedulerConfig());
      // Called exactly once during construction
      expect(createBackupService).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      scheduler.updateAccessToken("token-v2");

      expect(createBackupService).not.toHaveBeenCalled();
    });

    it("does not re-create SyncMetricsService", () => {
      scheduler = createSyncScheduler(makeSchedulerConfig());
      expect(createSyncMetricsService).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      scheduler.updateAccessToken("token-v2");

      expect(createSyncMetricsService).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Integration with start()
  // -----------------------------------------------------------------------

  describe("start after updateAccessToken", () => {
    it("sets up the sync interval after token update", () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

      scheduler = createSyncScheduler(makeSchedulerConfig());
      scheduler.updateAccessToken("token-v2");
      scheduler.start();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));

      setIntervalSpy.mockRestore();
      vi.useRealTimers();
    });

    it("fires a sync tick with the updated sub-services", async () => {
      // Fresh spies for the fetch/apply phase methods that tick() calls
      const fetchConfiguration = vi.fn().mockResolvedValue({});
      const applyConfiguration = vi.fn().mockResolvedValue(undefined);
      const preparePush = vi
        .fn()
        .mockResolvedValue({ entries: [{ id: "entry-1" }], operations: [], headers: {} });
      const sendBatch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        bodyText: "[]",
      });
      const applyPushResult = vi.fn().mockResolvedValue({ pushed: 1, accepted: 1 });
      const fetchCatalog = vi.fn().mockResolvedValue({});
      const applyCatalog = vi.fn().mockResolvedValue(undefined);
      const fetchLots = vi.fn().mockResolvedValue([]);
      const applyLots = vi.fn().mockResolvedValue(undefined);
      const fetchClassifications = vi.fn().mockResolvedValue([]);
      const applyClassifications = vi.fn().mockResolvedValue(undefined);
      const fetchClients = vi.fn().mockResolvedValue([]);
      const applyClients = vi.fn().mockResolvedValue(undefined);

      // Wire the spies as return values so both constructor AND
      // updateAccessToken() produce services wired to these spies.
      vi.mocked(createConfigSyncService).mockReturnValue({
        fetchConfiguration,
        applyConfiguration,
      } as any);
      vi.mocked(createCatalogSyncService).mockReturnValue({
        fetchCatalog,
        applyCatalog,
      } as any);
      vi.mocked(createLotSyncService).mockReturnValue({
        fetchLots,
        applyLots,
      } as any);
      vi.mocked(createClientPullService).mockReturnValue({
        fetchClassifications,
        applyClassifications,
        fetchClients,
        applyClients,
      } as any);
      vi.mocked(createSyncPushService).mockReturnValue({
        preparePush,
        sendBatch,
        applyPushResult,
      } as any);

      // Ensure isOnline() returns true so tick() does not bail early
      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });

      scheduler = createSyncScheduler(makeSchedulerConfig());
      scheduler.updateAccessToken("token-v2");

      // Seed a valid session. The scheduler's auth-readiness gate skips
      // the push phase when the session is missing and no offline token
      // is held — a sessionless tick is known-unauthenticated. A far-
      // future expiry keeps refreshAccessToken on its fresh-token early
      // return, so no network call is made and the push phase runs.
      useLocalSessionStore.getState().setSession({
        userId: "user-1",
        username: "test-user",
        fullName: "Test User",
        displayName: "Test User",
        role: "ADMIN",
        subscriptionId: "sub-1",
        workstationId: "ws-1",
        accessToken: "access-token-123",
        refreshToken: "refresh-token-123",
        expiresAt: new Date(Date.now() + 1_800_000), // 30 min — outside the 2x-interval buffer
        sessionId: "session-1",
        sessionTrust: "SERVER_VERIFIED",
        offlineToken: "offline-token-123",
      });

      // syncNow() calls tick() — the full sync cycle
      await scheduler.syncNow();

      // Network phases run first; their apply phases then run under the lock.
      expect(fetchConfiguration).toHaveBeenCalledOnce();
      expect(applyConfiguration).toHaveBeenCalledOnce();
      expect(preparePush).toHaveBeenCalledOnce();
      expect(sendBatch).toHaveBeenCalledOnce();
      expect(applyPushResult).toHaveBeenCalledOnce();
      expect(fetchCatalog).toHaveBeenCalledOnce();
      expect(applyCatalog).toHaveBeenCalledOnce();
      expect(fetchLots).toHaveBeenCalledOnce();
      expect(applyLots).toHaveBeenCalledOnce();
      expect(fetchClassifications).toHaveBeenCalledOnce();
      expect(applyClassifications).toHaveBeenCalledOnce();
      expect(fetchClients).toHaveBeenCalledOnce();
      expect(applyClients).toHaveBeenCalledOnce();
    });
  });
});
