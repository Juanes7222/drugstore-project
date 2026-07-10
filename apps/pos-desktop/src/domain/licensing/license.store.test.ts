import { describe, expect, it, beforeEach } from "vitest";
import { LicenseStatus } from "@pharmacy/shared-types";
import { useLicenseStore } from "./license.store";

const defaultState = {
  status: LicenseStatus.UNACTIVATED,
  activationToken: null,
  tokenExpiresAt: null,
  subscriptionId: null,
  subscriptionStatus: null,
  planId: null,
  planCode: null,
  planName: null,
  planFeatures: [] as string[],
  maxLocations: null,
  maxWorkstationsPerLocation: null,
  locationId: null,
  locationName: null,
  locationAddress: null,
  locationCity: null,
  locationRegion: null,
  workstationId: null,
  workstationName: null,
  hardwareFingerprint: null,
  activatedAt: null,
  lastCheckInAt: null,
  nextCheckInDue: null,
  daysUntilGracePeriodEnd: null,
  daysUntilExpiry: null,
  checkInsLast30Days: 0,
};

const testSubscription = {
  id: "sub-1",
  status: "ACTIVE",
  currentPeriodEnd: "2027-01-01T00:00:00.000Z",
  gracePeriodDays: 7,
};

const testLocation = {
  id: "loc-1",
  name: "Farmacia Central",
  address: "Av. Siempre Viva 123",
  city: "Buenos Aires",
  region: "CABA",
};

const testPlan = {
  id: "plan-1",
  code: "PREMIUM",
  name: "Premium",
  features: ["MULTI_LOCATION", "ADVANCED_REPORTS"],
  maxLocations: 5,
  maxWorkstationsPerLocation: 3,
};

const testWorkstationActivation = {
  id: "ws-1",
  workstationName: "Caja-01",
  activatedAt: "2026-01-15T10:00:00.000Z",
};

