/**
 * Tests for the invoice service.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { createInvoiceService } from "./invoice.service";
import {
  SaleMissingForInvoiceException,
  ContingencyTechKeyPlaceholderError,
  InvoiceNotFoundException,
  InvoiceNotCancellableException,
} from "./exceptions";

// Mock config/fiscal module
vi.mock("../../config/fiscal", () => ({
  CONTINGENCY_TECH_KEY: "test-tech-key-12345",
  CONTINGENCY_TRANSMISSION_WINDOW_HOURS: 48,
  isContingencyTechKeyPlaceholder: vi.fn(() => false),
}));

// Mock cufe module
vi.mock("./cufe", () => ({
  calculateProvisionalCufe: vi.fn(async () => "CUFE-HASH-1234567890ABCDEF"),
}));

/** Shared in-memory store for sales, accessible by both seedSale and mock Prisma */
const saleStore: Record<string, unknown>[] = [];

function seedSale(overrides?: Record<string, unknown>) {
  const sale = {
    id: "sale-1",
    clientId: "client-1",
    clientNameSnapshot: "JUAN PEREZ",
    clientIdentificationTypeSnapshot: "CC",
    clientIdentificationNumberSnapshot: "1012345678",
    subtotal: 50000n,
    totalDiscount: 0n,
    totalTax: 9500n,
    totalAmount: 59500n,
    changeAmount: 0n,
    cashShiftId: "shift-1",
    workstationId: "ws-001",
    userId: "user-1",
    sourceWorkstationId: "ws-001",
    items: [],
    payments: [],
    _items: [],
    _payments: [],
    ...overrides,
  } as any;
  saleStore.push(sale);
  return sale;
}

function createMockPrisma() {
  const invoiceStore: Record<string, unknown>[] = [];
  const syncQueueStore: Record<string, unknown>[] = [];

  const findSale = async ({ where, include }: any) => {
    const sale = saleStore.find((s: any) => s.id === where.id) ?? null;
    if (sale && include) {
      (sale as any).items = (sale as any)._items ?? [];
      (sale as any).payments = (sale as any)._payments ?? [];
    }
    return sale;
  };

  return {
    invoice: {
      findUnique: vi.fn(async ({ where }: any) => {
        return invoiceStore.find((i: any) => i.id === where.id) ?? null;
      }),
      findMany: vi.fn(async ({ where, orderBy, take, skip }: any) => {
        let results = [...invoiceStore];
        if (where?.saleId) {
          results = results.filter((i: any) => i.saleId === where.saleId);
        }
        if (where?.status) {
          results = results.filter((i: any) => i.status === where.status);
        }
        if (orderBy?.issuedAt === "desc") {
          results.sort(
            (a: any, b: any) =>
              new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime(),
          );
        }
        return results;
      }),
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        let results = [...invoiceStore];
        if (where?.workstationId) {
          results = results.filter(
            (i: any) => i.workstationId === where.workstationId,
          );
        }
        if (where?.transmittedAt?.not === null) {
          results = results.filter((i: any) => i.transmittedAt !== null);
        }
        if (orderBy?.transmittedAt === "desc") {
          results.sort(
            (a: any, b: any) =>
              new Date(b.transmittedAt).getTime() -
              new Date(a.transmittedAt).getTime(),
          );
        }
        return results[0] ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const invoice = {
          ...data,
          id: data.id ?? "inv-new-id",
          issuedAt: data.issuedAt ?? new Date(),
          expiresAt: data.expiresAt ?? new Date(),
          transmittedAt: null,
        };
        invoiceStore.push(invoice);
        return invoice;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = invoiceStore.findIndex((i: any) => i.id === where.id);
        if (idx >= 0) {
          invoiceStore[idx] = { ...invoiceStore[idx], ...data };
          return invoiceStore[idx];
        }
        return null;
      }),
      count: vi.fn(async ({ where }: any) => {
        let results = [...invoiceStore];
        if (where?.status) {
          results = results.filter((i: any) => i.status === where.status);
        }
        return results.length;
      }),
    },
    sale: {
      findUnique: vi.fn(findSale),
    },
    contingencyEvent: {
      findFirst: vi.fn().mockResolvedValue({
        id: "contingency-event-id",
        endedAt: null,
      }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    syncQueue: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: any) => {
        const entry = { ...data, id: data.id ?? "sync-new-id" };
        syncQueueStore.push(entry);
        return entry;
      }),
    },
    $transaction: vi.fn(async (fn: any) => {
      return fn({
        invoice: {
          create: vi.fn(async ({ data }: any) => {
            const invoice = {
              ...data,
              id: data.id ?? "inv-tx-id",
              issuedAt: data.issuedAt ?? new Date(),
              expiresAt: data.expiresAt ?? new Date(),
              transmittedAt: null,
            };
            invoiceStore.push(invoice);
            return invoice;
          }),
          findMany: vi.fn(async ({ where, orderBy, take }: any) => {
            let results = [...invoiceStore];
            if (where?.saleId) {
              results = results.filter((i: any) => i.saleId === where.saleId);
            }
            return results;
          }),
          findUnique: vi.fn(async ({ where }: any) => {
            return invoiceStore.find((i: any) => i.id === where.id) ?? null;
          }),
        },
        sale: {
          findUnique: vi.fn(findSale),
        },
        syncQueue: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(async ({ data }: any) => {
            const entry = { ...data, id: data.id ?? "sync-tx-id" };
            syncQueueStore.push(entry);
            return entry;
          }),
        },
        contingencyEvent: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      });
    }),
  };
}

