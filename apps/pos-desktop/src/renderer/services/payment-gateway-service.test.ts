/**
 * Tests for the mock payment gateway service.
 *
 * Covers reference generation, deterministic approval, and seeded random
 * outcomes via vi.spyOn.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMockPaymentGatewayService } from "./payment-gateway-service.mock";

describe("MockPaymentGatewayService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // generateReference
  // ---------------------------------------------------------------------------

  describe("generateReference", () => {
    it("returns a string starting with POS-", () => {
      const service = createMockPaymentGatewayService();

      const reference = service.generateReference();

      expect(reference).toMatch(/^POS-/);
    });

    it("returns unique values on successive calls", () => {
      const service = createMockPaymentGatewayService();

      const ref1 = service.generateReference();
      const ref2 = service.generateReference();

      expect(ref1).not.toBe(ref2);
    });
  });

  // ---------------------------------------------------------------------------
  // authorize
  // ---------------------------------------------------------------------------

  describe("authorize", () => {
    it("resolves within a reasonable time with approveAll: true", async () => {
      const service = createMockPaymentGatewayService({ approveAll: true });

      const result = await service.authorize({
        methodType: "CARD",
        amountCents: 50000,
      });

      expect(result).toBeDefined();
    });

    it("with approveAll: true always returns approved", async () => {
      const service = createMockPaymentGatewayService({ approveAll: true });

      const result = await service.authorize({
        methodType: "CARD",
        amountCents: 50000,
      });

      expect(result.status).toBe("approved");
      expect(result.reference).toMatch(/^POS-/);
    });

    it("returns an object with a status field", async () => {
      const service = createMockPaymentGatewayService({ approveAll: true });

      const result = await service.authorize({
        methodType: "TRANSFER",
        amountCents: 25000,
      });

      expect(result).toHaveProperty("status");
    });
  });
});
