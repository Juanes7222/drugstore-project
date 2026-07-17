/**
 * Tests for the printer configuration service.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  createPrinterConfigService,
  type PrinterConfigService,
} from "./printer-config.service";
import {
  PrinterNotConfiguredException,
  JobTypeAlreadyAssignedException,
  FallbackCycleException,
} from "./exceptions";
import { PrinterType, PrinterConnection, PaperSize, PrintJobType, PrinterStatusCode, type PrinterConfigInput } from "./printing-types";

function createMockPrisma() {
  const store = new Map<string, any>();

  return {
    printerConfig: {
      findMany: vi.fn(async (_args?: any) => Array.from(store.values())),
      findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) =>
        store.get(id) ?? null,
      ),
      findFirst: vi.fn(async (args?: any) => {
        if (args?.where?.systemName) {
          return Array.from(store.values()).find(
            (p) => p.systemName === args.where.systemName,
          ) ?? null;
        }
        if (args?.where?.assignedJobs?.has) {
          const excludeId = args?.where?.id?.not;
          return Array.from(store.values()).find(
            (p) =>
              p.assignedJobs?.includes(args.where.assignedJobs.has) &&
              p.id !== excludeId,
          ) ?? null;
        }
        return Array.from(store.values())[0] ?? null;
      }),
      create: vi.fn(async (args: any) => {
        const record = { ...args.data, id: args.data.id ?? crypto.randomUUID() };
        store.set(record.id, record);
        return record;
      }),
      update: vi.fn(async ({ where: { id }, data }: any) => {
        const existing = store.get(id);
        if (!existing) throw new Error("Not found");
        const updated = { ...existing, ...data };
        store.set(id, updated);
        return updated;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        for (const [id, record] of store) {
          if (where.fallbackPrinterId === id) {
            store.set(id, { ...record, ...data });
          }
        }
        return { count: store.size };
      }),
      delete: vi.fn(async ({ where: { id } }: any) => {
        store.delete(id);
      }),
      count: vi.fn(async () => store.size),
    },
    printJob: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (cb: any) => cb(store)),
  };
}

describe("PrinterConfigService", () => {
  let service: PrinterConfigService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  const validInput: PrinterConfigInput = {
    friendlyName: "Impresora Principal",
    systemName: "EPSON-TM-T20",
    printerType: PrinterType.THERMAL_RECEIPT,
    connection: PrinterConnection.USB,
    paperSize: PaperSize.RECEIPT_80MM,
    supportsColor: false,
    assignedJobs: ["SALE_RECEIPT"],
  };

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = createPrinterConfigService(mockPrisma as any);
  });

  describe("create", () => {
    it("creates a printer with the given input", async () => {
      const printer = await service.create(validInput);

      expect(printer.friendlyName).toBe("Impresora Principal");
      expect(printer.printerType).toBe(PrinterType.THERMAL_RECEIPT);
      expect(printer.status).toBe("UNKNOWN");
      expect(printer.id).toBeTruthy();
    });

    it("assigns default values for optional fields", async () => {
      const printer = await service.create(validInput);

      expect(printer.supportsDuplex).toBe(false);
      expect(printer.serverFallbackEnabled).toBe(false);
    });
  });

  describe("listAll", () => {
    it("returns empty array when no printers exist", async () => {
      const printers = await service.listAll();

      expect(printers).toEqual([]);
    });

    it("returns all created printers", async () => {
      await service.create(validInput);
      await service.create({
        ...validInput,
        friendlyName: "Impresora Secundaria",
        systemName: "EPSON-TM-T88",
      });

      const printers = await service.listAll();
      expect(printers).toHaveLength(2);
    });
  });

  describe("getById", () => {
    it("returns the printer when found", async () => {
      const created = await service.create(validInput);

      const printer = await service.getById(created.id);
      expect(printer.id).toBe(created.id);
    });

    it("throws PrinterNotConfiguredException when not found", async () => {
      await expect(service.getById("nonexistent")).rejects.toThrow(
        PrinterNotConfiguredException,
      );
    });
  });

  describe("update", () => {
    it("updates printer fields", async () => {
      const created = await service.create(validInput);

      const updated = await service.update(created.id, { friendlyName: "Nuevo Nombre" });

      expect(updated.friendlyName).toBe("Nuevo Nombre");
    });

    it("throws when updating non-existent printer", async () => {
      await expect(
        service.update("nonexistent", { friendlyName: "Test" }),
      ).rejects.toThrow(PrinterNotConfiguredException);
    });

    it("throws JobTypeAlreadyAssignedException when assigning an already-assigned job type", async () => {
      const p1 = await service.create(validInput);
      const p2 = await service.create({
        ...validInput,
        friendlyName: "Otra",
        systemName: "OTHER",
        assignedJobs: ["LABEL_PRINT"],
      });

      // Update p2 to also assign SALE_RECEIPT which p1 has
      mockPrisma.printerConfig.findFirst.mockResolvedValueOnce(p1);

      await expect(
        service.update(p2.id, { assignedJobs: ["LABEL_PRINT", "SALE_RECEIPT"] }),
      ).rejects.toThrow(JobTypeAlreadyAssignedException);
    });
  });

  describe("delete", () => {
    it("deletes a printer and cleans up references", async () => {
      const created = await service.create(validInput);

      await service.delete(created.id);

      await expect(service.getById(created.id)).rejects.toThrow(
        PrinterNotConfiguredException,
      );
    });
  });

  describe("getPrinterForJobType", () => {
    it("returns the printer assigned to a job type", async () => {
      await service.create(validInput);

      const printer = await service.getPrinterForJobType(PrintJobType.SALE_RECEIPT);
      expect(printer).not.toBeNull();
      expect(printer!.assignedJobs).toContain(PrintJobType.SALE_RECEIPT);
    });

    it("returns null when no printer is assigned", async () => {
      const printer = await service.getPrinterForJobType(PrintJobType.LABEL_PRINT);
      expect(printer).toBeNull();
    });
  });

  describe("resolvePrinterWithFallback", () => {
    it("returns the primary printer without fallback when online", async () => {
      const created = await service.create(validInput);

      const result = await service.resolvePrinterWithFallback(PrintJobType.SALE_RECEIPT, [
        created.id,
      ]);
      expect(result).not.toBeNull();
      expect(result!.printer.id).toBe(created.id);
      expect(result!.usedFallback).toBe(false);
    });

    it("returns null when no printer configured for job type", async () => {
      const result = await service.resolvePrinterWithFallback(PrintJobType.LABEL_PRINT);
      expect(result).toBeNull();
    });
  });

  describe("updateStatus", () => {
    it("updates the printer status", async () => {
      const created = await service.create(validInput);

      await service.updateStatus(created.id, PrinterStatusCode.ONLINE);

      const printer = await service.getById(created.id);
      expect(printer.status).toBe(PrinterStatusCode.ONLINE);
    });

    it("sets lastErrorMessage when provided", async () => {
      const created = await service.create(validInput);

      await service.updateStatus(created.id, PrinterStatusCode.ERROR, "Paper jam");

      const printer = await service.getById(created.id);
      expect(printer.lastErrorMessage).toBe("Paper jam");
    });
  });

  describe("hasAnyConfigured", () => {
    it("returns false when no printers exist", async () => {
      expect(await service.hasAnyConfigured()).toBe(false);
    });

    it("returns true when at least one printer exists", async () => {
      await service.create(validInput);

      expect(await service.hasAnyConfigured()).toBe(true);
    });
  });

  describe("findBySystemName", () => {
    it("finds a printer by system name", async () => {
      await service.create(validInput);

      const printer = await service.findBySystemName("EPSON-TM-T20");
      expect(printer).not.toBeNull();
      expect(printer!.systemName).toBe("EPSON-TM-T20");
    });

    it("returns null when not found", async () => {
      const printer = await service.findBySystemName("UNKNOWN");
      expect(printer).toBeNull();
    });
  });

  describe("setCashDrawerConfig", () => {
    it("sets the cash drawer JSON config", async () => {
      const created = await service.create(validInput);

      const printer = await service.setCashDrawerConfig(created.id, '{"hasDrawer":true}');

      expect(printer.cashDrawerConfig).toBe('{"hasDrawer":true}');
    });

    it("throws when printer does not exist", async () => {
      await expect(
        service.setCashDrawerConfig("nonexistent", "{}"),
      ).rejects.toThrow(PrinterNotConfiguredException);
    });
  });

  describe("setReceiptTemplate", () => {
    it("sets the receipt template id", async () => {
      const created = await service.create(validInput);

      const printer = await service.setReceiptTemplate(created.id, "template-1");

      expect(printer.receiptTemplateId).toBe("template-1");
    });
  });

  describe("updatePrinterAssignments", () => {
    it("updates the job type assignments", async () => {
      const created = await service.create(validInput);

      const printer = await service.updatePrinterAssignments(created.id, [
        "SALE_RECEIPT",
        "LABEL_PRINT",
      ]);

      expect(printer.assignedJobs).toContain("LABEL_PRINT");
    });
  });

  describe("setFallbackChain", () => {
    it("sets the fallback chain", async () => {
      const p1 = await service.create(validInput);
      const p2 = await service.create({
        ...validInput,
        friendlyName: "Fallback",
        systemName: "FALLBACK",
        assignedJobs: [],
      });

      const printer = await service.setFallbackChain(p1.id, p2.id, true);

      expect(printer.fallbackPrinterId).toBe(p2.id);
      expect(printer.serverFallbackEnabled).toBe(true);
    });

    it("detects cycles in fallback chain", async () => {
      const p1 = await service.create(validInput);

      // Make p1's fallback itself
      mockPrisma.printerConfig.findUnique.mockResolvedValue({
        id: p1.id,
        fallbackPrinterId: p1.id,
      } as any);

      await expect(
        service.setFallbackChain(p1.id, p1.id, false),
      ).rejects.toThrow(FallbackCycleException);
    });
  });
});
