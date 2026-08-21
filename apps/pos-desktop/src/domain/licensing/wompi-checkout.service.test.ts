import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { BillingPeriod } from "@pharmacy/shared-types";
import {
  createWompiCheckoutService,
  CheckoutError,
  CheckoutTimeoutError,
  estimatePeriodAmountCents,
  type WompiCheckoutService,
  type CheckoutPlan,
  type CheckoutSession,
  type SessionStatus,
} from "./wompi-checkout.service";

// ---------------------------------------------------------------------------
// API_BASE_URL is re-exported from a module that reads import.meta.env
// at import time. Mock the resolved value so tests don't depend on env vars.
// ---------------------------------------------------------------------------
vi.mock("../../infrastructure/config", () => ({
  API_BASE_URL: "https://api.pharmacy.example.com",
}));

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makePlan(overrides?: Partial<CheckoutPlan>): CheckoutPlan {
  return {
    code: "PREMIUM",
    name: "Premium",
    description: "All features included",
    pricingModel: "PER_WORKSTATION",
    basePriceCents: 50000,
    currency: "COP",
    billingPeriod: "MONTHLY",
    maxLocations: 5,
    includedWorkstations: 3,
    extraWorkstationPriceCents: 10000,
    features: ["MULTI_LOCATION", "ADVANCED_REPORTS"],
    displayOrder: 1,
    ...overrides,
  };
}

function makeSession(overrides?: Partial<CheckoutSession>): CheckoutSession {
  return {
    sessionId: "sess-abc123",
    paymentLinkId: "plink-xyz789",
    checkoutUrl: "https://checkout.wompi.co/pay/abc",
    reference: "wompi-ref-001",
    amountCents: 50000,
    currency: "COP",
    ...overrides,
  };
}

