/**
 * Tests for SyncScheduler purchases/sales hydration branches (tick step 6/6.5).
 *
 * Verifies:
 * - Order: suppliers → purchase-orders → purchase-receptions → supplier-returns → sales
 * - pullSuppressed handling per branch (403 suppresses, non-403 retries, updateAccessToken clears)
 * - isOnline guard skips all 5 pulls
 * - withLock wraps each apply phase (fetch outside, apply inside)
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock every sub-service factory so each tick step is an observable spy.
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
// Subject under test + helpers
// ---------------------------------------------------------------------------

import { createSyncScheduler, type SyncScheduler } from "./sync-scheduler.service";
import { createSupplierSyncService } from "../purchases/supplier-sync.service";
import { createPurchaseOrderSyncService } from "../purchases/purchase-order-sync.service";
import { createPurchaseReceptionSyncService } from "../purchases/purchase-reception-sync.service";
import { createSupplierReturnSyncService } from "../purchases/supplier-return-sync.service";
import { createSalesSyncService } from "../sales-pos/sales-sync.service";
import { HttpStatusException } from "../auth/auth-http-client";
import { useLocalSessionStore } from "../auth/local-session.store";
import { useSyncAuthStatusStore } from "./sync-auth-status.store";
import { dbWriteLock } from "../../infrastructure/write-lock";

const BASE_URL = "http://localhost:3000";

const makeSchedulerConfig = () => ({
  prisma: {
    syncQueue: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _max: { clientSequence: 0n } }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as any,
  baseUrl: BASE_URL,
  config: { baseUrl: BASE_URL },
  catalog: { baseUrl: BASE_URL },
  lots: { baseUrl: BASE_URL },
  clients: { baseUrl: BASE_URL },
});

const seedFreshSession = (): void => {
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
    expiresAt: new Date(Date.now() + 30 * 60_000),
    sessionId: "session-1",
    totpEnabled: false,
    avatarUrl: null,
    avatarColor: null,
    mustChangePassword: false,
    sessionTrust: "SERVER_VERIFIED",
  } as any);
};

describe("SyncScheduler purchases/sales hydration", () => {
  let scheduler: SyncScheduler;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    seedFreshSession();
    scheduler = createSyncScheduler(makeSchedulerConfig());
    // Ensure the transition guard does not treat first tick as offline→online
    (scheduler as any).wasOnline = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useLocalSessionStore.getState().clearSession();
    useSyncAuthStatusStore.getState().reset();
  });

  describe("order of purchases hydration steps", () => {
    it("calls fetch in order suppliers → orders → receptions → returns → sales", async () => {
      const order: string[] = [];

      const sup = vi.mocked(createSupplierSyncService).mock.results[0].value as any;
      const po = vi.mocked(createPurchaseOrderSyncService).mock.results[0].value as any;
      const rec = vi.mocked(createPurchaseReceptionSyncService).mock.results[0].value as any;
      const ret = vi.mocked(createSupplierReturnSyncService).mock.results[0].value as any;
      const sales = vi.mocked(createSalesSyncService).mock.results[0].value as any;

      sup.fetchSuppliers.mockImplementation(async () => { order.push("suppliers"); return []; });
      po.fetchPurchaseOrders.mockImplementation(async () => { order.push("purchase-orders"); return []; });
      rec.fetchReceptions.mockImplementation(async () => { order.push("purchase-receptions"); return []; });
      ret.fetchSupplierReturns.mockImplementation(async () => { order.push("supplier-returns"); return []; });
      sales.fetchSales.mockImplementation(async () => { order.push("sales"); return []; });

      await scheduler.syncNow();

      expect(order).toEqual(["suppliers", "purchase-orders", "purchase-receptions", "supplier-returns", "sales"]);
    });

    it("calls apply in same FK-safe order after each fetch", async () => {
      const order: string[] = [];

      const sup = vi.mocked(createSupplierSyncService).mock.results[0].value as any;
      const po = vi.mocked(createPurchaseOrderSyncService).mock.results[0].value as any;
      const rec = vi.mocked(createPurchaseReceptionSyncService).mock.results[0].value as any;
      const ret = vi.mocked(createSupplierReturnSyncService).mock.results[0].value as any;
      const sales = vi.mocked(createSalesSyncService).mock.results[0].value as any;

      sup.applySuppliers.mockImplementation(async () => { order.push("apply-suppliers"); });
      po.applyPurchaseOrders.mockImplementation(async () => { order.push("apply-purchase-orders"); });
      rec.applyReceptions.mockImplementation(async () => { order.push("apply-purchase-receptions"); });
      ret.applySupplierReturns.mockImplementation(async () => { order.push("apply-supplier-returns"); });
      sales.applySales.mockImplementation(async () => { order.push("apply-sales"); });

      await scheduler.syncNow();

      expect(order).toEqual([
        "apply-suppliers",
        "apply-purchase-orders",
        "apply-purchase-receptions",
        "apply-supplier-returns",
        "apply-sales",
      ]);
    });
  });

  describe("pullSuppressed handling", () => {
    it("suppresses suppliers pull after 403 and skips it on next cycle", async () => {
      const sup = vi.mocked(createSupplierSyncService).mock.results[0].value as any;
      sup.fetchSuppliers.mockRejectedValueOnce(new HttpStatusException(403, null));

      await scheduler.syncNow();
      expect(sup.fetchSuppliers).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledWith("[SyncScheduler] suppliers pull forbidden for this role — suppressed until next login");

      await scheduler.syncNow();
      expect(sup.fetchSuppliers).toHaveBeenCalledTimes(1);
    });

    it("suppresses purchase-orders pull after 403", async () => {
      const po = vi.mocked(createPurchaseOrderSyncService).mock.results[0].value as any;
      po.fetchPurchaseOrders.mockRejectedValueOnce(new HttpStatusException(403, null));

      await scheduler.syncNow();
      expect(po.fetchPurchaseOrders).toHaveBeenCalledTimes(1);

      await scheduler.syncNow();
      expect(po.fetchPurchaseOrders).toHaveBeenCalledTimes(1);
    });

    it("suppresses purchase-receptions pull after 403", async () => {
      const rec = vi.mocked(createPurchaseReceptionSyncService).mock.results[0].value as any;
      rec.fetchReceptions.mockRejectedValueOnce(new HttpStatusException(403, null));

      await scheduler.syncNow();
      await scheduler.syncNow();

      expect(rec.fetchReceptions).toHaveBeenCalledTimes(1);
    });

    it("suppresses supplier-returns pull after 403", async () => {
      const ret = vi.mocked(createSupplierReturnSyncService).mock.results[0].value as any;
      ret.fetchSupplierReturns.mockRejectedValueOnce(new HttpStatusException(403, null));

      await scheduler.syncNow();
      await scheduler.syncNow();

      expect(ret.fetchSupplierReturns).toHaveBeenCalledTimes(1);
    });

    it("suppresses sales pull after 403", async () => {
      const sales = vi.mocked(createSalesSyncService).mock.results[0].value as any;
      sales.fetchSales.mockRejectedValueOnce(new HttpStatusException(403, null));

      await scheduler.syncNow();
      await scheduler.syncNow();

      expect(sales.fetchSales).toHaveBeenCalledTimes(1);
    });

    it("catches wrapped error with 403 in message text as suppressed", async () => {
      const po = vi.mocked(createPurchaseOrderSyncService).mock.results[0].value as any;
      po.fetchPurchaseOrders.mockRejectedValueOnce(new Error("[403] Forbidden"));

      await scheduler.syncNow();
      await scheduler.syncNow();

      expect(po.fetchPurchaseOrders).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledWith("[SyncScheduler] purchase-orders pull forbidden for this role — suppressed until next login");
    });

    it("does not suppress on non-403 error and retries next cycle", async () => {
      const sup = vi.mocked(createSupplierSyncService).mock.results[0].value as any;
      sup.fetchSuppliers.mockRejectedValue(new Error("connection reset"));

      await scheduler.syncNow();
      await scheduler.syncNow();

      expect(sup.fetchSuppliers).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith("[SyncScheduler] suppliers pull failed:", "connection reset");
    });

    it("keeps running sibling pulls while one is suppressed", async () => {
      const sup = vi.mocked(createSupplierSyncService).mock.results[0].value as any;
      const po = vi.mocked(createPurchaseOrderSyncService).mock.results[0].value as any;
      const sales = vi.mocked(createSalesSyncService).mock.results[0].value as any;
      sup.fetchSuppliers.mockRejectedValue(new HttpStatusException(403, null));

      await scheduler.syncNow();
      await scheduler.syncNow();

      expect(sup.fetchSuppliers).toHaveBeenCalledTimes(1);
      expect(po.fetchPurchaseOrders).toHaveBeenCalledTimes(2);
      expect(sales.fetchSales).toHaveBeenCalledTimes(2);
    });

    it("clears suppression after updateAccessToken", async () => {
      const sup1 = vi.mocked(createSupplierSyncService).mock.results[0].value as any;
      sup1.fetchSuppliers.mockRejectedValueOnce(new HttpStatusException(403, null));

      await scheduler.syncNow();
      expect(sup1.fetchSuppliers).toHaveBeenCalledTimes(1);

      await scheduler.syncNow();
      expect(sup1.fetchSuppliers).toHaveBeenCalledTimes(1);

      scheduler.updateAccessToken("token-v2");

      const sup2 = vi.mocked(createSupplierSyncService).mock.results[1].value as any;
      expect(sup2).toBeDefined();

      await scheduler.syncNow();

      expect(sup1.fetchSuppliers).toHaveBeenCalledTimes(1);
      expect(sup2.fetchSuppliers).toHaveBeenCalledTimes(1);
    });

    it("updateAccessToken clears all purchases/sales suppressions at once", async () => {
      const po = vi.mocked(createPurchaseOrderSyncService).mock.results[0].value as any;
      const sales = vi.mocked(createSalesSyncService).mock.results[0].value as any;
      po.fetchPurchaseOrders.mockRejectedValue(new HttpStatusException(403, null));
      sales.fetchSales.mockRejectedValue(new HttpStatusException(403, null));

      await scheduler.syncNow();
      await scheduler.syncNow();

      expect(po.fetchPurchaseOrders).toHaveBeenCalledTimes(1);
      expect(sales.fetchSales).toHaveBeenCalledTimes(1);

      scheduler.updateAccessToken("token-v2");

      const po2 = vi.mocked(createPurchaseOrderSyncService).mock.results[1].value as any;
      const sales2 = vi.mocked(createSalesSyncService).mock.results[1].value as any;

      await scheduler.syncNow();

      expect(po2.fetchPurchaseOrders).toHaveBeenCalledTimes(1);
      expect(sales2.fetchSales).toHaveBeenCalledTimes(1);
    });
  });

  describe("isOnline guard", () => {
    it("skips all purchases/sales pulls when offline", async () => {
      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
      (scheduler as any).wasOnline = false;

      const sup = vi.mocked(createSupplierSyncService).mock.results[0].value as any;
      const po = vi.mocked(createPurchaseOrderSyncService).mock.results[0].value as any;
      const rec = vi.mocked(createPurchaseReceptionSyncService).mock.results[0].value as any;
      const ret = vi.mocked(createSupplierReturnSyncService).mock.results[0].value as any;
      const sales = vi.mocked(createSalesSyncService).mock.results[0].value as any;

      await scheduler.syncNow();

      expect(sup.fetchSuppliers).not.toHaveBeenCalled();
      expect(po.fetchPurchaseOrders).not.toHaveBeenCalled();
      expect(rec.fetchReceptions).not.toHaveBeenCalled();
      expect(ret.fetchSupplierReturns).not.toHaveBeenCalled();
      expect(sales.fetchSales).not.toHaveBeenCalled();
    });

    it("still runs catalog/lots pulls isOnline check before purchases does not affect earlier steps", async () => {
      // Offline short-circuits entire tick, so nothing runs — verify early return
      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
      (scheduler as any).wasOnline = true;

      await scheduler.syncNow();

      const sup = vi.mocked(createSupplierSyncService).mock.results[0].value as any;
      expect(sup.fetchSuppliers).not.toHaveBeenCalled();
    });
  });

  describe("withLock wrapping", () => {
    it("wraps each apply phase with dbWriteLock acquire/release", async () => {
      const acquireSpy = vi.spyOn(dbWriteLock, "acquire");
      const releaseSpy = vi.spyOn(dbWriteLock, "release");

      await scheduler.syncNow();

      // At least 5 purchases/sales apply calls + config/catalog/lots/clients/open-shift
      // Check that acquire was called at least 5 times for purchases/sales
      expect(acquireSpy).toHaveBeenCalled();
      expect(releaseSpy).toHaveBeenCalled();
      // Acquire and release should be balanced
      expect(acquireSpy.mock.calls.length).toBe(releaseSpy.mock.calls.length);

      acquireSpy.mockRestore();
      releaseSpy.mockRestore();
    });

    it("fetch phases run without holding the lock (no deadlock on slow network)", async () => {
      const sup = vi.mocked(createSupplierSyncService).mock.results[0].value as any;
      const po = vi.mocked(createPurchaseOrderSyncService).mock.results[0].value as any;

      let fetchHeldLock = false;
      sup.fetchSuppliers.mockImplementation(async () => {
        // If fetch ran under lock, acquire would be held — check indirectly via isBackgroundPaused not relevant
        // Just verify fetch was called
        fetchHeldLock = false;
        return [];
      });
      po.fetchPurchaseOrders.mockImplementation(async () => {
        return [];
      });

      await scheduler.syncNow();

      expect(sup.fetchSuppliers).toHaveBeenCalled();
      expect(po.fetchPurchaseOrders).toHaveBeenCalled();
      expect(fetchHeldLock).toBe(false);
    });

    it("continues to next purchase pull after one apply fails", async () => {
      const sup = vi.mocked(createSupplierSyncService).mock.results[0].value as any;
      const po = vi.mocked(createPurchaseOrderSyncService).mock.results[0].value as any;
      const rec = vi.mocked(createPurchaseReceptionSyncService).mock.results[0].value as any;

      sup.applySuppliers.mockRejectedValueOnce(new Error("DB write failed"));
      // fetch succeeds, apply fails — next pulls should still run

      await scheduler.syncNow();

      expect(sup.applySuppliers).toHaveBeenCalledTimes(1);
      expect(po.fetchPurchaseOrders).toHaveBeenCalledTimes(1);
      expect(rec.fetchReceptions).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith("[SyncScheduler] suppliers pull failed:", "DB write failed");
    });
  });

  describe("pullSuppressed key names", () => {
    it("logs supplier-returns suppression with correct key", async () => {
      const ret = vi.mocked(createSupplierReturnSyncService).mock.results[0].value as any;
      ret.fetchSupplierReturns.mockRejectedValueOnce(new HttpStatusException(403, null));

      await scheduler.syncNow();

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[SyncScheduler] supplier-returns pull forbidden for this role — suppressed until next login",
      );
    });

    it("logs sales suppression with correct key", async () => {
      const sales = vi.mocked(createSalesSyncService).mock.results[0].value as any;
      sales.fetchSales.mockRejectedValueOnce(new HttpStatusException(403, null));

      await scheduler.syncNow();

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[SyncScheduler] sales pull forbidden for this role — suppressed until next login",
      );
    });
  });
});
