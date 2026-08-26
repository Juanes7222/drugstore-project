/**
 * Tests for SyncScheduler pull suppression — the 403-driven skip of
 * server pulls the current session's role is not allowed to run.
 *
 * Contract pinned here:
 * - A caught 403-like error (HttpStatusException status 403, or a wrapped
 *   error whose message matches /\b403\b|\bForbidden\b/i) suppresses that
 *   one pull: it logs ONCE and the step is skipped on every later cycle.
 * - Any other error keeps the old behaviour: warn every cycle, retry.
 * - updateAccessToken() clears the suppression set — a new login may carry
 *   different roles.
 *
 * Suppression is observable only through the public surface (syncNow +
 * the sub-service spies), matching how sync-scheduler.update-access-token
 * tests the scheduler's wiring.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock every sub-service factory so each cycle's steps are observable spies.
// ---------------------------------------------------------------------------

vi.mock("../configuration/config-sync.service", () => ({
  createConfigSyncService: vi.fn(() => ({
    fetchConfiguration: vi.fn().mockResolvedValue({}),
    applyConfiguration: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../config/config-sync.service", () => ({
  createTenantConfigSyncService: vi.fn(() => ({
    pullTenantConfig: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../catalog/catalog-sync.service", () => ({
  createCatalogSyncService: vi.fn(() => ({
    fetchCatalog: vi.fn().mockResolvedValue({}),
    applyCatalog: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../inventory-lots/lot-sync.service", () => ({
  createLotSyncService: vi.fn(() => ({
    fetchLots: vi.fn().mockResolvedValue([]),
    applyLots: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../clients/client-pull.service", () => ({
  createClientPullService: vi.fn(() => ({
    fetchClassifications: vi.fn().mockResolvedValue([]),
    applyClassifications: vi.fn().mockResolvedValue(undefined),
    fetchClients: vi.fn().mockResolvedValue([]),
    applyClients: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../cash-shift/open-shift-pull.service", () => ({
  createOpenShiftPullService: vi.fn(() => ({
    fetchOpenShift: vi.fn().mockResolvedValue(null),
    applyOpenShift: vi.fn().mockResolvedValue({ status: "applied" }),
  })),
}));

vi.mock("./sync-push.service", () => ({
  createSyncPushService: vi.fn(() => ({
    preparePush: vi.fn().mockResolvedValue({ entries: [], operations: [], headers: {} }),
    sendBatch: vi.fn(),
    applyPushResult: vi.fn(),
  })),
}));

vi.mock("./sync-metrics.service", () => ({
  createSyncMetricsService: vi.fn(() => ({
    getQueueCounts: vi.fn().mockResolvedValue({
      pending: 0,
      stalePending: 0,
      failed: 0,
      permanentFailure: 0,
      completed24h: 0,
    }),
    getBackupSummary: vi.fn().mockResolvedValue({ lastBackupAt: null }),
  })),
}));

vi.mock("../backup/backup.service", () => ({
  createBackupService: vi.fn(() => ({
    shouldRunPeriodicBackup: vi.fn().mockReturnValue(false),
    createBackup: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Subject under test + spied sub-services
// ---------------------------------------------------------------------------

import { createSyncScheduler, type SyncScheduler } from "./sync-scheduler.service";
import { createCatalogSyncService } from "../catalog/catalog-sync.service";
import { createLotSyncService } from "../inventory-lots/lot-sync.service";
import { createClientPullService } from "../clients/client-pull.service";
import { HttpStatusException } from "../auth/auth-http-client";
import { useLocalSessionStore } from "../auth/local-session.store";
import { useSyncAuthStatusStore } from "./sync-auth-status.store";

const BASE_URL = "http://localhost:3000";

const makeSchedulerConfig = () => ({
  prisma: {} as any,
  baseUrl: BASE_URL,
  config: { baseUrl: BASE_URL },
  catalog: { baseUrl: BASE_URL },
  lots: { baseUrl: BASE_URL },
  clients: { baseUrl: BASE_URL },
});

const seedFreshSession = (): void => {
  // Far-future expiry keeps refreshAccessToken on its fresh-token early
  // return — no network call, authReady = true, pulls run.
  useLocalSessionStore.getState().setSession({
    userId: "user-1",
    username: "test-user",
    fullName: "Test User",
    displayName: "Test User",
    role: "ACCOUNTANT",
    subscriptionId: "sub-1",
    workstationId: "ws-1",
    accessToken: "access-token-123",
    refreshToken: "refresh-token-123",
    expiresAt: new Date(Date.now() + 30 * 60_000),
    sessionId: "session-1",
    totpEnabled: false,
    avatarUrl: null,
    avatarColor: null,
    mustChangePassword: false,
    sessionTrust: "SERVER_VERIFIED",
  });
};

describe("SyncScheduler pull suppression", () => {
  let scheduler: SyncScheduler;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
    });
    seedFreshSession();
    scheduler = createSyncScheduler(makeSchedulerConfig());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useLocalSessionStore.getState().clearSession();
    useSyncAuthStatusStore.getState().reset();
  });

  describe("403 errors suppress the failing pull", () => {
    it("skips lotSync.fetchLots on the next cycle after a HttpStatusException 403 and logs once", async () => {
      const lotSync = vi.mocked(createLotSyncService).mock.results[0].value as any;
      lotSync.fetchLots.mockRejectedValueOnce(
        new HttpStatusException(403, null),
      );

      await scheduler.syncNow();

      expect(lotSync.fetchLots).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[SyncScheduler] lots pull forbidden for this role — suppressed until next login",
      );

      await scheduler.syncNow();

      expect(lotSync.fetchLots).toHaveBeenCalledTimes(1);
    });

    it("suppresses a pull whose error only carries 403 in its message text", async () => {
      // Pull services wrap HttpStatusException into domain errors that keep
      // the status in the message — the matcher must catch those too.
      const clientPull = vi.mocked(createClientPullService).mock.results[0]
        .value as any;
      clientPull.fetchClients.mockRejectedValueOnce(
        new Error("[403] Forbidden for role ACCOUNTANT"),
      );

      await scheduler.syncNow();

      expect(clientPull.fetchClients).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[SyncScheduler] clients pull forbidden for this role — suppressed until next login",
      );

      await scheduler.syncNow();

      expect(clientPull.fetchClients).toHaveBeenCalledTimes(1);
    });

    it("keeps running sibling steps while another pull is suppressed", async () => {
      const lotSync = vi.mocked(createLotSyncService).mock.results[0].value as any;
      const clientPull = vi.mocked(createClientPullService).mock.results[0]
        .value as any;
      const catalogSync = vi.mocked(createCatalogSyncService).mock.results[0]
        .value as any;
      lotSync.fetchLots.mockRejectedValue(new HttpStatusException(403, null));

      await scheduler.syncNow();
      await scheduler.syncNow();

      // lots suppressed after cycle 1...
      expect(lotSync.fetchLots).toHaveBeenCalledTimes(1);
      // ...but unrelated pulls still run every cycle.
      expect(catalogSync.fetchCatalog).toHaveBeenCalledTimes(2);
      expect(clientPull.fetchClients).toHaveBeenCalledTimes(2);
    });
  });

  describe("non-403 errors are transient", () => {
    it("warns and retries lotSync.fetchLots on every cycle", async () => {
      const lotSync = vi.mocked(createLotSyncService).mock.results[0].value as any;
      lotSync.fetchLots.mockRejectedValue(new Error("connection reset"));

      await scheduler.syncNow();
      await scheduler.syncNow();

      expect(lotSync.fetchLots).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[SyncScheduler] lot pull failed:",
        "connection reset",
      );
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    });

    it("does not suppress on an HTTP 500 — the status must be exactly 403", async () => {
      const lotSync = vi.mocked(createLotSyncService).mock.results[0].value as any;
      lotSync.fetchLots.mockRejectedValue(new HttpStatusException(500, null));

      await scheduler.syncNow();
      await scheduler.syncNow();

      expect(lotSync.fetchLots).toHaveBeenCalledTimes(2);
      expect(consoleInfoSpy).not.toHaveBeenCalledWith(
        "[SyncScheduler] lots pull forbidden for this role — suppressed until next login",
      );
    });
  });

  describe("updateAccessToken clears the suppression", () => {
    it("re-enables a suppressed pull after a new login token arrives", async () => {
      const lotSync1 = vi.mocked(createLotSyncService).mock.results[0].value as any;
      lotSync1.fetchLots.mockRejectedValueOnce(
        new HttpStatusException(403, null),
      );
      await scheduler.syncNow();
      expect(lotSync1.fetchLots).toHaveBeenCalledTimes(1);

      await scheduler.syncNow();
      expect(lotSync1.fetchLots).toHaveBeenCalledTimes(1);

      // Fresh login — the new user may be allowed to pull lots again.
      scheduler.updateAccessToken("token-v2");
      // updateAccessToken recreates sub-services; grab the new lotSync instance
      const lotSync2 = vi.mocked(createLotSyncService).mock.results[1].value as any;
      expect(lotSync2).toBeDefined();

      await scheduler.syncNow();

      // old instance stays at 1, new instance called once
      expect(lotSync1.fetchLots).toHaveBeenCalledTimes(1);
      expect(lotSync2.fetchLots).toHaveBeenCalledTimes(1);
    });
  });
});
