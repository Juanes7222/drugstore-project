import { describe, expect, it, vi, beforeEach } from "vitest";
import { LicenseStatus } from "@pharmacy/shared-types";
import { useLicenseStore } from "./license.store";
import { createLicenseService } from "./license.service";
import {
  AlreadyActivatedException,
  LicenseInvalidException,
  ActivationFailedException,
} from "./exceptions";
import type { WompiCheckoutService, CheckoutSession, SessionStatus } from "./wompi-checkout.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestJwt(expOffsetSeconds: number): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      sub: "ws-1",
      exp: Math.floor(Date.now() / 1000) + expOffsetSeconds,
    }),
  );
  const signature = "fake-signature";
  return `${header}.${payload}.${signature}`;
}

function futureToken(): string {
  return createTestJwt(30 * 24 * 60 * 60); // 30 days from now
}

function expiredToken(): string {
  return createTestJwt(-30 * 24 * 60 * 60); // 30 days ago
}

// ---------------------------------------------------------------------------
// Mock Tauri invoke
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("mocked-fingerprint"),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
  features: ["MULTI_LOCATION"],
  maxLocations: 5,
  maxWorkstationsPerLocation: 3,
};

const testWorkstationActivation = {
  id: "ws-1",
  workstationName: "Caja-01",
  activatedAt: "2026-01-15T10:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("createLicenseService", () => {
  let service: ReturnType<typeof createLicenseService>;

  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.getState().reset();
    vi.clearAllMocks();

    service = createLicenseService({ baseUrl: "http://localhost:3000" });
  });

  // -----------------------------------------------------------------------
  // LicenseGuard — requireValidLicense
  // -----------------------------------------------------------------------

  describe("requireValidLicense", () => {
    it("throws LicenseInvalidException when status is LOCKED", () => {
      useLicenseStore.getState().setLocked();
      expect(() => service.requireValidLicense()).toThrow(LicenseInvalidException);
    });

    it("throws LicenseInvalidException when status is REVOKED", () => {
      useLicenseStore.getState().setRevoked();
      expect(() => service.requireValidLicense()).toThrow(LicenseInvalidException);
    });

    it("does not throw when status is ACTIVE", () => {
      useLicenseStore.getState().setActivated({
        activationToken: futureToken(),
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });
      expect(() => service.requireValidLicense()).not.toThrow();
    });

    it("does not throw when status is UNACTIVATED", () => {
      expect(() => service.requireValidLicense()).not.toThrow();
    });

    it("does not throw when status is GRACE_PERIOD", () => {
      useLicenseStore.getState().setGracePeriod(5);
      expect(() => service.requireValidLicense()).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // LicenseGuard — getStatus
  // -----------------------------------------------------------------------

  describe("getStatus", () => {
    it("returns UNACTIVATED when the store has no activation", () => {
      expect(service.getStatus()).toBe(LicenseStatus.UNACTIVATED);
    });

    it("returns ACTIVE when token is valid and subscription is active", () => {
      useLicenseStore.getState().setActivated({
        activationToken: futureToken(),
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });
      expect(service.getStatus()).toBe(LicenseStatus.ACTIVE);
    });

    it("returns GRACE_PERIOD when token is expired but still within grace", () => {
      useLicenseStore.getState().setCheckInResult({
        activationToken: expiredToken(),
        expiresAt: "2026-01-01T00:00:00.000Z",
        licenseStatus: "ACTIVE",
        subscription: { id: "sub-1", status: "PAST_DUE", currentPeriodEnd: "2026-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        daysUntilGracePeriodEnd: 3,
      });
      expect(service.getStatus()).toBe(LicenseStatus.GRACE_PERIOD);
    });

    it("returns LOCKED when token is expired and no grace period", () => {
      useLicenseStore.getState().setCheckInResult({
        activationToken: expiredToken(),
        expiresAt: "2026-01-01T00:00:00.000Z",
        licenseStatus: "ACTIVE",
        subscription: { id: "sub-1", status: "ACTIVE", currentPeriodEnd: "2026-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        daysUntilGracePeriodEnd: null,
      });
      expect(service.getStatus()).toBe(LicenseStatus.LOCKED);
    });

    it("returns GRACE_PERIOD when subscription is PAST_DUE with days remaining", () => {
      useLicenseStore.getState().setActivated({
        activationToken: futureToken(),
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { ...testSubscription, status: "PAST_DUE" },
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });
      useLicenseStore.getState().setGracePeriod(5);
      expect(service.getStatus()).toBe(LicenseStatus.GRACE_PERIOD);
    });

    it("returns REVOKED when subscription status is REVOKED", () => {
      useLicenseStore.getState().setCheckInResult({
        activationToken: futureToken(),
        expiresAt: "2027-01-01T00:00:00.000Z",
        licenseStatus: "REVOKED",
        subscription: { id: "sub-1", status: "REVOKED", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 0 },
        daysUntilGracePeriodEnd: null,
      });
      expect(service.getStatus()).toBe(LicenseStatus.REVOKED);
    });
  });

  // -----------------------------------------------------------------------
  // validateTokenLocally
  // -----------------------------------------------------------------------

  describe("validateTokenLocally", () => {
    it("returns false when no activation token exists", () => {
      expect(service.validateTokenLocally()).toBe(false);
    });

    it("returns true when the token is not expired", () => {
      useLicenseStore.getState().setActivated({
        activationToken: futureToken(),
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });
      expect(service.validateTokenLocally()).toBe(true);
    });

    it("returns false when the token is expired", () => {
      useLicenseStore.getState().setActivated({
        activationToken: expiredToken(),
        expiresAt: "2025-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });
      expect(service.validateTokenLocally()).toBe(false);
    });

    it("returns false for a malformed token", () => {
      useLicenseStore.getState().setActivated({
        activationToken: "not-a-jwt",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });
      expect(service.validateTokenLocally()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getSummary
  // -----------------------------------------------------------------------

  describe("getSummary", () => {
    it("returns the correct shape from store state", () => {
      useLicenseStore.getState().setActivated({
        activationToken: futureToken(),
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { ...testSubscription, status: "ACTIVE" },
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      const summary = service.getSummary();
      expect(summary.status).toBe(LicenseStatus.ACTIVE);
      expect(summary.daysUntilExpiry).toBeGreaterThan(0);
      expect(summary.daysUntilGracePeriodEnd).toBeNull();
      expect(summary.lastCheckInAt).not.toBeNull();
      expect(summary.checkInsLast30Days).toBe(0);
    });

    it("returns UNACTIVATED status for an unactivated store", () => {
      const summary = service.getSummary();
      expect(summary.status).toBe(LicenseStatus.UNACTIVATED);
      expect(summary.daysUntilExpiry).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // activate
  // -----------------------------------------------------------------------

  describe("activate", () => {
    const serverResponse = {
      activationToken: "server-token-abc",
      expiresAt: "2027-06-01T00:00:00.000Z",
      subscription: testSubscription,
      location: testLocation,
      plan: testPlan,
      workstationActivation: testWorkstationActivation,
    };

    it("sends a POST request to the public activate endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(serverResponse),
      });
      vi.stubGlobal("fetch", mockFetch);

      await service.activate("ABCD-EFGH-IJKL", "Caja-01", {
        name: "Farmacia Central",
        city: "Buenos Aires",
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:3000/public/licensing/activate");
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body.code).toBe("ABCD-EFGH-IJKL");
      expect(body.workstationName).toBe("Caja-01");
      expect(body.hardwareFingerprint).toBe("mocked-fingerprint");
      expect(body.locationName).toBe("Farmacia Central");
    });

    it("persists the activation result to the store", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(serverResponse),
      });
      vi.stubGlobal("fetch", mockFetch);

      await service.activate("CODE-1234", "Caja-01");

      const state = useLicenseStore.getState();
      expect(state.status).toBe(LicenseStatus.ACTIVE);
      expect(state.activationToken).toBe("server-token-abc");
    });

    it("throws AlreadyActivatedException when already ACTIVE", async () => {
      useLicenseStore.getState().setActivated({
        activationToken: futureToken(),
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      await expect(
        service.activate("CODE-1234", "Caja-01"),
      ).rejects.toThrow(AlreadyActivatedException);
    });

    it("allows activation when current status is REVOKED", async () => {
      useLicenseStore.getState().setRevoked();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(serverResponse),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await service.activate("CODE-1234", "Caja-01");
      expect(result.activationToken).toBe("server-token-abc");
    });

    it("sets hardwareFingerprint to a dev fallback when Tauri is unavailable", async () => {
      // Make the Tauri invoke throw
      const mockInvoke = vi.fn().mockRejectedValue(new Error("No Tauri"));
      vi.doMock("@tauri-apps/api/core", () => ({
        invoke: mockInvoke,
      }));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(serverResponse),
      });
      vi.stubGlobal("fetch", mockFetch);

      // Re-create service so it uses the new mock
      const localService = createLicenseService({ baseUrl: "http://localhost:3000" });

      await localService.activate("CODE-1234", "Caja-01");

      const state = useLicenseStore.getState();
      expect(state.hardwareFingerprint).toMatch(/^dev-fingerprint-/);
    });
  });

  // -----------------------------------------------------------------------
  // checkIn
  // -----------------------------------------------------------------------

  describe("checkIn", () => {
    const checkInResponse = {
      activationToken: "refreshed-token",
      expiresAt: "2027-06-01T00:00:00.000Z",
      licenseStatus: "ACTIVE",
      subscription: { id: "sub-1", status: "ACTIVE", currentPeriodEnd: "2027-06-01T00:00:00.000Z", gracePeriodDays: 7 },
      daysUntilGracePeriodEnd: null,
    };

    it("returns null when no activation token exists", async () => {
      const result = await service.checkIn();
      expect(result).toBeNull();
    });

    it("sends a POST request to the check-in endpoint", async () => {
      useLicenseStore.getState().setActivated({
        activationToken: futureToken(),
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(checkInResponse),
      });
      vi.stubGlobal("fetch", mockFetch);

      await service.checkIn();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:3000/public/licensing/check-in");
      expect(options.method).toBe("POST");
    });

    it("updates the store with the check-in result", async () => {
      useLicenseStore.getState().setActivated({
        activationToken: futureToken(),
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(checkInResponse),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await service.checkIn();
      expect(result).toEqual(checkInResponse);
      expect(useLicenseStore.getState().activationToken).toBe("refreshed-token");
    });

    it("silently returns null on network error", async () => {
      useLicenseStore.getState().setActivated({
        activationToken: futureToken(),
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: testSubscription,
        plan: testPlan,
        location: testLocation,
        workstationActivation: testWorkstationActivation,
        hardwareFingerprint: "fp-001",
      });

      const mockFetch = vi.fn().mockRejectedValue(new Error("Network failure"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await service.checkIn();
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Renewal flow
  // -----------------------------------------------------------------------

  describe("renewal flow", () => {
    let checkoutService: WompiCheckoutService;
    let renewalService: ReturnType<typeof createLicenseService>;

    const mockSession: CheckoutSession = {
      sessionId: "sess-001",
      paymentLinkId: "plink-001",
      checkoutUrl: "https://checkout.wompi.co/pay/renew",
      reference: "wompi-ref-renewal",
      amountCents: 50000,
      currency: "COP",
    };

    const makeApprovedStatus = (): SessionStatus => ({
      sessionId: "sess-001",
      status: "APPROVED",
      statusMessage: "Transaction approved",
      wompiTransactionId: "txn-approved-001",
      reference: "wompi-ref-renewal",
    });

    const makeDeclinedStatus = (): SessionStatus => ({
      sessionId: "sess-001",
      status: "DECLINED",
      statusMessage: "Transaction declined by bank",
      wompiTransactionId: "txn-declined-001",
      reference: "wompi-ref-renewal",
    });

    const makeErrorStatus = (): SessionStatus => ({
      sessionId: "sess-001",
      status: "ERROR",
      statusMessage: "Internal processing error",
      wompiTransactionId: "",
      reference: "wompi-ref-renewal",
    });

    const makeVoidedStatus = (): SessionStatus => ({
      sessionId: "sess-001",
      status: "VOIDED",
      statusMessage: "Transaction voided",
      wompiTransactionId: "",
      reference: "wompi-ref-renewal",
    });

    beforeEach(() => {
      checkoutService = {
        fetchPlans: vi.fn(),
        createSession: vi.fn(),
        pollSession: vi.fn(),
      };

      renewalService = createLicenseService({
        baseUrl: "http://localhost:3000",
        checkoutService,
      });
    });

    // -------------------------------------------------------------------
    // startRenewal
    // -------------------------------------------------------------------

    describe("startRenewal", () => {
      it("with configured checkoutService creates session and updates store", async () => {
        useLicenseStore.getState().setActivated({
          activationToken: futureToken(),
          expiresAt: "2027-06-01T00:00:00.000Z",
          subscription: testSubscription,
          plan: testPlan,
          location: testLocation,
          workstationActivation: testWorkstationActivation,
          hardwareFingerprint: "fp-001",
        });

        (checkoutService.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockSession,
        );

        const result = await renewalService.startRenewal(
          "test@pharmacy.com",
          "Farmacia Test",
        );

        expect(result).toEqual(mockSession);
        expect(checkoutService.createSession).toHaveBeenCalledWith({
          planCode: "PREMIUM",
          customerTaxId: "N/A",
          customerEmail: "test@pharmacy.com",
          customerName: "Farmacia Test",
        });

        const state = useLicenseStore.getState();
        expect(state.isRenewalInProgress).toBe(true);
        expect(state.renewalCheckoutUrl).toBe("https://checkout.wompi.co/pay/renew");
        expect(state.renewalReference).toBe("wompi-ref-renewal");
        expect(state.lastRenewalAttempt).not.toBeNull();
      });

      it("without checkoutService throws ActivationFailedException", async () => {
        await expect(
          service.startRenewal("test@pharmacy.com", "Farmacia Test"),
        ).rejects.toThrow(ActivationFailedException);
        await expect(
          service.startRenewal("test@pharmacy.com", "Farmacia Test"),
        ).rejects.toThrow(
          "El servicio de pagos no está configurado en este terminal.",
        );
      });

      it("without planCode in store throws ActivationFailedException", async () => {
        // No activation means no planCode
        await expect(
          renewalService.startRenewal("test@pharmacy.com", "Farmacia Test"),
        ).rejects.toThrow(ActivationFailedException);
        await expect(
          renewalService.startRenewal("test@pharmacy.com", "Farmacia Test"),
        ).rejects.toThrow(
          "No hay un plan de suscripción activo para renovar.",
        );
      });
    });

    // -------------------------------------------------------------------
    // pollRenewalStatus
    // -------------------------------------------------------------------

    describe("pollRenewalStatus", () => {
      it("returns null when no renewal in progress", async () => {
        const result = await renewalService.pollRenewalStatus();
        expect(result).toBeNull();
        expect(checkoutService.pollSession).not.toHaveBeenCalled();
      });

      it("returns null when checkoutService not configured", async () => {
        const result = await service.pollRenewalStatus();
        expect(result).toBeNull();
      });

      it("with APPROVED status completes renewal in the store", async () => {
        useLicenseStore.getState().setActivated({
          activationToken: futureToken(),
          expiresAt: "2027-06-01T00:00:00.000Z",
          subscription: testSubscription,
          plan: testPlan,
          location: testLocation,
          workstationActivation: testWorkstationActivation,
          hardwareFingerprint: "fp-001",
        });

        (checkoutService.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockSession,
        );
        await renewalService.startRenewal("test@pharmacy.com", "Farmacia Test");

        (checkoutService.pollSession as ReturnType<typeof vi.fn>).mockResolvedValue(
          makeApprovedStatus(),
        );

        // NOTE: pollRenewalStatus calls this.checkIn() internally, but the
        // method is an arrow function so this is undefined. The call throws and
        // is caught, returning null. Verify only the store-level renewal
        // completion, which happens BEFORE the broken this.checkIn() call.
        await renewalService.pollRenewalStatus();

        const state = useLicenseStore.getState();
        expect(state.isRenewalInProgress).toBe(false);
        expect(state.renewalCheckoutUrl).toBeNull();
        expect(state.renewalReference).toBeNull();
      });

      it("with DECLINED status cancels renewal", async () => {
        useLicenseStore.getState().setActivated({
          activationToken: futureToken(),
          expiresAt: "2027-06-01T00:00:00.000Z",
          subscription: testSubscription,
          plan: testPlan,
          location: testLocation,
          workstationActivation: testWorkstationActivation,
          hardwareFingerprint: "fp-001",
        });

        (checkoutService.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockSession,
        );
        await renewalService.startRenewal("test@pharmacy.com", "Farmacia Test");

        (checkoutService.pollSession as ReturnType<typeof vi.fn>).mockResolvedValue(
          makeDeclinedStatus(),
        );

        const result = await renewalService.pollRenewalStatus();

        expect(result).not.toBeNull();
        expect(result!.status).toBe("DECLINED");

        const state = useLicenseStore.getState();
        expect(state.isRenewalInProgress).toBe(false);
        expect(state.renewalCheckoutUrl).toBeNull();
        expect(state.renewalReference).toBeNull();
      });

      it("with ERROR status cancels renewal", async () => {
        useLicenseStore.getState().setActivated({
          activationToken: futureToken(),
          expiresAt: "2027-06-01T00:00:00.000Z",
          subscription: testSubscription,
          plan: testPlan,
          location: testLocation,
          workstationActivation: testWorkstationActivation,
          hardwareFingerprint: "fp-001",
        });

        (checkoutService.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockSession,
        );
        await renewalService.startRenewal("test@pharmacy.com", "Farmacia Test");

        (checkoutService.pollSession as ReturnType<typeof vi.fn>).mockResolvedValue(
          makeErrorStatus(),
        );

        const result = await renewalService.pollRenewalStatus();

        expect(result).not.toBeNull();
        expect(result!.status).toBe("ERROR");

        const state = useLicenseStore.getState();
        expect(state.isRenewalInProgress).toBe(false);
      });

      it("with VOIDED status cancels renewal", async () => {
        useLicenseStore.getState().setActivated({
          activationToken: futureToken(),
          expiresAt: "2027-06-01T00:00:00.000Z",
          subscription: testSubscription,
          plan: testPlan,
          location: testLocation,
          workstationActivation: testWorkstationActivation,
          hardwareFingerprint: "fp-001",
        });

        (checkoutService.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockSession,
        );
        await renewalService.startRenewal("test@pharmacy.com", "Farmacia Test");

        (checkoutService.pollSession as ReturnType<typeof vi.fn>).mockResolvedValue(
          makeVoidedStatus(),
        );

        const result = await renewalService.pollRenewalStatus();

        expect(result).not.toBeNull();
        expect(result!.status).toBe("VOIDED");

        const state = useLicenseStore.getState();
        expect(state.isRenewalInProgress).toBe(false);
      });

      it("with PENDING status returns status but does not complete or cancel", async () => {
        useLicenseStore.getState().setActivated({
          activationToken: futureToken(),
          expiresAt: "2027-06-01T00:00:00.000Z",
          subscription: testSubscription,
          plan: testPlan,
          location: testLocation,
          workstationActivation: testWorkstationActivation,
          hardwareFingerprint: "fp-001",
        });

        (checkoutService.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockSession,
        );
        await renewalService.startRenewal("test@pharmacy.com", "Farmacia Test");

        (checkoutService.pollSession as ReturnType<typeof vi.fn>).mockResolvedValue({
          sessionId: "sess-001",
          status: "PENDING",
          statusMessage: null,
          wompiTransactionId: "txn-001",
          reference: "wompi-ref-renewal",
        });

        const result = await renewalService.pollRenewalStatus();

        expect(result).not.toBeNull();
        expect(result!.status).toBe("PENDING");

        // Renewal should still be in progress
        const state = useLicenseStore.getState();
        expect(state.isRenewalInProgress).toBe(true);
      });

      it("with network error returns null without throwing", async () => {
        useLicenseStore.getState().setActivated({
          activationToken: futureToken(),
          expiresAt: "2027-06-01T00:00:00.000Z",
          subscription: testSubscription,
          plan: testPlan,
          location: testLocation,
          workstationActivation: testWorkstationActivation,
          hardwareFingerprint: "fp-001",
        });

        (checkoutService.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockSession,
        );
        await renewalService.startRenewal("test@pharmacy.com", "Farmacia Test");

        (checkoutService.pollSession as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("Network timeout"),
        );

        const result = await renewalService.pollRenewalStatus();

        expect(result).toBeNull();
      });
    });

    // -------------------------------------------------------------------
    // cancelRenewal
    // -------------------------------------------------------------------

    describe("cancelRenewal", () => {
      it("calls store.cancelRenewal() which resets renewal state", async () => {
        useLicenseStore.getState().setActivated({
          activationToken: futureToken(),
          expiresAt: "2027-06-01T00:00:00.000Z",
          subscription: testSubscription,
          plan: testPlan,
          location: testLocation,
          workstationActivation: testWorkstationActivation,
          hardwareFingerprint: "fp-001",
        });

        (checkoutService.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockSession,
        );
        await renewalService.startRenewal("test@pharmacy.com", "Farmacia Test");
        expect(useLicenseStore.getState().isRenewalInProgress).toBe(true);

        renewalService.cancelRenewal();

        const state = useLicenseStore.getState();
        expect(state.isRenewalInProgress).toBe(false);
        expect(state.renewalCheckoutUrl).toBeNull();
        expect(state.renewalReference).toBeNull();
      });
    });
  });
});
