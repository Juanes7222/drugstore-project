/**
 * Tests for proactive printer notification rules.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { checkPrinterNotifications, PRINTER_NOTIFICATION_RULES } from "./proactive-notifications";
import type { PrinterConfigService } from "./printer-config.service";
import type { PrintQueueService } from "./print-queue.service";
import type { CashDrawerService } from "./cash-drawer.service";

describe("PRINTER_NOTIFICATION_RULES", () => {
  it("defines 6 notification rules", () => {
    expect(PRINTER_NOTIFICATION_RULES).toHaveLength(6);
  });

  it("every rule has required fields", () => {
    for (const rule of PRINTER_NOTIFICATION_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.messageKey).toBeTruthy();
      expect(rule.actionCommand).toBeTruthy();
      expect(typeof rule.requiresManager).toBe("boolean");
    }
  });

  it("no-printers-configured and print-queue-failed require manager", () => {
    const managerRules = PRINTER_NOTIFICATION_RULES.filter((r) => r.requiresManager);
    const managerRuleIds = managerRules.map((r) => r.id);
    expect(managerRuleIds).toContain("no-printers-configured");
    expect(managerRuleIds).toContain("print-queue-failed");
  });
});

describe("checkPrinterNotifications", () => {
  let mockPrinterConfigService: Partial<PrinterConfigService>;
  let mockPrintQueueService: Partial<PrintQueueService>;
  let mockCashDrawerService: Partial<CashDrawerService>;

  beforeEach(() => {
    mockPrinterConfigService = {
      listAll: vi.fn().mockResolvedValue([]),
    };
    mockPrintQueueService = {
      getQueueSummary: vi.fn().mockResolvedValue({
        pending: 0, printing: 0, failed: 0, discarded: 0, completed24h: 0, averageAttemptsBeforeSuccess: 0,
      }),
    };
    mockCashDrawerService = {};
  });

  it("returns no-printers-configured when no printers exist", async () => {
    const notifications = await checkPrinterNotifications(
      mockPrinterConfigService as PrinterConfigService,
      mockPrintQueueService as PrintQueueService,
      mockCashDrawerService as CashDrawerService,
    );

    const noPrinter = notifications.find((n) => n.ruleId === "no-printers-configured");
    expect(noPrinter).toBeDefined();
    expect(noPrinter!.severity).toBe("warning");
  });

  it("returns printer-offline notifications for offline printers", async () => {
    mockPrinterConfigService.listAll = vi.fn().mockResolvedValue([
      { friendlyName: "Main", status: "ONLINE", cashDrawerConfig: null },
      { friendlyName: "Secondary", status: "OFFLINE", cashDrawerConfig: null },
    ]);

    const notifications = await checkPrinterNotifications(
      mockPrinterConfigService as PrinterConfigService,
      mockPrintQueueService as PrintQueueService,
      mockCashDrawerService as CashDrawerService,
    );

    const offline = notifications.find((n) => n.ruleId === "printer-offline");
    expect(offline).toBeDefined();
    expect(offline!.printerName).toBe("Secondary");
    expect(offline!.severity).toBe("error");
  });

  it("returns no-paper notification for printers with NO_PAPER status", async () => {
    mockPrinterConfigService.listAll = vi.fn().mockResolvedValue([
      { friendlyName: "Receipt", status: "NO_PAPER", cashDrawerConfig: null },
    ]);

    const notifications = await checkPrinterNotifications(
      mockPrinterConfigService as PrinterConfigService,
      mockPrintQueueService as PrintQueueService,
      mockCashDrawerService as CashDrawerService,
    );

    const noPaper = notifications.find((n) => n.ruleId === "printer-no-paper");
    expect(noPaper).toBeDefined();
    expect(noPaper!.severity).toBe("warning");
  });

  it("returns print-queue-pending when jobs are queued", async () => {
    mockPrintQueueService.getQueueSummary = vi.fn().mockResolvedValue({
      pending: 5, printing: 0, failed: 0, discarded: 0, completed24h: 0, averageAttemptsBeforeSuccess: 0,
    });

    const notifications = await checkPrinterNotifications(
      mockPrinterConfigService as PrinterConfigService,
      mockPrintQueueService as PrintQueueService,
      mockCashDrawerService as CashDrawerService,
    );

    const pending = notifications.find((n) => n.ruleId === "print-queue-pending");
    expect(pending).toBeDefined();
    expect(pending!.severity).toBe("warning");
  });

  it("returns print-queue-failed when jobs have failed", async () => {
    mockPrintQueueService.getQueueSummary = vi.fn().mockResolvedValue({
      pending: 0, printing: 0, failed: 3, discarded: 0, completed24h: 0, averageAttemptsBeforeSuccess: 0,
    });

    const notifications = await checkPrinterNotifications(
      mockPrinterConfigService as PrinterConfigService,
      mockPrintQueueService as PrintQueueService,
      mockCashDrawerService as CashDrawerService,
    );

    const failed = notifications.find((n) => n.ruleId === "print-queue-failed");
    expect(failed).toBeDefined();
    expect(failed!.severity).toBe("error");
  });
});
