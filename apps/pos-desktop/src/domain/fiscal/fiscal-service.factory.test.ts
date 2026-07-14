/**
 * Tests for createFiscalServices — domain factory that wires fiscal
 * services together.
 *
 * The factory imports four separate creation functions and passes shared
 * dependencies between them.  We mock those creation functions to return
 * simple objects and then verify:
 *
 * 1. Every returned service is non-null and matches the expected interface.
 * 2. The invoice service receives the same numbering + contingency services.
 * 3. The fiscal scheduler receives the same invoice + contingency services.
 */
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock creation functions
// ---------------------------------------------------------------------------

const mockNumberingService = { nextNumber: vi.fn(), ensureCounters: vi.fn(), initializeCounters: vi.fn() };
const mockContingencyService = { isInContingency: vi.fn(), enterContingency: vi.fn(), endContingency: vi.fn(), hydrateStore: vi.fn(), startListening: vi.fn(), stopListening: vi.fn() };
const mockInvoiceService = { generateInvoiceForSale: vi.fn(), generateCreditNoteForReturn: vi.fn(), cancelInvoice: vi.fn(), applyTransmissionResult: vi.fn(), findById: vi.fn() };
const mockFiscalScheduler = { start: vi.fn(), stop: vi.fn(), checkNow: vi.fn() };

vi.mock("./numbering.service", () => ({
  createFiscalNumberingService: vi.fn(() => mockNumberingService),
}));

vi.mock("./contingency.service", () => ({
  createContingencyService: vi.fn(() => mockContingencyService),
}));

vi.mock("./invoice.service", () => ({
  createInvoiceService: vi.fn(() => mockInvoiceService),
}));

vi.mock("./fiscal-scheduler.service", () => ({
  createFiscalScheduler: vi.fn(() => mockFiscalScheduler),
}));

// ---------------------------------------------------------------------------
// Subject under test (must be imported AFTER vi.mock calls).
// We import the creation functions directly from their original modules
// because the factory does not re-export them.
// ---------------------------------------------------------------------------

import { createFiscalServices } from "./fiscal-service.factory";
import { createFiscalNumberingService } from "./numbering.service";
import { createContingencyService } from "./contingency.service";
import { createInvoiceService } from "./invoice.service";
import { createFiscalScheduler } from "./fiscal-scheduler.service";

describe("createFiscalServices", () => {
  const mockPrisma = {
    fiscalCounter: { findUnique: vi.fn(), upsert: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an object with all four fiscal services defined", () => {
    const services = createFiscalServices({
      prisma: mockPrisma as any,
      workstationId: "ws-001",
    });

    expect(services.fiscalNumberingService).toBe(mockNumberingService);
    expect(services.contingencyService).toBe(mockContingencyService);
    expect(services.invoiceService).toBe(mockInvoiceService);
    expect(services.fiscalScheduler).toBe(mockFiscalScheduler);
  });

  it("passes prisma and workstationId to fiscalNumberingService", () => {
    createFiscalServices({ prisma: mockPrisma as any, workstationId: "ws-002" });

    expect(createFiscalNumberingService).toHaveBeenCalledWith({
      prisma: mockPrisma,
      workstationId: "ws-002",
    });
  });

  it("passes prisma and workstationId to contingencyService", () => {
    createFiscalServices({ prisma: mockPrisma as any, workstationId: "ws-003" });

    expect(createContingencyService).toHaveBeenCalledWith({
      prisma: mockPrisma,
      workstationId: "ws-003",
    });
  });

  it("wires invoiceService with the same numberingService and contingencyService", () => {
    createFiscalServices({ prisma: mockPrisma as any, workstationId: "ws-004" });

    expect(createInvoiceService).toHaveBeenCalledWith(
      expect.objectContaining({
        numberingService: mockNumberingService,
        contingencyService: mockContingencyService,
      }),
    );
  });

  it("wires fiscalScheduler with the same invoiceService and contingencyService", () => {
    createFiscalServices({ prisma: mockPrisma as any, workstationId: "ws-005" });

    expect(createFiscalScheduler).toHaveBeenCalledWith({
      invoiceService: mockInvoiceService,
      contingencyService: mockContingencyService,
    });
  });
});