describe("useLicenseStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.getState().reset();
  });

  describe("initial state", () => {
    it("starts as UNACTIVATED", () => {
      const state = useLicenseStore.getState();
      expect(state.status).toBe(LicenseStatus.UNACTIVATED);
    });

    it("has null activationToken", () => {
      const state = useLicenseStore.getState();
      expect(state.activationToken).toBeNull();
    });

    it("has zero checkInsLast30Days", () => {
      const state = useLicenseStore.getState();
      expect(state.checkInsLast30Days).toBe(0);
    });
  });

  describe("setActivated", () => {
    it("transitions to ACTIVE status", () => {
      const store = useLicenseStore.getState();
      store.setActivated({
        activationToken: "token-abc",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        location: testLocation,
        plan: testPlan,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      const state = useLicenseStore.getState();
      expect(state.status).toBe(LicenseStatus.ACTIVE);
    });

    it("stores the activation token", () => {
      const store = useLicenseStore.getState();
      store.setActivated({
        activationToken: "token-abc",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        location: testLocation,
        plan: testPlan,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      expect(useLicenseStore.getState().activationToken).toBe("token-abc");
    });

    it("stores subscription and plan details", () => {
      const store = useLicenseStore.getState();
      store.setActivated({
        activationToken: "token-abc",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        location: testLocation,
        plan: testPlan,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      const state = useLicenseStore.getState();
      expect(state.subscriptionId).toBe("sub-1");
      expect(state.planId).toBe("plan-1");
      expect(state.planName).toBe("Premium");
      expect(state.planFeatures).toEqual(["MULTI_LOCATION", "ADVANCED_REPORTS"]);
    });

    it("stores location details", () => {
      const store = useLicenseStore.getState();
      store.setActivated({
        activationToken: "token-abc",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        location: testLocation,
        plan: testPlan,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      const state = useLicenseStore.getState();
      expect(state.locationId).toBe("loc-1");
      expect(state.locationName).toBe("Farmacia Central");
      expect(state.locationAddress).toBe("Av. Siempre Viva 123");
    });

    it("stores workstation and hardware fingerprint", () => {
      const store = useLicenseStore.getState();
      store.setActivated({
        activationToken: "token-abc",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      const state = useLicenseStore.getState();
      expect(state.workstationId).toBe("ws-1");
      expect(state.workstationName).toBe("Caja-01");
      expect(state.hardwareFingerprint).toBe("fp-001");
    });

    it("computes daysUntilExpiry from expiresAt", () => {
      const store = useLicenseStore.getState();
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      store.setActivated({
        activationToken: "token-abc",
        expiresAt: futureDate.toISOString(),
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      const state = useLicenseStore.getState();
      expect(state.daysUntilExpiry).toBe(30);
    });

    it("handles null location gracefully", () => {
      const store = useLicenseStore.getState();
      store.setActivated({
        activationToken: "token-abc",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: null,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      const state = useLicenseStore.getState();
      expect(state.locationId).toBeNull();
      expect(state.locationName).toBeNull();
    });
  });

  describe("setCheckInResult", () => {
    it("updates the token and expiry", () => {
      useLicenseStore.getState().setActivated({
        activationToken: "old-token",
        expiresAt: "2026-06-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      useLicenseStore.getState().setCheckInResult({
        activationToken: "new-token",
        expiresAt: "2027-06-01T00:00:00.000Z",
        licenseStatus: "ACTIVE",
        subscription: { id: "sub-1", status: "ACTIVE", currentPeriodEnd: "2027-06-01T00:00:00.000Z", gracePeriodDays: 7 },
        daysUntilGracePeriodEnd: null,
      });

      const state = useLicenseStore.getState();
      expect(state.activationToken).toBe("new-token");
      expect(state.subscriptionStatus).toBe("ACTIVE");
    });

    it("increments checkInsLast30Days", () => {
      useLicenseStore.getState().setActivated({
        activationToken: "token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      expect(useLicenseStore.getState().checkInsLast30Days).toBe(0);

      useLicenseStore.getState().setCheckInResult({
        activationToken: "new-token",
        expiresAt: "2027-06-01T00:00:00.000Z",
        licenseStatus: "ACTIVE",
        subscription: { id: "sub-1", status: "ACTIVE", currentPeriodEnd: "2027-06-01T00:00:00.000Z", gracePeriodDays: 7 },
        daysUntilGracePeriodEnd: null,
      });

      expect(useLicenseStore.getState().checkInsLast30Days).toBe(1);
    });
  });

  describe("setGracePeriod", () => {
    it("sets status to GRACE_PERIOD with the given days", () => {
      useLicenseStore.getState().setGracePeriod(5);

      const state = useLicenseStore.getState();
      expect(state.status).toBe(LicenseStatus.GRACE_PERIOD);
      expect(state.daysUntilGracePeriodEnd).toBe(5);
    });
  });

  describe("setLocked", () => {
    it("sets status to LOCKED and resets counters", () => {
      useLicenseStore.getState().setLocked();

      const state = useLicenseStore.getState();
      expect(state.status).toBe(LicenseStatus.LOCKED);
      expect(state.daysUntilGracePeriodEnd).toBe(0);
      expect(state.daysUntilExpiry).toBe(0);
    });
  });

  describe("setRevoked", () => {
    it("sets status to REVOKED and clears tokens", () => {
      useLicenseStore.getState().setActivated({
        activationToken: "token-abc",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      useLicenseStore.getState().setRevoked();

      const state = useLicenseStore.getState();
      expect(state.status).toBe(LicenseStatus.REVOKED);
      expect(state.activationToken).toBeNull();
      expect(state.tokenExpiresAt).toBeNull();
    });
  });

  describe("setCheckInTimestamp", () => {
    it("updates lastCheckInAt to the current time", () => {
      const before = new Date().toISOString();
      useLicenseStore.getState().setCheckInTimestamp();
      const after = useLicenseStore.getState().lastCheckInAt;

      expect(after).not.toBeNull();
      expect(after! >= before).toBe(true);
    });
  });

  describe("updateCheckInCount", () => {
    it("sets checkInsLast30Days to the given count", () => {
      useLicenseStore.getState().updateCheckInCount(42);
      expect(useLicenseStore.getState().checkInsLast30Days).toBe(42);
    });
  });

  describe("reset", () => {
    it("returns to UNACTIVATED initial state", () => {
      useLicenseStore.getState().setActivated({
        activationToken: "token-abc",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      expect(useLicenseStore.getState().status).toBe(LicenseStatus.ACTIVE);

      useLicenseStore.getState().reset();

      // Every field should match the initial default value
      const state = useLicenseStore.getState();
      expect(state.status).toBe(defaultState.status);
      expect(state.activationToken).toBe(defaultState.activationToken);
      expect(state.tokenExpiresAt).toBe(defaultState.tokenExpiresAt);
      expect(state.subscriptionId).toBe(defaultState.subscriptionId);
      expect(state.subscriptionStatus).toBe(defaultState.subscriptionStatus);
      expect(state.planId).toBe(defaultState.planId);
      expect(state.planCode).toBe(defaultState.planCode);
      expect(state.planName).toBe(defaultState.planName);
      expect(state.planFeatures).toEqual(defaultState.planFeatures);
      expect(state.maxLocations).toBe(defaultState.maxLocations);
      expect(state.maxWorkstationsPerLocation).toBe(defaultState.maxWorkstationsPerLocation);
      expect(state.locationId).toBe(defaultState.locationId);
      expect(state.locationName).toBe(defaultState.locationName);
      expect(state.locationAddress).toBe(defaultState.locationAddress);
      expect(state.locationCity).toBe(defaultState.locationCity);
      expect(state.locationRegion).toBe(defaultState.locationRegion);
      expect(state.workstationId).toBe(defaultState.workstationId);
      expect(state.workstationName).toBe(defaultState.workstationName);
      expect(state.hardwareFingerprint).toBe(defaultState.hardwareFingerprint);
      expect(state.activatedAt).toBe(defaultState.activatedAt);
      expect(state.lastCheckInAt).toBe(defaultState.lastCheckInAt);
      expect(state.nextCheckInDue).toBe(defaultState.nextCheckInDue);
      expect(state.daysUntilGracePeriodEnd).toBe(defaultState.daysUntilGracePeriodEnd);
      expect(state.daysUntilExpiry).toBe(defaultState.daysUntilExpiry);
      expect(state.checkInsLast30Days).toBe(defaultState.checkInsLast30Days);
    });
  });

  describe("persist middleware", () => {
    it("persists the store to localStorage under pharmacy-license-store", () => {
      useLicenseStore.getState().setActivated({
        activationToken: "persisted-token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      const stored = localStorage.getItem("pharmacy-license-store");
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.state.status).toBe("ACTIVE");
      expect(parsed.state.activationToken).toBe("persisted-token");
    });
  });
});
