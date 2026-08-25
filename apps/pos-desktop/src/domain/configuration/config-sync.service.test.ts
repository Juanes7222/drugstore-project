/**
 * Unit tests for ConfigSyncService — pulling POS settings from server.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createConfigSyncService, type ConfigSyncService, ConfigSyncHttpError, type PosResolutionPayload } from "./config-sync.service";
import type { SyncHttpClient } from "../catalog/catalog-sync.service";
import type { FiscalNumberingService } from "../fiscal/numbering.service";
import { useLocalConfigStore } from "./local-config.store";
import { useCompanySetupStore } from "../company/company.store";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    paymentMethod: { upsert: vi.fn() },
  };

  const prisma = {
    $transaction: vi.fn(async (cb: (t: any) => unknown) => cb(tx)),
    paymentMethod: tx.paymentMethod,
  } as any;

  return { prisma, tx };
};

const makeMockHttpClient = (): SyncHttpClient => ({
  get: vi.fn(),
  post: vi.fn(),
});

const makeResolutionPayload = (
  overrides: Partial<PosResolutionPayload> = {},
): PosResolutionPayload => ({
  resolutionNumber: "18760000001234",
  documentType: "INVOICE",
  prefix: "FE",
  rangeFrom: 1000,
  rangeTo: 1999,
  validFrom: "2026-01-15",
  validTo: "2031-01-15",
  currentConsecutive: 1005,
  state: "ACTIVE",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConfigSyncService", () => {
  let prisma: any;
  let tx: any;
  let http: SyncHttpClient;
  let service: ConfigSyncService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    http = makeMockHttpClient();
    service = createConfigSyncService(prisma, {
      baseUrl: "http://localhost:3000",
      httpClient: http,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("pullConfiguration", () => {
    it("fetches pos-settings and upserts payment methods", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      vi.mocked(http.get).mockResolvedValue({
        paymentMethods: [
          { id: "pm-1", internalCode: "CASH", name: "Efectivo", category: "CASH", isCash: true, sortOrder: 1, isActive: true },
        ],
        discountLimits: {
          owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
          manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
          cashier: { itemMaxPercent: 15, globalMaxPercent: 10 },
          admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
          inventoryAssistant: { itemMaxPercent: 20, globalMaxPercent: 15 },
          accountant: { itemMaxPercent: 5, globalMaxPercent: 5 },
        },
        salesConfig: {
          priceOverridePermissions: {
            manager: { allowed: true, requireReason: true },
            cashier: { allowed: false, requireReason: true },
            inventoryAssistant: { allowed: false, requireReason: true },
            accountant: { allowed: false, requireReason: true },
          },
          priceFloor: { enabled: true, type: "COST", minMarginPercent: 0 },
        },
        alertThresholds: {
          expirationWarningDays: 60,
          lowStockAlertEnabled: true,
        },
        syncDefaults: {
          batchSize: 25,
          maxRetryAttempts: 15,
          retryDelaysSeconds: [60, 120, 300],
        },
      });

      await service.pullConfiguration();

      expect(tx.paymentMethod.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "pm-1" },
        }),
      );

      // Zustand store should be hydrated
      const config = useLocalConfigStore.getState();
      expect(config.discountLimits.cashier.itemMaxPercent).toBe(15);
      expect(config.syncDefaults.batchSize).toBe(25);

      vi.unstubAllGlobals();
    });

    it("keeps the local credit policy when the server payload omits it", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      useLocalConfigStore.getState().updateSalesConfig({
        creditEnabled: true,
        defaultCreditLimitCents: 7_000_000,
      });

      vi.mocked(http.get).mockResolvedValue({
        paymentMethods: [],
        discountLimits: {
          owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
          manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
          cashier: { itemMaxPercent: 15, globalMaxPercent: 10 },
          admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
          inventoryAssistant: { itemMaxPercent: 20, globalMaxPercent: 15 },
          accountant: { itemMaxPercent: 5, globalMaxPercent: 5 },
        },
        // salesConfig from an older server: no credit fields.
        salesConfig: {
          priceOverridePermissions: {
            manager: { allowed: true, requireReason: true },
            cashier: { allowed: false, requireReason: true },
            inventoryAssistant: { allowed: false, requireReason: true },
            accountant: { allowed: false, requireReason: true },
          },
          priceFloor: { enabled: true, type: "COST", minMarginPercent: 0 },
        },
        alertThresholds: {
          expirationWarningDays: 60,
          lowStockAlertEnabled: true,
        },
        syncDefaults: {
          batchSize: 25,
          maxRetryAttempts: 15,
          retryDelaysSeconds: [60],
        },
      });

      await service.pullConfiguration();

      const config = useLocalConfigStore.getState();
      expect(config.salesConfig.creditEnabled).toBe(true);
      expect(config.salesConfig.defaultCreditLimitCents).toBe(7_000_000);

      vi.unstubAllGlobals();
    });

    it("does nothing when offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });

      await service.pullConfiguration();

      expect(http.get).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("throws ConfigSyncHttpError on HTTP error", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      vi.mocked(http.get).mockRejectedValue(
        new ConfigSyncHttpError("/configuration/pos-settings", 500, "Server error"),
      );

      await expect(service.pullConfiguration()).rejects.toThrow(ConfigSyncHttpError);

      vi.unstubAllGlobals();
    });

    it("passes Authorization header when accessToken is set", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      const mocks = makeMockPrisma();
      const authedHttp = makeMockHttpClient();
      const authedService = createConfigSyncService(mocks.prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: authedHttp,
        accessToken: "test-token",
      });

      vi.mocked(authedHttp.get).mockResolvedValue({
        paymentMethods: [],
        discountLimits: {
          owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
          manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
          cashier: { itemMaxPercent: 15, globalMaxPercent: 10 },
          admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
          inventoryAssistant: { itemMaxPercent: 20, globalMaxPercent: 15 },
          accountant: { itemMaxPercent: 5, globalMaxPercent: 5 },
        },
        salesConfig: {
          priceOverridePermissions: {
            manager: { allowed: true, requireReason: true },
            cashier: { allowed: false, requireReason: true },
            inventoryAssistant: { allowed: false, requireReason: true },
            accountant: { allowed: false, requireReason: true },
          },
          priceFloor: { enabled: true, type: "COST", minMarginPercent: 0 },
        },
        alertThresholds: {
          expirationWarningDays: 60,
          lowStockAlertEnabled: true,
        },
        syncDefaults: { batchSize: 25, maxRetryAttempts: 15, retryDelaysSeconds: [60] },
      });

      await authedService.pullConfiguration();

      // buildAuthHeaders should return Authorization header with the token
      expect(authedHttp.get).toHaveBeenCalledWith(
        expect.stringContaining("/configuration/pos-settings"),
        { Authorization: "Bearer test-token" },
      );

      vi.unstubAllGlobals();
    });
  });

  describe("applyConfiguration", () => {
    const discountLimits = {
      owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
      manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
      cashier: { itemMaxPercent: 15, globalMaxPercent: 10 },
      admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
      inventoryAssistant: { itemMaxPercent: 20, globalMaxPercent: 15 },
      accountant: { itemMaxPercent: 5, globalMaxPercent: 5 },
    };
    const alertThresholds = { expirationWarningDays: 60, lowStockAlertEnabled: true };
    const syncDefaults = { batchSize: 25, maxRetryAttempts: 15, retryDelaysSeconds: [60] };

    // Regression: a config pull from a server without tenant context used to
    // reset the locally configured company back to the placeholder, wiping
    // the issuer data after every sync.
    it("preserves the local seller info when the payload omits it", async () => {
      useLocalConfigStore.getState().updateSellerInfo({
        nit: "900.123.456",
        name: "FARMACIA LOS ANDES S.A.S.",
        resolutionPrefix: "FE",
      });

      await service.applyConfiguration({
        paymentMethods: [],
        discountLimits,
        alertThresholds,
        syncDefaults,
        // no sellerInfo key
      });

      const seller = useLocalConfigStore.getState().sellerInfo;
      expect(seller.nit).toBe("900.123.456");
      expect(seller.name).toBe("FARMACIA LOS ANDES S.A.S.");
      expect(seller.resolutionPrefix).toBe("FE");
    });

    it("updates the local seller info when the payload includes it", async () => {
      useLocalConfigStore.getState().updateSellerInfo({
        nit: "000.000.000-0",
        name: "Farmacia",
      });

      await service.applyConfiguration({
        paymentMethods: [],
        discountLimits,
        alertThresholds,
        syncDefaults,
        sellerInfo: {
          nit: "901.234.567-8",
          name: "DROGUERÍA LA ESPERANZA",
          address: "CL 10 # 5-20",
          phone: "601 234 5678",
          resolutionNumber: "18760000009999",
          resolutionDate: "2026-03-01",
          resolutionPrefix: "SE",
        },
      });

      const seller = useLocalConfigStore.getState().sellerInfo;
      expect(seller.nit).toBe("901.234.567-8");
      expect(seller.name).toBe("DROGUERÍA LA ESPERANZA");
      expect(seller.address).toBe("CL 10 # 5-20");
      expect(seller.resolutionPrefix).toBe("SE");
    });

    it("calls syncFromResolution with the ACTIVE resolution range and server consecutive", async () => {
      const syncFromResolution = vi.fn().mockResolvedValue({ changed: true });
      const numberingService = {
        syncFromResolution,
      } as unknown as FiscalNumberingService;
      const svc = createConfigSyncService(prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
        numberingService,
      });

      await svc.applyConfiguration({
        paymentMethods: [],
        discountLimits,
        alertThresholds,
        syncDefaults,
        resolution: makeResolutionPayload(),
      });

      expect(syncFromResolution).toHaveBeenCalledWith({
        prefix: "FE",
        authorizedStart: 1000,
        authorizedEnd: 1999,
        nextRegularNumber: 1005,
      });
    });

    it("calls syncFromResolution when the resolution is EXPIRING", async () => {
      const syncFromResolution = vi.fn().mockResolvedValue({ changed: true });
      const numberingService = {
        syncFromResolution,
      } as unknown as FiscalNumberingService;
      const svc = createConfigSyncService(prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
        numberingService,
      });

      await svc.applyConfiguration({
        paymentMethods: [],
        discountLimits,
        alertThresholds,
        syncDefaults,
        resolution: makeResolutionPayload({ state: "EXPIRING" }),
      });

      expect(syncFromResolution).toHaveBeenCalledTimes(1);
    });

    it.each([
      { state: "EXHAUSTED" },
      { state: "EXPIRED" },
      { state: null },
    ])("skips the counter sync when the resolution state is $state", async ({ state }) => {
      const syncFromResolution = vi.fn().mockResolvedValue({ changed: true });
      const numberingService = {
        syncFromResolution,
      } as unknown as FiscalNumberingService;
      const svc = createConfigSyncService(prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
        numberingService,
      });

      await svc.applyConfiguration({
        paymentMethods: [],
        discountLimits,
        alertThresholds,
        syncDefaults,
        resolution: makeResolutionPayload({ state: state as PosResolutionPayload["state"] }),
      });

      expect(syncFromResolution).not.toHaveBeenCalled();
    });

    it("skips the counter sync when the payload has no resolution", async () => {
      const syncFromResolution = vi.fn().mockResolvedValue({ changed: true });
      const numberingService = {
        syncFromResolution,
      } as unknown as FiscalNumberingService;
      const svc = createConfigSyncService(prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
        numberingService,
      });

      await svc.applyConfiguration({
        paymentMethods: [],
        discountLimits,
        alertThresholds,
        syncDefaults,
      });

      expect(syncFromResolution).not.toHaveBeenCalled();
    });

    it("keeps applying the configuration when the counter sync throws", async () => {
      const syncFromResolution = vi
        .fn()
        .mockRejectedValue(new Error("counter lock"));
      const numberingService = {
        syncFromResolution,
      } as unknown as FiscalNumberingService;
      const svc = createConfigSyncService(prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
        numberingService,
      });

      await expect(
        svc.applyConfiguration({
          paymentMethods: [],
          discountLimits,
          alertThresholds,
          syncDefaults,
          sellerInfo: {
            nit: "901.234.567-8",
            name: "DROGUERÍA LA ESPERANZA",
            address: null,
            phone: null,
            resolutionNumber: null,
            resolutionDate: null,
            resolutionPrefix: "SE",
          },
          resolution: makeResolutionPayload(),
        }),
      ).resolves.toBeUndefined();

      expect(useLocalConfigStore.getState().sellerInfo.nit).toBe(
        "901.234.567-8",
      );
    });

    it("ignores the resolution when no numbering service is injected", async () => {
      await expect(
        service.applyConfiguration({
          paymentMethods: [],
          discountLimits,
          alertThresholds,
          syncDefaults,
          resolution: makeResolutionPayload(),
        }),
      ).resolves.toBeUndefined();
    });

    // Step 4 of applyConfiguration: when the tenant has no resolution yet,
    // ask the server to fetch the numbering range from DIAN — once per
    // 24h cooldown window, persisted in localStorage.
    describe("DIAN range auto-sync", () => {
      // Mirrors the private DIAN_RESOLUTION_SYNC_STORAGE_KEY constant in
      // config-sync.service.ts (not exported).
      const DIAN_SYNC_STORAGE_KEY = "pharmacy_dian_resolution_sync_last_attempt";
      const DAY_MS = 24 * 60 * 60 * 1000;

      const makeAuthedService = (): ConfigSyncService =>
        createConfigSyncService(prisma, {
          baseUrl: "http://localhost:3000",
          httpClient: http,
          accessToken: "tok-dian",
        });

      const basePayload = () => ({
        paymentMethods: [],
        discountLimits,
        alertThresholds,
        syncDefaults,
      });

      beforeEach(() => {
        localStorage.clear();
      });

      it("posts sync-from-dian with the bearer token when the payload has no resolution", async () => {
        const svc = makeAuthedService();

        await svc.applyConfiguration(basePayload());

        expect(http.post).toHaveBeenCalledTimes(1);
        expect(http.post).toHaveBeenCalledWith(
          "http://localhost:3000/fiscal-dian/resolutions/sync-from-dian",
          {},
          { Authorization: "Bearer tok-dian" },
        );
      });

      it("does not post again on a second pull within the cooldown window", async () => {
        const svc = makeAuthedService();

        await svc.applyConfiguration(basePayload());
        await svc.applyConfiguration(basePayload());

        expect(http.post).toHaveBeenCalledTimes(1);
      });

      it("posts again once the last attempt is older than the cooldown", async () => {
        localStorage.setItem(
          DIAN_SYNC_STORAGE_KEY,
          String(Date.now() - DAY_MS - 1),
        );
        const svc = makeAuthedService();

        await svc.applyConfiguration(basePayload());

        expect(http.post).toHaveBeenCalledTimes(1);
      });

      it("does not post when the payload carries a resolution", async () => {
        const svc = makeAuthedService();

        await svc.applyConfiguration({
          ...basePayload(),
          resolution: makeResolutionPayload(),
        });

        expect(http.post).not.toHaveBeenCalled();
      });

      it("does not post without an access token", async () => {
        await service.applyConfiguration(basePayload());

        expect(http.post).not.toHaveBeenCalled();
      });

      it("still resolves the apply when the sync-from-dian request rejects", async () => {
        // The factory always defines post; SyncHttpClient types it optional.
        vi.mocked(http.post!).mockRejectedValue(new Error("dian unreachable"));
        const svc = makeAuthedService();

        await expect(svc.applyConfiguration(basePayload())).resolves.toBeUndefined();

        expect(useLocalConfigStore.getState().syncDefaults.batchSize).toBe(25);
      });
    });

    // Step 5 of applyConfiguration: mirror the tenant's certificate status
    // into the company store so the habilitation checklist detects that
    // step automatically (the owner never marks it by hand).
    describe("certificate status mirroring", () => {
      const basePayload = () => ({
        paymentMethods: [],
        discountLimits,
        alertThresholds,
        syncDefaults,
      });

      beforeEach(() => {
        localStorage.clear();
        useCompanySetupStore.getState().reset();
      });

      it("marks the certificate active when the payload reports ACTIVE", async () => {
        await service.applyConfiguration({
          ...basePayload(),
          certificateStatus: "ACTIVE",
        });

        expect(useCompanySetupStore.getState().certificateActive).toBe(true);
      });

      it("marks the certificate inactive when the payload reports NONE", async () => {
        await service.applyConfiguration({
          ...basePayload(),
          certificateStatus: "NONE",
        });

        expect(useCompanySetupStore.getState().certificateActive).toBe(false);
      });

      it("leaves the mirrored status untouched when the payload omits it", async () => {
        useCompanySetupStore.getState().setCertificateActive(true);

        await service.applyConfiguration(basePayload());

        expect(useCompanySetupStore.getState().certificateActive).toBe(true);
      });
    });
  });

  describe("defaultHttpClient (without mock)", () => {
    beforeEach(() => {
      vi.stubGlobal("navigator", { onLine: true });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("uses the built-in fetch and returns parsed JSON on success", async () => {
      const fakePayload = {
        paymentMethods: [],
        discountLimits: {
          owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
          manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
          cashier: { itemMaxPercent: 15, globalMaxPercent: 10 },
          admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
          inventoryAssistant: { itemMaxPercent: 20, globalMaxPercent: 15 },
          accountant: { itemMaxPercent: 5, globalMaxPercent: 5 },
        },
        salesConfig: {
          priceOverridePermissions: {
            manager: { allowed: true, requireReason: true },
            cashier: { allowed: false, requireReason: true },
            inventoryAssistant: { allowed: false, requireReason: true },
            accountant: { allowed: false, requireReason: true },
          },
          priceFloor: { enabled: true, type: "COST", minMarginPercent: 0 },
        },
        alertThresholds: { expirationWarningDays: 60, lowStockAlertEnabled: true },
        syncDefaults: { batchSize: 25, maxRetryAttempts: 15, retryDelaysSeconds: [60] },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(fakePayload), { status: 200 }),
      );

      const mocks = makeMockPrisma();
      // No httpClient provided — the service will use defaultHttpClient
      const svc = createConfigSyncService(mocks.prisma, {
        baseUrl: "http://localhost:3000",
      });

      await svc.pullConfiguration();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/configuration/pos-settings"),
        expect.objectContaining({ headers: {} }),
      );
    });

    it("throws ConfigSyncHttpError when defaultHttpClient receives a non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Server Error", { status: 500, statusText: "Internal Server Error" }),
      );

      const mocks = makeMockPrisma();
      const svc = createConfigSyncService(mocks.prisma, {
        baseUrl: "http://localhost:3000",
      });

      await expect(svc.pullConfiguration()).rejects.toThrow(ConfigSyncHttpError);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
