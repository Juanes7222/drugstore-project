/**
 * Tests for the fiscal numbering service.
 *
 * `nextNumber` reserves via a single conditional UPDATE..RETURNING
 * (`$queryRawUnsafe`), so these tests mock that call for the success path
 * and `fiscalCounter.findUnique` only for the not-initialized/exhausted
 * branches.
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

function createQueryRow(overrides?: Record<string, unknown>) {
  return {
    resolutionPrefix: "FE",
    contingencyPrefix: "CONT",
    paddingLength: 8,
    next: 1n,
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
      upsert: vi.fn(async ({ create, update }: any) => {
        const data = { ...counterStore, ...create, ...update };
        counterStore = data;
        return data;
      }),
      update: vi.fn(async ({ data }: any) => {
        counterStore = { ...counterStore, ...data };
        return counterStore;
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $queryRawUnsafe: vi.fn(),
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
      vi.mocked(mockPrisma.$queryRawUnsafe).mockResolvedValue([]);
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(null);

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await expect(
        service.nextNumber("ELECTRONIC_INVOICE", false),
      ).rejects.toThrow(FiscalCounterNotInitializedError);
    });

    it("returns the first number when counter starts at 0", async () => {
      vi.mocked(mockPrisma.$queryRawUnsafe).mockResolvedValue([
        createQueryRow({ next: 1n }),
      ]);

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const number = await service.nextNumber("ELECTRONIC_INVOICE", false);

      expect(number).toMatch(/^FE-ws-001-0+1$/);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
      const [sql, workstationId] = vi.mocked(mockPrisma.$queryRawUnsafe).mock
        .calls[0];
      expect(sql).toContain("currentRegularNumber");
      expect(workstationId).toBe("ws-001");
    });

    it("increments the regular counter on each call", async () => {
      vi.mocked(mockPrisma.$queryRawUnsafe).mockResolvedValue([
        createQueryRow({ next: 6n }),
      ]);

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const number = await service.nextNumber("ELECTRONIC_INVOICE", false);

      // Should be 6, formatted with padding
      expect(number).toMatch(/^FE-ws-001-0+6$/);
    });

    it("uses the contingency prefix and counter in contingency mode", async () => {
      vi.mocked(mockPrisma.$queryRawUnsafe).mockResolvedValue([
        createQueryRow({ next: 3n }),
      ]);

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const number = await service.nextNumber("ELECTRONIC_INVOICE", true);

      // Should be 3 (2 + 1), with CONT prefix
      expect(number).toMatch(/^CONT-ws-001-0+3$/);
      const [sql] = vi.mocked(mockPrisma.$queryRawUnsafe).mock.calls[0];
      expect(sql).toContain("currentContingencyNumber");
    });

    it("throws FiscalCounterExhaustedError when counter reaches authorized end", async () => {
      vi.mocked(mockPrisma.$queryRawUnsafe).mockResolvedValue([]);
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
      const mockTx = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([
          createQueryRow({ next: 1n }),
        ]),
        fiscalCounter: {
          findUnique: vi.fn(),
        },
      };

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const number = await service.nextNumber("ELECTRONIC_INVOICE", false, mockTx as any);

      expect(number).toMatch(/^FE-ws-001-0+1$/);
      expect(mockTx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it("works for all invoice types", async () => {
      vi.mocked(mockPrisma.$queryRawUnsafe).mockResolvedValue([
        createQueryRow({ next: 1n }),
      ]);

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

    it("never hands the same number to two concurrent callers", async () => {
      // Simulate the atomic UPDATE..RETURNING at the mock level: a shared
      // in-memory counter incremented inside the mocked query, with a small
      // async yield so the two overlapping calls interleave.
      let current = 0n;
      vi.mocked(mockPrisma.$queryRawUnsafe).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        current += 1n;
        return [
          createQueryRow({ next: current }),
        ];
      });

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const [first, second] = await Promise.all([
        service.nextNumber("ELECTRONIC_INVOICE", false),
        service.nextNumber("ELECTRONIC_INVOICE", false),
      ]);

      expect(first).not.toBe(second);
      expect([first, second].sort()).toEqual([
        "FE-ws-001-00000001",
        "FE-ws-001-00000002",
      ]);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it("does not consume a number when the range is exhausted", async () => {
      // First call: the conditional UPDATE reserves nothing (range at its
      // end), so the service throws without incrementing. After the range
      // is extended, the next reservation continues the sequence instead
      // of skipping a number.
      vi.mocked(mockPrisma.$queryRawUnsafe)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([createQueryRow({ next: 6n })]);
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(
        createMockCounter({
          currentRegularNumber: 5n,
          authorizedEnd: 5n,
        }),
      );

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await expect(
        service.nextNumber("ELECTRONIC_INVOICE", false),
      ).rejects.toThrow(FiscalCounterExhaustedError);

      const number = await service.nextNumber("ELECTRONIC_INVOICE", false);

      expect(number).toMatch(/^FE-ws-001-0+6$/);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
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

  describe("syncFromResolution", () => {
    it("creates counters with the resolution range and next regular number when none exist", async () => {
      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const result = await service.syncFromResolution({
        prefix: "FE",
        authorizedStart: 1000,
        authorizedEnd: 1999,
        nextRegularNumber: 1001,
      });

      expect(result).toEqual({ changed: true });
      const { create } = vi.mocked(mockPrisma.fiscalCounter.upsert).mock
        .calls[0][0];
      expect(create.workstationId).toBe("ws-001");
      expect(create.resolutionPrefix).toBe("FE");
      expect(create.currentRegularNumber).toBe(1001n);
      expect(create.currentContingencyNumber).toBe(1n);
      expect(create.authorizedStart).toBe(1000n);
      expect(create.authorizedEnd).toBe(1999n);
    });

    it("advances only the regular counter when the server consecutive is ahead on the same resolution", async () => {
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(
        createMockCounter({
          currentRegularNumber: 1005n,
          currentContingencyNumber: 7n,
          authorizedStart: 1000n,
          authorizedEnd: 1999n,
        }),
      );

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const result = await service.syncFromResolution({
        prefix: "FE",
        authorizedStart: 1000,
        authorizedEnd: 1999,
        nextRegularNumber: 1010,
      });

      expect(result).toEqual({ changed: true });
      const { data } = vi.mocked(mockPrisma.fiscalCounter.update).mock
        .calls[0][0];
      expect(data.currentRegularNumber).toBe(1010n);
      expect(data).not.toHaveProperty("currentContingencyNumber");
      expect(mockPrisma.fiscalCounter.upsert).not.toHaveBeenCalled();
    });

    it("never rewinds the regular counter when the POS is ahead after an offline contingency", async () => {
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(
        createMockCounter({
          currentRegularNumber: 1010n,
          currentContingencyNumber: 5n,
          authorizedStart: 1000n,
          authorizedEnd: 1999n,
        }),
      );

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const result = await service.syncFromResolution({
        prefix: "FE",
        authorizedStart: 1000,
        authorizedEnd: 1999,
        nextRegularNumber: 1008,
      });

      expect(result).toEqual({ changed: false });
      expect(mockPrisma.fiscalCounter.update).not.toHaveBeenCalled();
      expect(mockPrisma.fiscalCounter.upsert).not.toHaveBeenCalled();
    });

    it("resets the regular counter when the range changes but the prefix stays the same", async () => {
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(
        createMockCounter({
          resolutionPrefix: "FE",
          currentRegularNumber: 1500n,
          currentContingencyNumber: 9n,
          authorizedStart: 1000n,
          authorizedEnd: 1999n,
        }),
      );

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const result = await service.syncFromResolution({
        prefix: "FE",
        authorizedStart: 5000,
        authorizedEnd: 5999,
        nextRegularNumber: 5001,
      });

      expect(result).toEqual({ changed: true });
      const { update } = vi.mocked(mockPrisma.fiscalCounter.upsert).mock
        .calls[0][0];
      expect(update.currentRegularNumber).toBe(5001n);
      expect(update.currentContingencyNumber).toBe(9n);
      expect(update.resolutionPrefix).toBe("FE");
      expect(update.authorizedStart).toBe(5000n);
      expect(update.authorizedEnd).toBe(5999n);
    });

    it("resets the regular counter to the server consecutive and preserves the contingency counter on a new resolution", async () => {
      mockPrisma.fiscalCounter.findUnique = vi.fn().mockResolvedValue(
        createMockCounter({
          resolutionPrefix: "FE",
          currentRegularNumber: 1500n,
          currentContingencyNumber: 9n,
          authorizedStart: 1000n,
          authorizedEnd: 1999n,
        }),
      );

      const service = createFiscalNumberingService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const result = await service.syncFromResolution({
        prefix: "FE2",
        authorizedStart: 5000,
        authorizedEnd: 5999,
        nextRegularNumber: 5001,
      });

      expect(result).toEqual({ changed: true });
      const { update } = vi.mocked(mockPrisma.fiscalCounter.upsert).mock
        .calls[0][0];
      expect(update.currentRegularNumber).toBe(5001n);
      expect(update.currentContingencyNumber).toBe(9n);
      expect(update.resolutionPrefix).toBe("FE2");
      expect(update.authorizedStart).toBe(5000n);
      expect(update.authorizedEnd).toBe(5999n);
    });
  });
});
