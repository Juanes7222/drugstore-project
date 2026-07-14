/**
 * Tests for the fiscal transmission window enforcement scheduler.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { createFiscalScheduler } from "./fiscal-scheduler.service";

function createMockInvoiceService() {
  return {
    findExpiringWithin: vi.fn(async () => []),
    findExpired: vi.fn(async () => []),
    markInvoiceAsExpired: vi.fn(async (id: string) => ({
      id,
      status: "EXPIRED_CONTINGENCY",
    })),
    generateInvoiceForSale: vi.fn(),
    generateCreditNoteForReturn: vi.fn(),
    cancelInvoice: vi.fn(),
    applyTransmissionResult: vi.fn(),
    findById: vi.fn(),
    findBySaleId: vi.fn(),
    listInvoices: vi.fn(),
    findExpiringWithin: vi.fn(),
    findExpired: vi.fn(),
    markInvoiceAsExpired: vi.fn(),
    queueInvoiceForTransmission: vi.fn(),
    pullAndApplyResults: vi.fn(),
  };
}

function createMockContingencyService() {
  return {
    isInContingency: vi.fn(),
    enterContingency: vi.fn(),
    exitContingency: vi.fn(),
    incrementGenerated: vi.fn(),
    incrementTransmitted: vi.fn(),
    incrementExpired: vi.fn(),
    hydrateStore: vi.fn(),
    startNetworkMonitor: vi.fn(),
    stopNetworkMonitor: vi.fn(),
    listHistory: vi.fn(),
  };
}

describe("FiscalScheduler", () => {
  let mockInvoiceService: ReturnType<typeof createMockInvoiceService>;
  let mockContingencyService: ReturnType<typeof createMockContingencyService>;

  beforeEach(() => {
    mockInvoiceService = createMockInvoiceService();
    mockContingencyService = createMockContingencyService();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("checkNow", () => {
    it("returns zero counts when nothing is expiring or expired", async () => {
      mockInvoiceService.findExpiringWithin = vi.fn(async () => []);
      mockInvoiceService.findExpired = vi.fn(async () => []);

      const scheduler = createFiscalScheduler({
        invoiceService: mockInvoiceService as any,
        contingencyService: mockContingencyService as any,
      });

      const result = await scheduler.checkNow();

      expect(result.expiredCount).toBe(0);
      expect(result.warnedCount).toBe(0);
      expect(result.warningMessages).toEqual([]);
    });

    it("returns warnedCount when invoices are expiring within the window", async () => {
      mockInvoiceService.findExpiringWithin = vi.fn(async () => [
        { id: "inv-exp1" },
        { id: "inv-exp2" },
      ] as any[]);
      mockInvoiceService.findExpired = vi.fn(async () => []);

      const scheduler = createFiscalScheduler({
        invoiceService: mockInvoiceService as any,
        contingencyService: mockContingencyService as any,
        warnBeforeHours: 4,
      });

      const result = await scheduler.checkNow();

      expect(result.warnedCount).toBe(2);
      expect(result.expiredCount).toBe(0);
      expect(result.warningMessages.length).toBeGreaterThanOrEqual(1);
      expect(result.warningMessages[0]).toContain("expire within");
    });

    it("expires invoices and returns expiredCount", async () => {
      mockInvoiceService.findExpiringWithin = vi.fn(async () => []);
      mockInvoiceService.findExpired = vi.fn(async () => [
        { id: "inv-expired-1" },
        { id: "inv-expired-2" },
        { id: "inv-expired-3" },
      ] as any[]);

      const scheduler = createFiscalScheduler({
        invoiceService: mockInvoiceService as any,
        contingencyService: mockContingencyService as any,
      });

      const result = await scheduler.checkNow();

      expect(result.expiredCount).toBe(3);
      expect(result.warnedCount).toBe(0);
      expect(mockInvoiceService.markInvoiceAsExpired).toHaveBeenCalledTimes(3);
      expect(mockInvoiceService.markInvoiceAsExpired).toHaveBeenCalledWith("inv-expired-1");
      expect(mockInvoiceService.markInvoiceAsExpired).toHaveBeenCalledWith("inv-expired-2");
      expect(mockInvoiceService.markInvoiceAsExpired).toHaveBeenCalledWith("inv-expired-3");
    });

    it("adds warning for expired invoices", async () => {
      mockInvoiceService.findExpiringWithin = vi.fn(async () => []);
      mockInvoiceService.findExpired = vi.fn(async () => [
        { id: "inv-expired-1" },
      ] as any[]);

      const scheduler = createFiscalScheduler({
        invoiceService: mockInvoiceService as any,
        contingencyService: mockContingencyService as any,
      });

      const result = await scheduler.checkNow();

      expect(result.warningMessages.some((m) => m.includes("expired"))).toBe(true);
    });

    it("handles findExpiringWithin errors gracefully", async () => {
      mockInvoiceService.findExpiringWithin = vi
        .fn()
        .mockRejectedValue(new Error("DB error"));
      mockInvoiceService.findExpired = vi.fn(async () => []);

      const scheduler = createFiscalScheduler({
        invoiceService: mockInvoiceService as any,
        contingencyService: mockContingencyService as any,
      });

      // Should not throw; should log and continue
      const result = await scheduler.checkNow();

      expect(result.warnedCount).toBe(0);
    });

    it("handles findExpired errors gracefully", async () => {
      mockInvoiceService.findExpiringWithin = vi.fn(async () => []);
      mockInvoiceService.findExpired = vi
        .fn()
        .mockRejectedValue(new Error("DB error"));

      const scheduler = createFiscalScheduler({
        invoiceService: mockInvoiceService as any,
        contingencyService: mockContingencyService as any,
      });

      const result = await scheduler.checkNow();

      expect(result.expiredCount).toBe(0);
    });
  });

  describe("start / stop", () => {
    it("runs checkNow immediately on start", async () => {
      const scheduler = createFiscalScheduler({
        invoiceService: mockInvoiceService as any,
        contingencyService: mockContingencyService as any,
      });

      scheduler.start();

      // Should have been called immediately
      expect(mockInvoiceService.findExpiringWithin).toHaveBeenCalled();
    });

    it("re-runs on the configured interval", async () => {
      const scheduler = createFiscalScheduler({
        invoiceService: mockInvoiceService as any,
        contingencyService: mockContingencyService as any,
        checkIntervalMs: 1000,
      });

      scheduler.start();
      await vi.advanceTimersByTimeAsync(2000);
      scheduler.stop();

      // findExpiringWithin should have been called at start + at least 2 more times
      expect(mockInvoiceService.findExpiringWithin.mock.calls.length).toBeGreaterThanOrEqual(
        2,
      );
    });

    it("does not start duplicate intervals", () => {
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

      const scheduler = createFiscalScheduler({
        invoiceService: mockInvoiceService as any,
        contingencyService: mockContingencyService as any,
      });

      scheduler.start();
      scheduler.start(); // Second call should be no-op

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    });

    it("stops the interval", () => {
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

      const scheduler = createFiscalScheduler({
        invoiceService: mockInvoiceService as any,
        contingencyService: mockContingencyService as any,
      });

      scheduler.start();
      scheduler.stop();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("is idempotent when stopped multiple times", () => {
      const scheduler = createFiscalScheduler({
        invoiceService: mockInvoiceService as any,
        contingencyService: mockContingencyService as any,
      });

      expect(() => {
        scheduler.stop();
        scheduler.stop();
      }).not.toThrow();
    });
  });

  describe("configuration", () => {
    it("uses default values for optional config", () => {
      const scheduler = createFiscalScheduler({
        invoiceService: mockInvoiceService as any,
        contingencyService: mockContingencyService as any,
      });

      // Start and stop to verify no crash with defaults
      scheduler.start();
      scheduler.stop();

      expect(mockInvoiceService.findExpiringWithin).toHaveBeenCalled();
    });
  });
});
