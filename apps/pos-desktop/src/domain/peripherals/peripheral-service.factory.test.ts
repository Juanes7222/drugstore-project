/**
 * Tests for createPeripheralServices — domain factory that creates cash
 * drawer and customer display services from a PrinterConfigService.
 *
 * Both peripherals are physically attached to a printer's pass-through port,
 * so they receive the same printerConfigService dependency.
 */
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock service objects
// ---------------------------------------------------------------------------

const mockCashDrawer = {
  openDrawer: vi.fn(),
  getDrawerConfig: vi.fn(),
  updateDrawerConfig: vi.fn(),
  getOpenMode: vi.fn(),
};

const mockCustomerDisplay = {
  showWelcome: vi.fn(),
  showLineItems: vi.fn(),
  showTotal: vi.fn(),
  showChangeDue: vi.fn(),
  showThankYou: vi.fn(),
  updateConfig: vi.fn(),
  getConfig: vi.fn(),
  getStatus: vi.fn(),
};

// ---------------------------------------------------------------------------
// Mock creation functions
// ---------------------------------------------------------------------------

vi.mock("../printing/cash-drawer.service", () => ({
  createCashDrawerService: vi.fn(() => mockCashDrawer),
}));

vi.mock("../printing/customer-display.service", () => ({
  createCustomerDisplayService: vi.fn(() => mockCustomerDisplay),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { createPeripheralServices } from "./peripheral-service.factory";
import { createCashDrawerService } from "../printing/cash-drawer.service";
import { createCustomerDisplayService } from "../printing/customer-display.service";

describe("createPeripheralServices", () => {
  const mockPrinterConfigService = {
    listAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getPrinterForJobType: vi.fn(),
    resolvePrinterWithFallback: vi.fn(),
    assignJobsToPrinter: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an object with cashDrawer and customerDisplay defined", () => {
    const services = createPeripheralServices(mockPrinterConfigService);

    expect(services.cashDrawer).toBe(mockCashDrawer);
    expect(services.customerDisplay).toBe(mockCustomerDisplay);
  });

  it("passes printerConfigService to cashDrawer service", () => {
    createPeripheralServices(mockPrinterConfigService);

    expect(createCashDrawerService).toHaveBeenCalledWith(mockPrinterConfigService);
  });

  it("passes printerConfigService to customerDisplay service", () => {
    createPeripheralServices(mockPrinterConfigService);

    expect(createCustomerDisplayService).toHaveBeenCalledWith(mockPrinterConfigService);
  });
});
