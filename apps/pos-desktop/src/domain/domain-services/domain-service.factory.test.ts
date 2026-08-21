/**
 * Tests for createDomainServices — domain factory that creates four
 * business-operation services (returns, inventory adjustments, prescriptions,
 * recovery log) with optional fiscal/printing dependencies.
 *
 * The returnsService is the only one with optional dependencies (invoiceService
 * and printRouter); the factory must handle their absence gracefully.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock service objects
// ---------------------------------------------------------------------------

const mockReturnsService = {
  createReturn: vi.fn(),
  confirmReturn: vi.fn(),
  cancelReturn: vi.fn(),
  getReturn: vi.fn(),
  searchSaleForReturn: vi.fn(),
  listReturns: vi.fn(),
};

const mockInventoryAdjustmentsService = {
  createAdjustment: vi.fn(),
  confirmAdjustment: vi.fn(),
  cancelAdjustment: vi.fn(),
  getAdjustment: vi.fn(),
  searchProducts: vi.fn(),
  listAdjustments: vi.fn(),
};

const mockPrescriptionsService = {
  createPrescription: vi.fn(),
  getPrescription: vi.fn(),
  listPending: vi.fn(),
};

const mockRecoveryLogService = {
  log: vi.fn(),
  list: vi.fn(),
};

const mockProductService = {
  createProduct: vi.fn(),
  listProducts: vi.fn(),
  updateProduct: vi.fn(),
};

const mockClientsService = {
  create: vi.fn(),
  search: vi.fn(),
  update: vi.fn(),
};

const mockImportService = {
  preview: vi.fn(),
  execute: vi.fn(),
  listHistory: vi.fn(),
  getHistory: vi.fn(),
  buildTemplate: vi.fn(),
};

// ---------------------------------------------------------------------------
// Mock creation functions
// ---------------------------------------------------------------------------

vi.mock("../returns/returns.service", () => ({
  createReturnsService: vi.fn(() => mockReturnsService),
}));

vi.mock("../inventory-adjustments/inventory-adjustments.service", () => ({
  createInventoryAdjustmentsService: vi.fn(() => mockInventoryAdjustmentsService),
}));

vi.mock("../prescriptions/prescriptions.service", () => ({
  createPrescriptionsService: vi.fn(() => mockPrescriptionsService),
}));

vi.mock("../backup/recovery-log.service", () => ({
  createRecoveryLogService: vi.fn(() => mockRecoveryLogService),
}));

vi.mock("../catalog/product.service", () => ({
  createProductService: vi.fn(() => mockProductService),
}));

vi.mock("../clients/clients.service", () => ({
  createClientsService: vi.fn(() => mockClientsService),
}));

vi.mock("../data-import/import.service", () => ({
  createImportService: vi.fn(() => mockImportService),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { createDomainServices } from "./domain-service.factory";
import { createReturnsService } from "../returns/returns.service";
import { createInventoryAdjustmentsService } from "../inventory-adjustments/inventory-adjustments.service";
import { createPrescriptionsService } from "../prescriptions/prescriptions.service";
import { createRecoveryLogService } from "../backup/recovery-log.service";
import { createImportService } from "../data-import/import.service";

describe("createDomainServices", () => {
  const mockPrisma = {
    clientReturn: { findMany: vi.fn() },
    syncQueue: { count: vi.fn() },
  };

  const mockAuth = {
    login: vi.fn(),
    logout: vi.fn(),
    requireRole: vi.fn(),
    getCurrentSession: vi.fn(),
  };

  const mockInvoiceService = {
    generateInvoiceForSale: vi.fn(),
    generateCreditNoteForReturn: vi.fn(),
    cancelInvoice: vi.fn(),
    applyTransmissionResult: vi.fn(),
    findById: vi.fn(),
  };

  const mockPrintRouter = {
    print: vi.fn(),
    tryServerFallback: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an object with all four domain services defined", () => {
    const services = createDomainServices({
      prisma: mockPrisma as any,
      auth: mockAuth as any,
      inventoryLotsService: {} as any,
      invoiceService: mockInvoiceService as any,
      printRouter: mockPrintRouter as any,
    });

    expect(services.returnsService).toBe(mockReturnsService);
    expect(services.inventoryAdjustmentsService).toBe(mockInventoryAdjustmentsService);
    expect(services.prescriptionsService).toBe(mockPrescriptionsService);
    expect(services.recoveryLogService).toBe(mockRecoveryLogService);
  });

  it("passes invoiceService and printRouter to returnsService", () => {
    createDomainServices({
      prisma: mockPrisma as any,
      auth: mockAuth as any,
      inventoryLotsService: {} as any,
      invoiceService: mockInvoiceService as any,
      printRouter: mockPrintRouter as any,
    });

    expect(createReturnsService).toHaveBeenCalledWith(
      mockPrisma,
      mockAuth,
      mockInvoiceService,
      mockPrintRouter,
    );
  });

  it("creates returnsService without optional dependencies when omitted", () => {
    createDomainServices({
      prisma: mockPrisma as any,
      auth: mockAuth as any,
      inventoryLotsService: {} as any,
    });

    expect(createReturnsService).toHaveBeenCalledWith(
      mockPrisma,
      mockAuth,
      undefined,
      undefined,
    );
  });

  it("passes prisma and auth to inventoryAdjustmentsService", () => {
    createDomainServices({
      prisma: mockPrisma as any,
      auth: mockAuth as any,
      inventoryLotsService: {} as any,
    });

    expect(createInventoryAdjustmentsService).toHaveBeenCalledWith(mockPrisma, mockAuth);
  });

  it("passes prisma and auth to prescriptionsService", () => {
    createDomainServices({
      prisma: mockPrisma as any,
      auth: mockAuth as any,
      inventoryLotsService: {} as any,
    });

    expect(createPrescriptionsService).toHaveBeenCalledWith(mockPrisma, mockAuth);
  });

  it("passes prisma to recoveryLogService", () => {
    createDomainServices({
      prisma: mockPrisma as any,
      auth: mockAuth as any,
      inventoryLotsService: {} as any,
    });

    expect(createRecoveryLogService).toHaveBeenCalledWith(mockPrisma);
  });

  it("exposes importService wired with prisma, auth, productService, and clientsService", () => {
    const services = createDomainServices({
      prisma: mockPrisma as any,
      auth: mockAuth as any,
      inventoryLotsService: {} as any,
    });

    expect(services.importService).toBe(mockImportService);
    expect(createImportService).toHaveBeenCalledWith({
      prisma: mockPrisma,
      auth: mockAuth,
      productService: mockProductService,
      clientsService: mockClientsService,
    });
  });
});
