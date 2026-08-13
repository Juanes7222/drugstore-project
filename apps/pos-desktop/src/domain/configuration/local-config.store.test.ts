/**
 * Unit tests for the local configuration Zustand store.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  useLocalConfigStore,
  getLocalConfigState,
  mergePersistedConfig,
  DEFAULT_CREDIT_LIMIT_CENTS,
  type HydratePayload,
} from "./local-config.store";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LocalConfigStore", () => {
  beforeEach(() => {
    useLocalConfigStore.setState({
      discountLimits: {
        owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
        manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
        cashier: { itemMaxPercent: 10, globalMaxPercent: 5 },
        admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
        inventoryAssistant: { itemMaxPercent: 15, globalMaxPercent: 10 },
        accountant: { itemMaxPercent: 0, globalMaxPercent: 0 },
      },
      alertThresholds: {
        expirationWarningDays: 30,
        lowStockAlertEnabled: true,
      },
      syncDefaults: {
        batchSize: 10,
        maxRetryAttempts: 10,
        retryDelaysSeconds: [30, 120, 300, 600, 1800],
      },
      lastSyncedAt: null,
    });
  });

  describe("initial state", () => {
    it("has safe default discount limits", () => {
      const state = useLocalConfigStore.getState();
      expect(state.discountLimits.cashier.itemMaxPercent).toBe(10);
      expect(state.discountLimits.admin.itemMaxPercent).toBe(100);
    });

    it("has default alert thresholds", () => {
      const state = useLocalConfigStore.getState();
      expect(state.alertThresholds.expirationWarningDays).toBe(30);
      expect(state.alertThresholds.lowStockAlertEnabled).toBe(true);
    });

    it("has default sync defaults", () => {
      const state = useLocalConfigStore.getState();
      expect(state.syncDefaults.batchSize).toBe(10);
      expect(state.syncDefaults.maxRetryAttempts).toBe(10);
    });

    it("has lastSyncedAt as null initially", () => {
      const state = useLocalConfigStore.getState();
      expect(state.lastSyncedAt).toBeNull();
    });

    it("has store credit disabled by default with a positive default limit", () => {
      const state = useLocalConfigStore.getState();
      expect(state.salesConfig.creditEnabled).toBe(false);
      expect(state.salesConfig.defaultCreditLimitCents).toBe(
        DEFAULT_CREDIT_LIMIT_CENTS,
      );
    });
  });

  describe("getLocalConfigState", () => {
    it("returns the current store state", () => {
      const state = getLocalConfigState();

      expect(state).toHaveProperty("discountLimits");
      expect(state).toHaveProperty("alertThresholds");
      expect(state).toHaveProperty("syncDefaults");
      expect(state.lastSyncedAt).toBeNull();
    });
  });

  describe("hydrateFromServer", () => {
    it("replaces all state with provided payload", () => {
      const payload: HydratePayload = {
        discountLimits: {
          owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
          manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
          cashier: { itemMaxPercent: 15, globalMaxPercent: 10 },
          admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
          inventoryAssistant: { itemMaxPercent: 20, globalMaxPercent: 15 },
          accountant: { itemMaxPercent: 5, globalMaxPercent: 5 },
        },
        alertThresholds: {
          expirationWarningDays: 45,
          lowStockAlertEnabled: false,
        },
        syncDefaults: {
          batchSize: 25,
          maxRetryAttempts: 15,
          retryDelaysSeconds: [60, 300, 600],
        },
      };

      useLocalConfigStore.getState().hydrateFromServer(payload);

      const state = useLocalConfigStore.getState();
      expect(state.discountLimits.cashier.itemMaxPercent).toBe(15);
      expect(state.alertThresholds.expirationWarningDays).toBe(45);
      expect(state.syncDefaults.batchSize).toBe(25);
      expect(state.lastSyncedAt).not.toBeNull();
    });
  });

  describe("credit policy", () => {
    it("updateSalesConfig merges the creditEnabled flag", () => {
      useLocalConfigStore.getState().updateSalesConfig({ creditEnabled: true });

      const state = useLocalConfigStore.getState();
      expect(state.salesConfig.creditEnabled).toBe(true);
      // Other blocks are untouched.
      expect(state.salesConfig.defaultCreditLimitCents).toBe(
        DEFAULT_CREDIT_LIMIT_CENTS,
      );
    });

    it("updateSalesConfig keeps the previous creditEnabled when not provided", () => {
      useLocalConfigStore.getState().updateSalesConfig({ creditEnabled: true });
      useLocalConfigStore
        .getState()
        .updateSalesConfig({ defaultCreditLimitCents: 25_000_000 });

      const state = useLocalConfigStore.getState();
      expect(state.salesConfig.creditEnabled).toBe(true);
      expect(state.salesConfig.defaultCreditLimitCents).toBe(25_000_000);
    });

    it("mergePersistedConfig migrates a legacy positive default limit to creditEnabled=true", () => {
      const legacy = {
        salesConfig: {
          priceOverridePermissions: {
            manager: { allowed: true, requireReason: true },
            cashier: { allowed: false, requireReason: true },
            inventoryAssistant: { allowed: false, requireReason: true },
            accountant: { allowed: false, requireReason: true },
          },
          priceFloor: { enabled: true, type: "COST" as const, minMarginPercent: 0 },
          defaultCreditLimitCents: 50_000_000,
        },
      };

      const merged = mergePersistedConfig(legacy, useLocalConfigStore.getState());

      expect(merged.salesConfig.creditEnabled).toBe(true);
      expect(merged.salesConfig.defaultCreditLimitCents).toBe(50_000_000);
    });

    it("mergePersistedConfig keeps an explicit persisted creditEnabled=false", () => {
      const legacy = {
        salesConfig: {
          priceOverridePermissions: {
            manager: { allowed: true, requireReason: true },
            cashier: { allowed: false, requireReason: true },
            inventoryAssistant: { allowed: false, requireReason: true },
            accountant: { allowed: false, requireReason: true },
          },
          priceFloor: { enabled: true, type: "COST" as const, minMarginPercent: 0 },
          defaultCreditLimitCents: 50_000_000,
          creditEnabled: false,
        },
      };

      const merged = mergePersistedConfig(legacy, useLocalConfigStore.getState());

      expect(merged.salesConfig.creditEnabled).toBe(false);
      expect(merged.salesConfig.defaultCreditLimitCents).toBe(50_000_000);
    });
  });
});
