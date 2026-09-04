/**
 * Tests for SyncScheduler's user-identities pull (tick step 5.6).
 *
 * Verifies:
 * - Order: open-shift → users → suppliers (FK-safe: the grid mirror lands
 *   after the shift mirror, before the purchases hydration chain).
 * - Fetch runs unlocked, apply runs under the write lock.
 * - pullSuppressed 'users' handling: 403 (HttpStatusException or a wrapped
 *   error carrying 403/Forbidden in its message, which is how
 *   UserPullHttpException surfaces) suppresses until next login; any other
 *   error warns and retries next cycle.
 * - updateAccessToken() recreates the user pull with the new token.
 * - An offline-token-only rotation rebuilds the user pull without an
 *   access-token change.
 * - The offline guard skips the users pull.
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

vi.mock("../auth/user-pull.service", () => ({
  createUserPullService: vi.fn(() => ({
    fetchUserIdentities: vi.fn().mockResolvedValue([]),
    applyUserIdentities: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../fiscal/invoice-sync.service", () => ({
  createInvoiceSyncService: vi.fn(() => ({
    fetchInvoices: vi.fn().mockResolvedValue([]),
    applyInvoices: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../fiscal/invoice-adjustment-sync.service", () => ({
  createInvoiceAdjustmentSyncService: vi.fn(() => ({
    fetchAdjustments: vi.fn().mockResolvedValue([]),
    applyAdjustments: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../audit/audit-sync.service", () => ({
  createAuditSyncService: vi.fn(() => ({
    enqueueUnsynced: vi.fn().mockResolvedValue(0),
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
import { createOpenShiftPullService } from "../cash-shift/open-shift-pull.service";
import { createUserPullService } from "../auth/user-pull.service";
import { createSupplierSyncService } from "../purchases/supplier-sync.service";
import { createSyncPushService } from "./sync-push.service";
import { HttpStatusException } from "../auth/auth-http-client";
import { UserPullHttpException } from "../auth/exceptions";
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

const seedFreshSession = (overrides: Record<string, unknown> = {}): void => {
  // Far-future expiry keeps refreshAccessToken on its fresh-token early
  // return — no network call, authReady = true, pulls run.
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
    ...overrides,
  } as any);
};

const getUserPull = (): any =>
  vi.mocked(createUserPullService).mock.results[0].value as any;

describe("SyncScheduler users pull", () => {
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
    // Keep the transition guard from treating the first tick as offline→online.
    (scheduler as any).wasOnline = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useLocalSessionStore.getState().clearSession();
    useSyncAuthStatusStore.getState().reset();
  });

  describe("step order and locking", () => {
    it("fetches user identities after the open-shift mirror and before suppliers", async () => {
      const order: string[] = [];
      const openShift = vi.mocked(createOpenShiftPullService).mock.results[0].value as any;
      const suppliers = vi.mocked(createSupplierSyncService).mock.results[0].value as any;
      openShift.fetchOpenShift.mockImplementation(async () => {
        order.push("open-shift");
        return null;
      });
      getUserPull().fetchUserIdentities.mockImplementation(async () => {
        order.push("users");
        return [];
      });
      suppliers.fetchSuppliers.mockImplementation(async () => {
        order.push("suppliers");
        return [];
      });

      await scheduler.syncNow();

      expect(order.indexOf("open-shift")).toBeLessThan(order.indexOf("users"));
      expect(order.indexOf("users")).toBeLessThan(order.indexOf("suppliers"));
    });

    it("applies the fetched identities under the write lock", async () => {
      const rows = [{ id: "user-1", username: "cajero1", role: "CASHIER" }];
      getUserPull().fetchUserIdentities.mockResolvedValue(rows);
      const acquireSpy = vi.spyOn(dbWriteLock, "acquire");
      const releaseSpy = vi.spyOn(dbWriteLock, "release");

      await scheduler.syncNow();

      expect(getUserPull().applyUserIdentities).toHaveBeenCalledWith(rows);
      expect(acquireSpy).toHaveBeenCalled();
      expect(releaseSpy).toHaveBeenCalled();
      expect(acquireSpy.mock.calls.length).toBe(releaseSpy.mock.calls.length);

      acquireSpy.mockRestore();
      releaseSpy.mockRestore();
    });

    it("continues to purchases when the users apply fails", async () => {
      getUserPull().applyUserIdentities.mockRejectedValueOnce(new Error("DB write failed"));
      const suppliers = vi.mocked(createSupplierSyncService).mock.results[0].value as any;

      await scheduler.syncNow();

      expect(suppliers.fetchSuppliers).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith("[SyncScheduler] users pull failed:", "DB write failed");
    });
  });

  describe("pullSuppressed handling", () => {
    it("suppresses the users pull after a HttpStatusException 403 and skips it on the next cycle", async () => {
      getUserPull().fetchUserIdentities.mockRejectedValueOnce(new HttpStatusException(403, null));

      await scheduler.syncNow();

      expect(getUserPull().fetchUserIdentities).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[SyncScheduler] users pull forbidden for this role — suppressed until next login",
      );

      await scheduler.syncNow();

      expect(getUserPull().fetchUserIdentities).toHaveBeenCalledTimes(1);
    });

    it("suppresses when a UserPullHttpException carries the 403 in its message", async () => {
      // The default user-pull HTTP client wraps failures into
      // UserPullHttpException, keeping the status in the message text —
      // the scheduler's fallback matcher must catch those too.
      getUserPull().fetchUserIdentities.mockRejectedValueOnce(
        new UserPullHttpException(`${BASE_URL}/users/login-identities?limit=100`, 403, "Forbidden"),
      );

      await scheduler.syncNow();
      await scheduler.syncNow();

      expect(getUserPull().fetchUserIdentities).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[SyncScheduler] users pull forbidden for this role — suppressed until next login",
      );
    });

    it("warns and retries on a non-403 UserPullHttpException", async () => {
      getUserPull().fetchUserIdentities.mockRejectedValue(
        new UserPullHttpException(`${BASE_URL}/users/login-identities?limit=100`, 500, "boom"),
      );

      await scheduler.syncNow();
      await scheduler.syncNow();

      expect(getUserPull().fetchUserIdentities).toHaveBeenCalledTimes(2);
      expect(consoleInfoSpy).not.toHaveBeenCalledWith(
        "[SyncScheduler] users pull forbidden for this role — suppressed until next login",
      );
      const usersWarns = consoleWarnSpy.mock.calls.filter(
        ([msg]: any) => typeof msg === "string" && msg.includes("users pull failed"),
      );
      expect(usersWarns).toHaveLength(2);
    });

    it("keeps running sibling steps while the users pull is suppressed", async () => {
      getUserPull().fetchUserIdentities.mockRejectedValue(new HttpStatusException(403, null));
      const suppliers = vi.mocked(createSupplierSyncService).mock.results[0].value as any;

      await scheduler.syncNow();
      await scheduler.syncNow();

      expect(getUserPull().fetchUserIdentities).toHaveBeenCalledTimes(1);
      expect(suppliers.fetchSuppliers).toHaveBeenCalledTimes(2);
    });

    it("re-enables the users pull after a new login token arrives", async () => {
      const userPull1 = getUserPull();
      userPull1.fetchUserIdentities.mockRejectedValueOnce(new HttpStatusException(403, null));

      await scheduler.syncNow();
      await scheduler.syncNow();
      expect(userPull1.fetchUserIdentities).toHaveBeenCalledTimes(1);

      scheduler.updateAccessToken("token-v2");
      const userPull2 = vi.mocked(createUserPullService).mock.results[1].value as any;
      expect(userPull2).toBeDefined();

      await scheduler.syncNow();

      expect(userPull1.fetchUserIdentities).toHaveBeenCalledTimes(1);
      expect(userPull2.fetchUserIdentities).toHaveBeenCalledTimes(1);
    });
  });

  describe("updateAccessToken", () => {
    it("re-creates the user pull with the new token", () => {
      vi.clearAllMocks();

      scheduler.updateAccessToken("token-v2");

      expect(createUserPullService).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: "token-v2" }),
      );
    });
  });

  describe("offline-token rotation without an access-token change", () => {
    it("rebuilds the user pull when only the offline token changed", async () => {
      seedFreshSession({ offlineToken: "offline-token-A" });
      scheduler = createSyncScheduler(makeSchedulerConfig());
      (scheduler as any).wasOnline = true;
      vi.clearAllMocks();

      useLocalSessionStore.getState().updateSession({ offlineToken: "offline-token-B" });

      await scheduler.syncNow();

      expect(createUserPullService).toHaveBeenCalledWith(
        expect.objectContaining({ offlineToken: "offline-token-B" }),
      );
    });

    it("does not rebuild the user pull when the offline token is unchanged", async () => {
      seedFreshSession({ offlineToken: "offline-token-A" });
      scheduler = createSyncScheduler(makeSchedulerConfig());
      (scheduler as any).wasOnline = true;
      vi.clearAllMocks();

      await scheduler.syncNow();

      expect(createUserPullService).not.toHaveBeenCalled();
      expect(createSyncPushService).not.toHaveBeenCalled();
    });
  });

  describe("isOnline guard", () => {
    it("skips the users pull when offline", async () => {
      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
      (scheduler as any).wasOnline = false;

      await scheduler.syncNow();

      expect(getUserPull().fetchUserIdentities).not.toHaveBeenCalled();
      expect(getUserPull().applyUserIdentities).not.toHaveBeenCalled();
    });
  });
});
