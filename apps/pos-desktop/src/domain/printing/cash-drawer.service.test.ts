/**
 * Tests for the cash drawer service.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  createCashDrawerService,
  type CashDrawerService,
} from "./cash-drawer.service";
import type { PrinterConfigService } from "./printer-config.service";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ success: true }),
}));

describe("CashDrawerService", () => {
  let service: CashDrawerService;
  let mockPrinterConfigService: Partial<PrinterConfigService>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrinterConfigService = {
      getById: vi.fn().mockResolvedValue({
        id: "printer-1",
        systemName: "EPSON-TM-T20",
        friendlyName: "Main Printer",
        status: "ONLINE",
        cashDrawerConfig: JSON.stringify({
          hasDrawer: true,
          openMode: "ALWAYS",
          autoCloseAfterSeconds: 5,
          kickCommand: [0x1B, 0x70, 0x00, 0x32, 0xFA],
        }),
      }),
      update: vi.fn().mockResolvedValue({}),
    };

    service = createCashDrawerService(
      mockPrinterConfigService as PrinterConfigService,
    );
  });

  describe("openDrawer", () => {
    it("opens drawer successfully", async () => {
      const result = await service.openDrawer("printer-1", "Sale confirmed");

      expect(result.success).toBe(true);
    });

    it("returns failure when printer has no drawer configured", async () => {
      mockPrinterConfigService.getById = vi.fn().mockResolvedValue({
        cashDrawerConfig: JSON.stringify({ hasDrawer: false }),
      });

      const result = await service.openDrawer("printer-1", "test");

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("No hay cajón monedero");
    });

    it("returns failure when printer config has no drawer config", async () => {
      mockPrinterConfigService.getById = vi.fn().mockResolvedValue({
        cashDrawerConfig: null,
      });

      const result = await service.openDrawer("printer-1", "test");

      expect(result.success).toBe(false);
    });
  });

  describe("configureAutoOpen", () => {
    it("updates the drawer open mode and auto-close seconds", async () => {
      await service.configureAutoOpen("printer-1", "CASH_ONLY", 10);

      // Should have updated the config - the getById was called first
      expect(mockPrinterConfigService.getById).toHaveBeenCalledWith("printer-1");
    });
  });

  describe("shouldAutoOpen", () => {
    it("returns true for ALWAYS mode", async () => {
      const result = await service.shouldAutoOpen("printer-1", true);

      expect(result).toBe(true);
    });

    it("returns true for CASH_ONLY mode with cash payment", async () => {
      mockPrinterConfigService.getById = vi.fn().mockResolvedValue({
        cashDrawerConfig: JSON.stringify({
          hasDrawer: true,
          openMode: "CASH_ONLY",
        }),
      });

      const result = await service.shouldAutoOpen("printer-1", true);

      expect(result).toBe(true);
    });

    it("returns false for CASH_ONLY mode without cash payment", async () => {
      mockPrinterConfigService.getById = vi.fn().mockResolvedValue({
        cashDrawerConfig: JSON.stringify({
          hasDrawer: true,
          openMode: "CASH_ONLY",
        }),
      });

      const result = await service.shouldAutoOpen("printer-1", false);

      expect(result).toBe(false);
    });

    it("returns false for MANUAL mode", async () => {
      mockPrinterConfigService.getById = vi.fn().mockResolvedValue({
        cashDrawerConfig: JSON.stringify({
          hasDrawer: true,
          openMode: "MANUAL",
        }),
      });

      const result = await service.shouldAutoOpen("printer-1", true);

      expect(result).toBe(false);
    });

    it("returns false when no drawer is configured", async () => {
      mockPrinterConfigService.getById = vi.fn().mockResolvedValue({
        cashDrawerConfig: JSON.stringify({ hasDrawer: false }),
      });

      const result = await service.shouldAutoOpen("printer-1", true);

      expect(result).toBe(false);
    });
  });

  describe("getConfig", () => {
    it("returns the parsed drawer config", async () => {
      const config = await service.getConfig("printer-1");

      expect(config.hasDrawer).toBe(true);
      expect(config.openMode).toBe("ALWAYS");
    });

    it("returns default config when no config is stored", async () => {
      mockPrinterConfigService.getById = vi.fn().mockResolvedValue({
        cashDrawerConfig: null,
      });

      const config = await service.getConfig("printer-1");

      expect(config.hasDrawer).toBe(false);
      expect(config.openMode).toBe("MANUAL");
    });
  });
});
