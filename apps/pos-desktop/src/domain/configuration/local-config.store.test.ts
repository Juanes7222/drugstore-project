/**
 * Unit tests for the local configuration Zustand store.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useLocalConfigStore, type HydratePayload } from "./local-config.store";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LocalConfigStore", () => {
  beforeEach(() => {
    useLocalConfigStore.setState({
      discountLimits: {
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
  });

  describe("hydrateFromServer", () => {
    it("replaces all state with provided payload", () => {
      const payload: HydratePayload = {
        discountLimits: {
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
});