function makeSessionStatus(
  overrides?: Partial<SessionStatus>,
): SessionStatus {
  return {
    sessionId: "sess-abc123",
    status: "PENDING",
    statusMessage: null,
    wompiTransactionId: "txn-001",
    reference: "wompi-ref-001",
    subscriptionId: null,
    activationCode: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("createWompiCheckoutService", () => {
  let service: WompiCheckoutService;

  beforeEach(() => {
    service = createWompiCheckoutService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // fetchPlans
  // -----------------------------------------------------------------------

  describe("fetchPlans", () => {
    it("calls the correct endpoint and returns parsed plans", async () => {
      const plans = [makePlan(), makePlan({ code: "BASIC", name: "Basic" })];
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(plans),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await service.fetchPlans();

      expect(result).toEqual(plans);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://api.pharmacy.example.com/public/licensing/checkout/plans",
      );
      expect(options.method).toBe("POST");
    });

    it("throws CheckoutError on non-2xx response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('{"message":"Server error"}'),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(service.fetchPlans()).rejects.toThrow(CheckoutError);
      await expect(service.fetchPlans()).rejects.toMatchObject({
        status: 500,
        name: "CheckoutError",
      });
    });

    it("throws CheckoutError on non-2xx with plain text body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Invalid request"),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(service.fetchPlans()).rejects.toThrow(CheckoutError);
      await expect(service.fetchPlans()).rejects.toMatchObject({
        status: 400,
        message: "Invalid request",
      });
    });

    it("throws CheckoutError with HTTP status when body is empty", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve(""),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(service.fetchPlans()).rejects.toThrow(CheckoutError);
      await expect(service.fetchPlans()).rejects.toMatchObject({
        status: 503,
        message: "HTTP 503",
      });
    });

    it("throws CheckoutError on network failure", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new Error("Network failure"));
      vi.stubGlobal("fetch", mockFetch);

      await expect(service.fetchPlans()).rejects.toThrow("Network failure");
    });
  });

  // -----------------------------------------------------------------------
  // createSession
  // -----------------------------------------------------------------------

  describe("createSession", () => {
    const request = {
      planCode: "PREMIUM",
      customerTaxId: "123456789",
      customerEmail: "test@pharmacy.com",
      customerName: "Farmacia Test",
    };

    it("sends correct request body and returns CheckoutSession", async () => {
      const session = makeSession();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(session),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await service.createSession(request);

      expect(result).toEqual(session);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://api.pharmacy.example.com/public/licensing/checkout/create-session",
      );
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body.planCode).toBe("PREMIUM");
      expect(body.customerEmail).toBe("test@pharmacy.com");
      expect(body.customerName).toBe("Farmacia Test");
    });

    it("throws CheckoutError on server error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve('{"message":"Invalid plan code"}'),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(service.createSession(request)).rejects.toThrow(
        CheckoutError,
      );
      await expect(service.createSession(request)).rejects.toMatchObject({
        status: 422,
        message: "Invalid plan code",
      });
    });

    it("throws CheckoutError on network failure", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new Error("Connection refused"));
      vi.stubGlobal("fetch", mockFetch);

      await expect(service.createSession(request)).rejects.toThrow(
        "Connection refused",
      );
    });
  });

  // -----------------------------------------------------------------------
  // pollSession
  // -----------------------------------------------------------------------

  describe("pollSession", () => {
    const reference = "wompi-ref-001";

    it("calls correct GET endpoint and returns SessionStatus", async () => {
      const status = makeSessionStatus({ status: "APPROVED" });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(status),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await service.pollSession(reference);

      expect(result).toEqual(status);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `https://api.pharmacy.example.com/public/licensing/checkout/session/${reference}`,
      );
      expect(options.method).toBe("GET");
    });

    it("handles APPROVED status correctly", async () => {
      const status = makeSessionStatus({
        status: "APPROVED",
        statusMessage: "Transaction approved",
        wompiTransactionId: "txn-approved",
      });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(status),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await service.pollSession(reference);

      expect(result.status).toBe("APPROVED");
      expect(result.statusMessage).toBe("Transaction approved");
      expect(result.wompiTransactionId).toBe("txn-approved");
    });

    it("handles DECLINED status correctly", async () => {
      const status = makeSessionStatus({
        status: "DECLINED",
        statusMessage: "Transaction declined by bank",
      });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(status),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await service.pollSession(reference);

      expect(result.status).toBe("DECLINED");
      expect(result.statusMessage).toBe("Transaction declined by bank");
    });

    it("throws CheckoutError on 404 (session not found)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('{"message":"Session not found"}'),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(service.pollSession(reference)).rejects.toThrow(
        CheckoutError,
      );
      await expect(service.pollSession(reference)).rejects.toMatchObject({
        status: 404,
        message: "Session not found",
      });
    });

    it("throws CheckoutError on network failure", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new Error("Network timeout"));
      vi.stubGlobal("fetch", mockFetch);

      await expect(service.pollSession(reference)).rejects.toThrow(
        "Network timeout",
      );
    });
  });

  // -----------------------------------------------------------------------
  // estimatePeriodAmountCents
  // -----------------------------------------------------------------------

  describe("estimatePeriodAmountCents", () => {
    it("returns the base price for MONTHLY", () => {
      expect(estimatePeriodAmountCents(50_000, BillingPeriod.MONTHLY)).toBe(
        50_000,
      );
    });

    it("applies 10% off for QUARTERLY", () => {
      expect(estimatePeriodAmountCents(50_000, BillingPeriod.QUARTERLY)).toBe(
        135_000,
      );
    });

    it("applies 20% off for ANNUAL", () => {
      expect(estimatePeriodAmountCents(50_000, BillingPeriod.ANNUAL)).toBe(
        480_000,
      );
    });

    it("rounds fractional results to whole cents", () => {
      expect(estimatePeriodAmountCents(33_333, BillingPeriod.QUARTERLY)).toBe(
        89_999,
      );
      expect(estimatePeriodAmountCents(4_167, BillingPeriod.ANNUAL)).toBe(
        40_003,
      );
    });
  });

  // -----------------------------------------------------------------------
  // pollUntilTerminal
  // -----------------------------------------------------------------------

  describe("pollUntilTerminal", () => {
    const reference = "wompi-ref-001";

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns the status when the first poll is terminal", async () => {
      const status = makeSessionStatus({ status: "APPROVED" });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(status),
      });
      vi.stubGlobal("fetch", mockFetch);
      const onStatus = vi.fn();

      const result = await service.pollUntilTerminal(reference, {
        intervalMs: 5_000,
        timeoutMs: 60_000,
        onStatus,
      });

      expect(result).toEqual(status);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(onStatus).not.toHaveBeenCalled();
    });

    it("keeps polling until a terminal status arrives", async () => {
      vi.useFakeTimers();
      const pending = makeSessionStatus({ status: "PENDING" });
      const approved = makeSessionStatus({
        status: "APPROVED",
        activationCode: "ABCDEFGHIJKL",
      });
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(pending) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(pending) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(approved) });
      vi.stubGlobal("fetch", mockFetch);
      const onStatus = vi.fn();

      const promise = service.pollUntilTerminal(reference, {
        intervalMs: 10,
        timeoutMs: 1_000,
        onStatus,
      });
      await vi.advanceTimersByTimeAsync(30);

      await expect(promise).resolves.toEqual(approved);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(onStatus).toHaveBeenCalledTimes(2);
      expect(onStatus).toHaveBeenNthCalledWith(1, pending);
      expect(onStatus).toHaveBeenNthCalledWith(2, pending);
    });

    it("keeps polling through a transient CheckoutError and succeeds", async () => {
      vi.useFakeTimers();
      const approved = makeSessionStatus({ status: "APPROVED" });
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new CheckoutError(500, "Server hiccup"))
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(approved) });
      vi.stubGlobal("fetch", mockFetch);
      const onStatus = vi.fn();

      const promise = service.pollUntilTerminal(reference, {
        intervalMs: 10,
        timeoutMs: 1_000,
        onStatus,
      });
      await vi.advanceTimersByTimeAsync(20);

      await expect(promise).resolves.toEqual(approved);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(onStatus).toHaveBeenCalledTimes(1);
      expect(onStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "PENDING",
          reference,
          subscriptionId: null,
          activationCode: null,
        }),
      );
    });

    it("throws CheckoutTimeoutError when the deadline passes", async () => {
      vi.useFakeTimers();
      const pending = makeSessionStatus({ status: "PENDING" });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(pending),
      });
      vi.stubGlobal("fetch", mockFetch);

      const promise = service.pollUntilTerminal(reference, {
        intervalMs: 100,
        timeoutMs: 250,
      });
      const assertion = expect(promise).rejects.toThrow(CheckoutTimeoutError);
      await vi.advanceTimersByTimeAsync(400);

      await assertion;
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("rethrows non-CheckoutError failures immediately", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new Error("Connection refused"));
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        service.pollUntilTerminal(reference, {
          intervalMs: 10,
          timeoutMs: 1_000,
        }),
      ).rejects.toThrow("Connection refused");
    });
  });
});
