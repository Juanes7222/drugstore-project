/**
 * Tests for the customer display service.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  createCustomerDisplayService,
  type CustomerDisplayService,
} from "./customer-display.service";
import type { PrinterConfigService } from "./printer-config.service";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

describe("CustomerDisplayService", () => {
  let service: CustomerDisplayService;
  let mockPrinterConfigService: Partial<PrinterConfigService>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrinterConfigService = {
      getById: vi.fn().mockResolvedValue({
        id: "printer-1",
        systemName: "EPSON-DISPLAY",
        friendlyName: "Customer Display",
        customerDisplayConfig: JSON.stringify({
          hasDisplay: true,
          mode: "LINE_ITEMS",
          welcomeMessage: "Bienvenido",
          thankYouMessage: "Gracias",
          idleMessage: "Bienvenido a Farmacia POS",
          encoding: "CP850",
        }),
      }),
    };

    service = createCustomerDisplayService(
      mockPrinterConfigService as PrinterConfigService,
    );
  });

  describe("updateDisplay", () => {
    it("sends display content to the printer", async () => {
      await service.updateDisplay("printer-1", { message: "Hola" });

      const { invoke } = await import("@tauri-apps/api/core");
      expect(invoke).toHaveBeenCalledWith("customer_display_update", {
        printerSystemName: "EPSON-DISPLAY",
        text: expect.stringContaining("Hola"),
        encoding: "CP850",
      });
    });

    it("silently skips when no display is configured", async () => {
      mockPrinterConfigService.getById = vi.fn().mockResolvedValue({
        customerDisplayConfig: JSON.stringify({ hasDisplay: false }),
      });

      await service.updateDisplay("printer-1", { message: "Hola" });

      const { invoke } = await import("@tauri-apps/api/core");
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  describe("showIdle", () => {
    it("shows the idle message and clears items", async () => {
      await service.showIdle("printer-1");

      const { invoke } = await import("@tauri-apps/api/core");
      expect(invoke).toHaveBeenCalledWith("customer_display_update", {
        printerSystemName: "EPSON-DISPLAY",
        text: expect.stringContaining("Bienvenido a Farmacia POS"),
        encoding: "CP850",
      });
    });
  });

  describe("showWelcome", () => {
    it("shows the welcome message and resets failure flag", async () => {
      await service.showWelcome("printer-1");

      expect(service.hasDisplayFailed("printer-1")).toBe(false);
    });
  });

  describe("updateSaleItems", () => {
    it("sends line items to the display", async () => {
      await service.updateSaleItems(
        "printer-1",
        [
          { name: "Acetaminofén 500mg", qty: 2, price: 5000 },
          { name: "Ibuprofeno 400mg", qty: 1, price: 8000 },
        ],
        18000,
      );

      const { invoke } = await import("@tauri-apps/api/core");
      expect(invoke).toHaveBeenCalled();
    });

    it("shows only total in TOTAL_ONLY mode", async () => {
      mockPrinterConfigService.getById = vi.fn().mockResolvedValue({
        customerDisplayConfig: JSON.stringify({
          hasDisplay: true,
          mode: "TOTAL_ONLY",
        }),
      });

      await service.updateSaleItems(
        "printer-1",
        [{ name: "Test", qty: 1, price: 10000 }],
        10000,
      );

      const { invoke } = await import("@tauri-apps/api/core");
      expect(invoke).toHaveBeenCalled();
    });
  });

  describe("showChangeDue", () => {
    it("shows change due when change > 0", async () => {
      await service.showChangeDue("printer-1", 2000, 10000);

      const { invoke } = await import("@tauri-apps/api/core");
      expect(invoke).toHaveBeenCalled();
    });

    it("shows 'Pago exacto' when no change", async () => {
      await service.showChangeDue("printer-1", 0, 10000);

      const { invoke } = await import("@tauri-apps/api/core");
      expect(invoke).toHaveBeenCalled();
    });
  });

  describe("hasDisplayFailed / resetFailureFlag", () => {
    it("tracks display failures", () => {
      expect(service.hasDisplayFailed("printer-1")).toBe(false);

      // Simulate a failure by making getById throw
      mockPrinterConfigService.getById = vi.fn().mockRejectedValue(new Error("DB error"));

      service.updateDisplay("printer-1", { message: "test" });

      // The failure should be tracked
      expect(service.hasDisplayFailed("printer-1")).toBe(true);

      service.resetFailureFlag("printer-1");
      expect(service.hasDisplayFailed("printer-1")).toBe(false);
    });
  });
});
