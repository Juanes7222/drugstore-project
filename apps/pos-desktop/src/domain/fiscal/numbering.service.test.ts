/**
 * Tests for the fiscal numbering service.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { createFiscalNumberingService } from "./numbering.service";
import {
  FiscalCounterNotInitializedError,
  FiscalCounterExhaustedError,
} from "./exceptions";

function createMockCounter(overrides?: Record<string, unknown>) {
  return {
    id: "counter-1",
    workstationId: "ws-001",
    currentRegularNumber: 0n,
    currentContingencyNumber: 0n,
    resolutionPrefix: "FE",
    contingencyPrefix: "CONT",
    paddingLength: 8,
    authorizedStart: 1n,
    authorizedEnd: 99999999n,
    ...overrides,
  };
}

function createMockPrisma() {
  let counterStore: Record<string, unknown> | null = null;

  return {
    fiscalCounter: {
      findUnique: vi.fn(async ({ where }: { where: { workstationId: string } }) => {
        return counterStore?.workstationId === where.workstationId
          ? counterStore
          : null;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const data = { ...counterStore, ...create, ...update };
        counterStore = data;
        return data;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        counterStore = { ...counterStore, ...data };
        return counterStore;
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(async (fn: any) => fn(Promise.resolve())),
  };
}

describe("FiscalNumberingService", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
  });

  describe("ensureCounters", () => {
    it("throws FiscalCounterNotInitializedError when counters do not exist", async () => {
      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await expect(service.ensureCounters()).rejects.toThrow(
        FiscalCounterNotInitializedError,
      );
    });

    it("resolves when counters exist", async () => {
      // Pre-create counter
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(
        createMockCounter(),
      );

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await expect(service.ensureCounters()).resolves.toBeUndefined();
    });
  });

  describe("nextNumber", () => {
    it("throws FiscalCounterNotInitializedError when no counter exists", async () => {
      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await expect(
        service.nextNumber("ELECTRONIC_INVOICE", false),
      ).rejects.toThrow(FiscalCounterNotInitializedError);
    });

    it("returns the first number when counter starts at 0", async () => {
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(
        createMockCounter({ currentRegularNumber: 0n }),
      );

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const number = await service.nextNumber("ELECTRONIC_INVOICE", false);

      expect(number).toMatch(/^FE-ws-001-0+1$/);
    });

    it("increments the regular counter on each call", async () => {
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(
        createMockCounter({ currentRegularNumber: 5n }),
      );

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const number = await service.nextNumber("ELECTRONIC_INVOICE", false);

      // Should be 6 (5 + 1), formatted with padding
      expect(number).toMatch(/^FE-ws-001-0+6$/);
    });

    it("uses the contingency prefix and counter in contingency mode", async () => {
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(
        createMockCounter({ currentContingencyNumber: 2n }),
      );

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const number = await service.nextNumber("ELECTRONIC_INVOICE", true);

      // Should be 3 (2 + 1), with CONT prefix
      expect(number).toMatch(/^CONT-ws-001-0+3$/);
    });

    it("throws FiscalCounterExhaustedError when counter reaches authorized end", async () => {
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(
        createMockCounter({
          currentRegularNumber: 99999999n,
          authorizedEnd: 99999999n,
        }),
      );

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await expect(
        service.nextNumber("ELECTRONIC_INVOICE", false),
      ).rejects.toThrow(FiscalCounterExhaustedError);
    });

    it("accepts an optional transaction client", async () => {
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(
        createMockCounter({ currentRegularNumber: 0n }),
      );

      const mockTx = {
        fiscalCounter: {
          findUnique: vi.fn().mockResolvedValue(
            createMockCounter({ currentRegularNumber: 0n }),
          ),
          update: vi.fn().mockResolvedValue({}),
        },
      };

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const number = await service.nextNumber("ELECTRONIC_INVOICE", false, mockTx as any);

      expect(number).toMatch(/^FE-ws-001-0+1$/);
    });

    it("works for all invoice types", async () => {
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(
        createMockCounter({ currentRegularNumber: 0n }),
      );

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      for (const type of [
        "ELECTRONIC_INVOICE",
        "CREDIT_NOTE",
        "DEBIT_NOTE",
        "SUPPORT_DOCUMENT",
        "CONTINGENCY_CANCELLATION",
      ] as const) {
        const number = await service.nextNumber(type, false);
        expect(number).toMatch(/^FE-ws-001-/);
      }
    });
  });

  describe("initializeCounters", () => {
    it("creates a new counter via upsert", async () => {
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(null);
      const upsertSpy = vi.fn().mockResolvedValue({
        id: "counter-new",
        workstationId: "ws-001",
      });
      mockPrisma.fiscalCounter.upsert = upsertSpy;

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await service.initializeCounters({
        workstationId: "ws-001",
        currentRegularNumber: 100,
        currentContingencyNumber: 50,
        resolutionPrefix: "FE2",
        contingencyPrefix: "CONT2",
        paddingLength: 10,
        authorizedStart: 1,
        authorizedEnd: 50000,
      });

      expect(upsertSpy).toHaveBeenCalledTimes(1);
      const { where, create } = upsertSpy.mock.calls[0][0];
      expect(where.workstationId).toBe("ws-001");
      expect(create.currentRegularNumber).toBe(100n);
      expect(create.resolutionPrefix).toBe("FE2");
      expect(create.paddingLength).toBe(10);
      expect(create.authorizedEnd).toBe(50000n);
    });

    it("uses sensible defaults for optional fields", async () => {
      const upsertSpy = vi.fn().mockResolvedValue({});
      mockPrisma.fiscalCounter.upsert = upsertSpy;

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await service.initializeCounters({
        workstationId: "ws-001",
        currentRegularNumber: 1,
        currentContingencyNumber: 1,
      });

      const { create } = upsertSpy.mock.calls[0][0];
      expect(create.resolutionPrefix).toBe("FE");
      expect(create.contingencyPrefix).toBe("CONT");
      expect(create.paddingLength).toBe(8);
    });
  });
});
