import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LicenseStatus } from "@pharmacy/shared-types";
import { useLicenseStore } from "./license.store";
import type { LicenseService } from "./license.service";
import { LicenseCheckInScheduler } from "./license-check-in-scheduler";

describe("LicenseCheckInScheduler", () => {
  let mockLicenseService: LicenseService;
  let scheduler: LicenseCheckInScheduler;

  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.getState().reset();
    vi.useFakeTimers();

    mockLicenseService = {
      checkIn: vi.fn(),
      activate: vi.fn(),
      getStatus: vi.fn(),
      getSummary: vi.fn(),
      refreshStatus: vi.fn(),
      requireValidLicense: vi.fn(),
      validateTokenLocally: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // start
  // -----------------------------------------------------------------------

  describe("start", () => {
    it("does not start when the license status is UNACTIVATED", () => {
      scheduler = new LicenseCheckInScheduler({
        licenseService: mockLicenseService,
        intervalMs: 60_000,
      });

      scheduler.start();

      expect(mockLicenseService.checkIn).not.toHaveBeenCalled();
    });

    it("does not start when the license status is LOCKED", () => {
      useLicenseStore.getState().setLocked();

      scheduler = new LicenseCheckInScheduler({
        licenseService: mockLicenseService,
        intervalMs: 60_000,
      });

      scheduler.start();

      expect(mockLicenseService.checkIn).not.toHaveBeenCalled();
    });

    it("fires an immediate check-in when status is ACTIVE", () => {
      useLicenseStore.getState().setActivated({
        activationToken: "token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        plan: { id: "p-1", code: "BASIC", name: "Basic", features: [], maxLocations: 1, maxWorkstationsPerLocation: 1 },
        location: null,
        workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-01T00:00:00.000Z" },
        hardwareFingerprint: "fp-001",
      });

      scheduler = new LicenseCheckInScheduler({
        licenseService: mockLicenseService,
        intervalMs: 60_000,
      });

      scheduler.start();

      expect(mockLicenseService.checkIn).toHaveBeenCalledTimes(1);
    });

    it("sets up an interval that fires subsequent check-ins", () => {
      useLicenseStore.getState().setActivated({
        activationToken: "token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        plan: { id: "p-1", code: "BASIC", name: "Basic", features: [], maxLocations: 1, maxWorkstationsPerLocation: 1 },
        location: null,
        workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-01T00:00:00.000Z" },
        hardwareFingerprint: "fp-001",
      });

      scheduler = new LicenseCheckInScheduler({
        licenseService: mockLicenseService,
        intervalMs: 60_000,
      });

      scheduler.start();
      expect(mockLicenseService.checkIn).toHaveBeenCalledTimes(1);

      // Advance past the interval
      vi.advanceTimersByTime(60_000);
      expect(mockLicenseService.checkIn).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(60_000);
      expect(mockLicenseService.checkIn).toHaveBeenCalledTimes(3);
    });

    it("is safe to call start multiple times (no duplicate intervals)", () => {
      useLicenseStore.getState().setActivated({
        activationToken: "token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        plan: { id: "p-1", code: "BASIC", name: "Basic", features: [], maxLocations: 1, maxWorkstationsPerLocation: 1 },
        location: null,
        workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-01T00:00:00.000Z" },
        hardwareFingerprint: "fp-001",
      });

      scheduler = new LicenseCheckInScheduler({
        licenseService: mockLicenseService,
        intervalMs: 60_000,
      });

      scheduler.start();
      scheduler.start();
      scheduler.start();

      vi.advanceTimersByTime(60_000);
      // Should only have the initial call + one interval call = 2
      expect(mockLicenseService.checkIn).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // stop
  // -----------------------------------------------------------------------

  describe("stop", () => {
    it("stops the interval from firing further check-ins", () => {
      useLicenseStore.getState().setActivated({
        activationToken: "token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        plan: { id: "p-1", code: "BASIC", name: "Basic", features: [], maxLocations: 1, maxWorkstationsPerLocation: 1 },
        location: null,
        workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-01T00:00:00.000Z" },
        hardwareFingerprint: "fp-001",
      });

      scheduler = new LicenseCheckInScheduler({
        licenseService: mockLicenseService,
        intervalMs: 60_000,
      });

      scheduler.start();
      expect(mockLicenseService.checkIn).toHaveBeenCalledTimes(1);

      scheduler.stop();
      vi.advanceTimersByTime(60_000);

      // Still 1 — interval was cleared
      expect(mockLicenseService.checkIn).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // checkInNow
  // -----------------------------------------------------------------------

  describe("checkInNow", () => {
    it("fires an immediate check-in and returns", async () => {
      scheduler = new LicenseCheckInScheduler({
        licenseService: mockLicenseService,
        intervalMs: 60_000,
      });

      await scheduler.checkInNow();

      expect(mockLicenseService.checkIn).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // tick — LOCKED and REVOKED handling
  // -----------------------------------------------------------------------

  describe("tick — status transitions", () => {
    it("sets the store to LOCKED when check-in returns LOCKED status", async () => {
      useLicenseStore.getState().setActivated({
        activationToken: "token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        plan: { id: "p-1", code: "BASIC", name: "Basic", features: [], maxLocations: 1, maxWorkstationsPerLocation: 1 },
        location: null,
        workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-01T00:00:00.000Z" },
        hardwareFingerprint: "fp-001",
      });

      (mockLicenseService.checkIn as ReturnType<typeof vi.fn>).mockResolvedValue({
        activationToken: "new-token",
        expiresAt: "2027-06-01T00:00:00.000Z",
        licenseStatus: "LOCKED",
        subscription: { id: "s-1", status: "SUSPENDED", currentPeriodEnd: "2027-06-01T00:00:00.000Z", gracePeriodDays: 0 },
        daysUntilGracePeriodEnd: 0,
      });

      scheduler = new LicenseCheckInScheduler({
        licenseService: mockLicenseService,
      });

      // Trigger the private tick through checkInNow
      await scheduler.checkInNow();

      const state = useLicenseStore.getState();
      expect(state.status).toBe(LicenseStatus.LOCKED);
    });

    it("sets the store to REVOKED when check-in returns REVOKED status", async () => {
      useLicenseStore.getState().setActivated({
        activationToken: "token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        plan: { id: "p-1", code: "BASIC", name: "Basic", features: [], maxLocations: 1, maxWorkstationsPerLocation: 1 },
        location: null,
        workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-01T00:00:00.000Z" },
        hardwareFingerprint: "fp-001",
      });

      (mockLicenseService.checkIn as ReturnType<typeof vi.fn>).mockResolvedValue({
        activationToken: "new-token",
        expiresAt: "2027-06-01T00:00:00.000Z",
        licenseStatus: "REVOKED",
        subscription: { id: "s-1", status: "REVOKED", currentPeriodEnd: "2027-06-01T00:00:00.000Z", gracePeriodDays: 0 },
        daysUntilGracePeriodEnd: null,
      });

      scheduler = new LicenseCheckInScheduler({
        licenseService: mockLicenseService,
      });

      await scheduler.checkInNow();

      const state = useLicenseStore.getState();
      expect(state.status).toBe(LicenseStatus.REVOKED);
    });

    it("does not change status on a successful ACTIVE check-in", async () => {
      useLicenseStore.getState().setActivated({
        activationToken: "token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        plan: { id: "p-1", code: "BASIC", name: "Basic", features: [], maxLocations: 1, maxWorkstationsPerLocation: 1 },
        location: null,
        workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-01T00:00:00.000Z" },
        hardwareFingerprint: "fp-001",
      });

      (mockLicenseService.checkIn as ReturnType<typeof vi.fn>).mockResolvedValue({
        activationToken: "refreshed-token",
        expiresAt: "2027-06-01T00:00:00.000Z",
        licenseStatus: "ACTIVE",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-06-01T00:00:00.000Z", gracePeriodDays: 7 },
        daysUntilGracePeriodEnd: null,
      });

      scheduler = new LicenseCheckInScheduler({
        licenseService: mockLicenseService,
      });

      await scheduler.checkInNow();

      const state = useLicenseStore.getState();
      expect(state.status).toBe(LicenseStatus.ACTIVE);
    });

    it("silently handles a check-in error", async () => {
      useLicenseStore.getState().setActivated({
        activationToken: "token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        plan: { id: "p-1", code: "BASIC", name: "Basic", features: [], maxLocations: 1, maxWorkstationsPerLocation: 1 },
        location: null,
        workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-01T00:00:00.000Z" },
        hardwareFingerprint: "fp-001",
      });

      (mockLicenseService.checkIn as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network error"),
      );

      scheduler = new LicenseCheckInScheduler({
        licenseService: mockLicenseService,
      });

      await expect(scheduler.checkInNow()).resolves.toBeUndefined();

      // Status should remain unchanged
      const state = useLicenseStore.getState();
      expect(state.status).toBe(LicenseStatus.ACTIVE);
    });
  });
});
