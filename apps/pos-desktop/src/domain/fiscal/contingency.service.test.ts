/**
 * Tests for the contingency service.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { createContingencyService } from "./contingency.service";
import { NoActiveContingencyException } from "./exceptions";
import { useContingencyStore } from "./contingency.store";

// Mock isOnline
vi.mock("../../common/is-online", () => ({
  isOnline: vi.fn(() => true),
}));

function createMockEvent(overrides?: Record<string, unknown>) {
  return {
    id: "event-1",
    startedAt: new Date("2026-06-15T10:00:00.000Z"),
    endedAt: null,
    workstationId: "ws-001",
    trigger: "NETWORK_LOST",
    triggerReason: "Network connection lost",
    invoicesGenerated: 0,
    invoicesTransmitted: 0,
    invoicesExpired: 0,
    notifiedDian: false,
    ...overrides,
  };
}

function createMockPrisma() {
  const eventStore: Record<string, unknown>[] = [];

  return {
    contingencyEvent: {
      findFirst: vi.fn(async ({ where }: any) => {
        const match = eventStore.find(
          (e: any) =>
            e.workstationId === where.workstationId &&
            (where.endedAt === null ? e.endedAt === null : true),
        );
        return match ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const event = { ...data, endedAt: null };
        eventStore.push(event);
        return event;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = eventStore.findIndex((e: any) => e.id === where.id);
        if (idx >= 0) {
          eventStore[idx] = { ...eventStore[idx], ...data };
          return eventStore[idx];
        }
        return null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const e of eventStore) {
          const eAny = e as any;
          if (eAny.id === where.id && eAny.endedAt === null) {
            Object.assign(e, data);
            count++;
          }
        }
        return { count };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const e = eventStore.find((e: any) => e.id === where.id);
        return e ?? null;
      }),
      findMany: vi.fn(async ({ where, orderBy, take }: any) => {
        let results = [...eventStore];
        if (where?.workstationId) {
          results = results.filter(
            (e: any) => e.workstationId === where.workstationId,
          );
        }
        // Sort by startedAt desc
        results.sort(
          (a: any, b: any) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        );
        if (take) results = results.slice(0, take);
        return results;
      }),
    },
    invoice: {
      count: vi.fn(async ({ where }: any) => {
        // Return 0 for any query
        return 0;
      }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (fn: any) => fn(mockTx)),
  };
}

const mockTx = {
  contingencyEvent: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn().mockResolvedValue(null),
  },
  invoice: {
    create: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
  },
};

describe("ContingencyService", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    useContingencyStore.setState({
      active: false,
      activeEventId: null,
      triggerReason: null,
      startedAt: null,
      invoicesGenerated: 0,
      invoicesTransmitted: 0,
      invoicesExpired: 0,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("isInContingency", () => {
    it("returns false when no active event exists", async () => {
      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const result = await service.isInContingency();
      expect(result).toBe(false);
    });

    it("returns true when an active event exists", async () => {
      // Seed an active event
      mockPrisma.contingencyEvent.findFirst = vi.fn().mockResolvedValue(
        createMockEvent(),
      );

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const result = await service.isInContingency();
      expect(result).toBe(true);
    });
  });

  describe("enterContingency", () => {
    it("creates a new contingency event and updates the store", async () => {
      const createSpy = vi.fn().mockResolvedValue(
        createMockEvent({
          id: "event-new",
          startedAt: new Date(),
          triggerReason: "Server unreachable",
        }),
      );
      mockPrisma.contingencyEvent.create = createSpy;
      mockPrisma.contingencyEvent.findFirst = vi.fn().mockResolvedValue(null);

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const summary = await service.enterContingency(
        "SERVER_UNREACHABLE",
        "Cannot reach DIAN endpoint",
      );

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(summary.trigger).toBe("NETWORK_LOST");
      expect(useContingencyStore.getState().active).toBe(true);
    });

    it("returns existing active event instead of creating a duplicate", async () => {
      const existing = createMockEvent({ id: "event-existing" });
      mockPrisma.contingencyEvent.findFirst = vi.fn().mockResolvedValue(existing);

      const createSpy = vi.fn();
      mockPrisma.contingencyEvent.create = createSpy;

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const summary = await service.enterContingency(
        "NETWORK_LOST",
        "Already in contingency",
      );

      expect(createSpy).not.toHaveBeenCalled();
      expect(summary.id).toBe("event-existing");
    });
  });

  describe("exitContingency", () => {
    it("throws NoActiveContingencyException when no active event exists", async () => {
      mockPrisma.contingencyEvent.findFirst = vi.fn().mockResolvedValue(null);

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await expect(service.exitContingency()).rejects.toThrow(
        NoActiveContingencyException,
      );
    });

    it("ends the active event and computes counts", async () => {
      const activeEvent = createMockEvent({ id: "event-active" });
      mockPrisma.contingencyEvent.findFirst = vi
        .fn()
        .mockResolvedValue(activeEvent);
      mockPrisma.contingencyEvent.update = vi.fn().mockResolvedValue({
        ...activeEvent,
        endedAt: new Date(),
        invoicesGenerated: 5,
        invoicesTransmitted: 3,
      });

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      // Store should be active before exit
      useContingencyStore.getState().enter("event-active", "Test", new Date());
      const summary = await service.exitContingency();

      expect(summary.endedAt).not.toBeNull();
      expect(useContingencyStore.getState().active).toBe(false);
    });
  });

  describe("incrementGenerated", () => {
    it("increments invoicesGenerated on the active event", async () => {
      const activeEvent = createMockEvent({ id: "event-inc" });
      mockPrisma.contingencyEvent.findFirst = vi
        .fn()
        .mockResolvedValue(activeEvent);
      mockPrisma.contingencyEvent.updateMany = vi.fn().mockResolvedValue({
        count: 1,
      });
      mockPrisma.contingencyEvent.findUnique = vi.fn().mockResolvedValue({
        ...activeEvent,
        invoicesGenerated: 1,
      });

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await service.incrementGenerated("event-inc");

      expect(mockPrisma.contingencyEvent.updateMany).toHaveBeenCalledWith({
        where: { id: "event-inc", endedAt: null },
        data: { invoicesGenerated: { increment: 1 } },
      });
    });
  });

  describe("incrementTransmitted", () => {
    it("increments invoicesTransmitted on the active event", async () => {
      const activeEvent = createMockEvent({ id: "event-tx" });
      mockPrisma.contingencyEvent.updateMany = vi.fn().mockResolvedValue({
        count: 1,
      });
      mockPrisma.contingencyEvent.findUnique = vi.fn().mockResolvedValue({
        ...activeEvent,
        invoicesTransmitted: 1,
      });

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await service.incrementTransmitted("event-tx");

      expect(mockPrisma.contingencyEvent.updateMany).toHaveBeenCalledWith({
        where: { id: "event-tx", endedAt: null },
        data: { invoicesTransmitted: { increment: 1 } },
      });
    });
  });

  describe("incrementExpired", () => {
    it("increments invoicesExpired on the active event", async () => {
      const activeEvent = createMockEvent({ id: "event-exp" });
      mockPrisma.contingencyEvent.updateMany = vi.fn().mockResolvedValue({
        count: 1,
      });
      mockPrisma.contingencyEvent.findUnique = vi.fn().mockResolvedValue({
        ...activeEvent,
        invoicesExpired: 1,
      });

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await service.incrementExpired("event-exp");

      expect(mockPrisma.contingencyEvent.updateMany).toHaveBeenCalledWith({
        where: { id: "event-exp", endedAt: null },
        data: { invoicesExpired: { increment: 1 } },
      });
    });
  });

  describe("hydrateStore", () => {
    it("enters contingency when an active event exists", async () => {
      const activeEvent = createMockEvent({
        id: "event-hydrate",
        invoicesGenerated: 3,
        invoicesTransmitted: 1,
      });
      mockPrisma.contingencyEvent.findFirst = vi
        .fn()
        .mockResolvedValue(activeEvent);

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await service.hydrateStore();

      const state = useContingencyStore.getState();
      expect(state.active).toBe(true);
      expect(state.activeEventId).toBe("event-hydrate");
      expect(state.invoicesGenerated).toBe(3);
      expect(state.invoicesTransmitted).toBe(1);
    });

    it("exits contingency when no active event exists", async () => {
      mockPrisma.contingencyEvent.findFirst = vi.fn().mockResolvedValue(null);

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      await service.hydrateStore();

      expect(useContingencyStore.getState().active).toBe(false);
    });
  });

  describe("startNetworkMonitor / stopNetworkMonitor", () => {
    it("starts listening to online/offline events", () => {
      const addEventListenerSpy = vi.spyOn(window, "addEventListener");

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      service.startNetworkMonitor();

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "offline",
        expect.any(Function),
        expect.any(Object),
      );
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "online",
        expect.any(Function),
        expect.any(Object),
      );

      service.stopNetworkMonitor();
    });

    it("stops listening and clears timers", () => {
      const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
      const abortSpy = vi.spyOn(AbortController.prototype, "abort");

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      service.startNetworkMonitor();
      service.stopNetworkMonitor();

      expect(abortSpy).toHaveBeenCalled();
    });

    it("is idempotent when called multiple times", () => {
      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      expect(() => {
        service.stopNetworkMonitor();
        service.stopNetworkMonitor();
      }).not.toThrow();
    });
  });

  describe("listHistory", () => {
    it("returns an empty array when no events exist", async () => {
      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const history = await service.listHistory();

      expect(history).toEqual([]);
    });

    it("returns events sorted by startedAt descending", async () => {
      mockPrisma.contingencyEvent.findMany = vi.fn().mockResolvedValue([
        createMockEvent({
          id: "event-2",
          startedAt: new Date("2026-06-16T10:00:00.000Z"),
        }),
        createMockEvent({
          id: "event-1",
          startedAt: new Date("2026-06-15T10:00:00.000Z"),
        }),
      ]);

      const service = createContingencyService({
        prisma: mockPrisma as any,
        workstationId: "ws-001",
      });

      const history = await service.listHistory(10);

      expect(history).toHaveLength(2);
      expect(history[0].id).toBe("event-2");
      expect(history[1].id).toBe("event-1");
    });
  });
});