describe("InvoiceService", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockNumbering: any;
  let mockContingency: any;

  beforeEach(() => {
    saleStore.length = 0;
    mockPrisma = createMockPrisma();
    mockNumbering = {
      nextNumber: vi.fn(async () => "FE-WS000001-00000001"),
      ensureCounters: vi.fn(),
      initializeCounters: vi.fn(),
    };
    mockContingency = {
      isInContingency: vi.fn(async () => false),
      incrementGenerated: vi.fn(),
      incrementTransmitted: vi.fn(),
      incrementExpired: vi.fn(),
      enterContingency: vi.fn(),
      exitContingency: vi.fn(),
      hydrateStore: vi.fn(),
      startNetworkMonitor: vi.fn(),
      stopNetworkMonitor: vi.fn(),
      listHistory: vi.fn(),
    };
  });

  describe("generateInvoiceForSale", () => {
    it("throws SaleMissingForInvoiceException when sale does not exist", async () => {
      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      mockPrisma.sale.findUnique = vi.fn().mockResolvedValue(null);

      await expect(service.generateInvoiceForSale("sale-nonexistent")).rejects.toThrow(
        SaleMissingForInvoiceException,
      );
    });

    it("throws ContingencyTechKeyPlaceholderError when tech key is placeholder", async () => {
      const { isContingencyTechKeyPlaceholder } = await import("../../config/fiscal");
      vi.mocked(isContingencyTechKeyPlaceholder).mockReturnValue(true);

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      await expect(service.generateInvoiceForSale("sale-1")).rejects.toThrow(
        ContingencyTechKeyPlaceholderError,
      );

      vi.mocked(isContingencyTechKeyPlaceholder).mockReturnValue(false);
    });

    it("generates an invoice for a valid sale when online", async () => {
      seedSale();

      mockContingency.isInContingency = vi.fn(async () => false);

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      const invoice = await service.generateInvoiceForSale("sale-1");

      expect(invoice.invoiceType).toBe("ELECTRONIC_INVOICE");
      expect(invoice.status).toBe("TRANSMITTED_AUTHORIZED");
      expect(invoice.cufeProvisional).toBeTruthy();
    });

    it("generates a contingency invoice when in contingency mode", async () => {
      seedSale();

      mockContingency.isInContingency = vi.fn(async () => true);
      mockContingency.incrementGenerated = vi.fn();

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      const invoice = await service.generateInvoiceForSale("sale-1");

      expect(invoice.status).toBe("CONTINGENCY_PENDING_TRANSMISSION");
      expect(invoice.contingencyNumber).toBe("FE-WS000001-00000001");
    });
  });

  describe("generateCreditNoteForReturn", () => {
    it("generates a credit note for a return", async () => {
      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      const invoice = await service.generateCreditNoteForReturn({
        saleId: "sale-1",
        refundAmount: "10000.00",
        subtotalReturned: "8403.36",
        taxReturned: "1596.64",
        reason: "Product damaged",
        items: [
          {
            saleItemId: "item-1",
            quantity: 1,
            unitPriceAtReturn: "10000.00",
            taxAmount: "1596.64",
            totalAmount: "10000.00",
            unitPriceAtSale: "10000.00",
          },
        ],
      });

      expect(invoice.invoiceType).toBe("CREDIT_NOTE");
      expect(invoice.status).toBe("TRANSMITTED_AUTHORIZED");
    });
  });

  describe("cancelInvoice", () => {
    it("throws InvoiceNotFoundException when invoice does not exist", async () => {
      mockPrisma.invoice.findUnique = vi.fn().mockResolvedValue(null);

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      await expect(
        service.cancelInvoice("nonexistent", "Customer requested"),
      ).rejects.toThrow(InvoiceNotFoundException);
    });

    it("throws InvoiceNotCancellableException when status does not allow cancellation", async () => {
      mockPrisma.invoice.findUnique = vi.fn().mockResolvedValue({
        id: "inv-1",
        saleId: "sale-1",
        status: "EXPIRED_CONTINGENCY",
      });

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      await expect(
        service.cancelInvoice("inv-1", "Customer requested"),
      ).rejects.toThrow(InvoiceNotCancellableException);
    });

    it("creates a cancellation document and marks original as CANCELLED", async () => {
      mockPrisma.invoice.findUnique = vi.fn().mockResolvedValue({
        id: "inv-1",
        saleId: "sale-1",
        invoiceNumber: "FE-WS000001-00000001",
        status: "CONTINGENCY_PENDING_TRANSMISSION",
      });

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      const cancellation = await service.cancelInvoice("inv-1", "Customer request");

      expect(cancellation.invoiceType).toBe("CONTINGENCY_CANCELLATION");
      // Original should now be CANCELLED
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "inv-1" },
          data: { status: "CANCELLED" },
        }),
      );
    });
  });

  describe("applyTransmissionResult", () => {
    it("updates invoice status and CUFE", async () => {
      mockPrisma.invoice.update = vi.fn().mockResolvedValue({
        id: "inv-1",
        contingencyEventId: "event-1",
        status: "TRANSMITTED_AUTHORIZED",
      });

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      const result = await service.applyTransmissionResult({
        invoiceId: "inv-1",
        status: "TRANSMITTED_AUTHORIZED",
        cufeOfficial: "OFFICIAL-CUFE-HASH",
        dianXml: "<xml>...</xml>",
      });

      expect(result.status).toBe("TRANSMITTED_AUTHORIZED");
    });

    it("increments transmitted counter when contingency event exists", async () => {
      mockPrisma.invoice.update = vi.fn().mockResolvedValue({
        id: "inv-1",
        contingencyEventId: "event-1",
        status: "TRANSMITTED_AUTHORIZED",
      });

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      await service.applyTransmissionResult({
        invoiceId: "inv-1",
        status: "TRANSMITTED_AUTHORIZED",
      });

      expect(mockContingency.incrementTransmitted).toHaveBeenCalledWith("event-1");
    });
  });

  describe("findById / findBySaleId", () => {
    it("returns null for a non-existent invoice", async () => {
      mockPrisma.invoice.findUnique = vi.fn().mockResolvedValue(null);

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      const invoice = await service.findById("nonexistent");
      expect(invoice).toBeNull();
    });

    it("finds an invoice by sale ID", async () => {
      mockPrisma.invoice.findMany = vi.fn().mockResolvedValue([
        { id: "inv-1", saleId: "sale-1", invoiceType: "ELECTRONIC_INVOICE" },
      ]);

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      const invoices = await service.findBySaleId("sale-1");
      expect(invoices).toHaveLength(1);
      expect(invoices[0].id).toBe("inv-1");
    });
  });

  describe("listInvoices", () => {
    it("returns paginated results", async () => {
      mockPrisma.invoice.findMany = vi.fn().mockResolvedValue([
        {
          id: "inv-1",
          invoiceNumber: "FE-0001",
          invoiceType: "ELECTRONIC_INVOICE",
          status: "TRANSMITTED_AUTHORIZED",
          issuedAt: new Date(),
          fullData: { buyer: { name: "JUAN" }, totalAmount: "59500.00" },
        },
      ]);
      mockPrisma.invoice.count = vi.fn().mockResolvedValue(1);

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      const result = await service.listInvoices({ limit: 10, offset: 0 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("filters by status", async () => {
      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      await service.listInvoices({ status: "CONTINGENCY_PENDING_TRANSMISSION" });

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "CONTINGENCY_PENDING_TRANSMISSION" }),
        }),
      );
    });
  });

  describe("findExpiringWithin", () => {
    it("returns invoices expiring within the given window", async () => {
      const mockInvoices = [
        {
          id: "inv-expiring",
          status: "CONTINGENCY_PENDING_TRANSMISSION",
          expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
        },
      ];
      mockPrisma.invoice.findMany = vi.fn().mockResolvedValue(mockInvoices);

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      const result = await service.findExpiringWithin(4);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("inv-expiring");
    });
  });

  describe("findExpired", () => {
    it("returns expired invoices", async () => {
      const mockInvoices = [
        {
          id: "inv-expired",
          status: "CONTINGENCY_PENDING_TRANSMISSION",
          expiresAt: new Date(Date.now() - 1000), // Already expired
        },
      ];
      mockPrisma.invoice.findMany = vi.fn().mockResolvedValue(mockInvoices);

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      const result = await service.findExpired();
      expect(result).toHaveLength(1);
    });
  });

  describe("markInvoiceAsExpired", () => {
    it("throws InvoiceNotFoundException for a non-existent invoice", async () => {
      mockPrisma.invoice.findUnique = vi.fn().mockResolvedValue(null);

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      await expect(service.markInvoiceAsExpired("nonexistent")).rejects.toThrow(
        InvoiceNotFoundException,
      );
    });

    it("marks an invoice as expired and increments the contingency expired counter", async () => {
      mockPrisma.invoice.findUnique = vi.fn().mockResolvedValue({
        id: "inv-expired",
        contingencyEventId: "event-1",
      });
      mockPrisma.invoice.update = vi.fn().mockResolvedValue({
        id: "inv-expired",
        status: "EXPIRED_CONTINGENCY",
        contingencyEventId: "event-1",
      });

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      const result = await service.markInvoiceAsExpired("inv-expired");

      expect(result.status).toBe("EXPIRED_CONTINGENCY");
      expect(mockContingency.incrementExpired).toHaveBeenCalledWith("event-1");
    });
  });

  describe("queueInvoiceForTransmission", () => {
    it("throws InvoiceNotFoundException when invoice does not exist", async () => {
      mockPrisma.invoice.findUnique = vi.fn().mockResolvedValue(null);

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      await expect(service.queueInvoiceForTransmission("nonexistent")).rejects.toThrow(
        InvoiceNotFoundException,
      );
    });

    it("is a no-op when invoice is not in pending transmission status", async () => {
      mockPrisma.invoice.findUnique = vi.fn().mockResolvedValue({
        id: "inv-already-done",
        status: "TRANSMITTED_AUTHORIZED",
      });

      const service = createInvoiceService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
        numberingService: mockNumbering,
        contingencyService: mockContingency,
      });

      await service.queueInvoiceForTransmission("inv-already-done");

      // Should not call $transaction (no SyncQueue entry created)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
