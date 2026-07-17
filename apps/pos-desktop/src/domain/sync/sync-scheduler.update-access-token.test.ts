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
  createConfigSyncService: vi.fn(() => ({ pullConfiguration: vi.fn() })),
}));

vi.mock("../catalog/catalog-sync.service", () => ({
  createCatalogSyncService: vi.fn(() => ({ pullCatalog: vi.fn() })),
}));

vi.mock("../inventory-lots/lot-sync.service", () => ({
  createLotSyncService: vi.fn(() => ({ pullLots: vi.fn() })),
}));

vi.mock("../clients/client-pull.service", () => ({
  createClientPullService: vi.fn(() => ({ pullClients: vi.fn() })),
}));

vi.mock("./sync-push.service", () => ({
  createSyncPushService: vi.fn(() => ({ pushPending: vi.fn() })),
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
import { createBackupService } from "../backup/backup.service";
import { createSyncMetricsService } from "./sync-metrics.service";

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
      // Fresh spies for the sub-service methods that tick() calls
      const pullConfiguration = vi.fn().mockResolvedValue(undefined);
      const pushPending = vi.fn().mockResolvedValue(undefined);
      const pullCatalog = vi.fn().mockResolvedValue(undefined);
      const pullLots = vi.fn().mockResolvedValue(undefined);
      const pullClients = vi.fn().mockResolvedValue(undefined);

      // Wire the spies as return values so both constructor AND
      // updateAccessToken() produce services wired to these spies.
      vi.mocked(createConfigSyncService).mockReturnValue({
        pullConfiguration,
      } as any);
      vi.mocked(createCatalogSyncService).mockReturnValue({
        pullCatalog,
      } as any);
      vi.mocked(createLotSyncService).mockReturnValue({ pullLots } as any);
      vi.mocked(createClientPullService).mockReturnValue({
        pullClients,
      } as any);
      vi.mocked(createSyncPushService).mockReturnValue({
        pushPending,
      } as any);

      // Ensure isOnline() returns true so tick() does not bail early
      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });

      scheduler = createSyncScheduler(makeSchedulerConfig());
      scheduler.updateAccessToken("token-v2");

      // syncNow() calls tick() — the full sync cycle
      await scheduler.syncNow();

      expect(pullConfiguration).toHaveBeenCalledOnce();
      expect(pushPending).toHaveBeenCalledOnce();
      expect(pullCatalog).toHaveBeenCalledOnce();
      expect(pullLots).toHaveBeenCalledOnce();
      expect(pullClients).toHaveBeenCalledOnce();
    });
  });
});
