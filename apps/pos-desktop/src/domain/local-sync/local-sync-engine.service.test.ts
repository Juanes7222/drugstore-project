/**
 * Tests for LocalSyncEngine — automatic LAN relay.
 *
 * Covers push/pull phases, skip logic, priority ordering,
 * dedup and per-row error isolation, reentrancy guard,
 * and onCycleResult propagation.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@pharmacy/database/local";

// ---------------------------------------------------------------------------
// Hoisted mock for Tauri invoke — must be defined before vi.mock is hoisted
// ---------------------------------------------------------------------------
const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => (mockInvoke as unknown as (...a: unknown[]) => unknown)(...args),
}));

import { createLocalSyncEngine } from "./local-sync-engine.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRelayableEntry(overrides: Partial<{
  id: string;
  operationUuid: string;
  operationType: string;
  payload: string;
  payloadHash: string;
  sourceWorkstationId: string;
  sourceCreatedAt: Date;
  retryCount: number;
}> = {}) {
  return {
    id: `id-${overrides.operationUuid ?? "op-1"}`,
    operationUuid: overrides.operationUuid ?? "op-1",
    operationType: overrides.operationType ?? "SALE_CONFIRMATION",
    payload: overrides.payload ?? JSON.stringify({ total: 100 }),
    payloadHash: overrides.payloadHash ?? "hash-1",
    sourceWorkstationId: overrides.sourceWorkstationId ?? "ws-1",
    sourceCreatedAt: overrides.sourceCreatedAt ?? new Date("2026-01-10T10:00:00.000Z"),
    retryCount: overrides.retryCount ?? 0,
    // extra fields the prisma row carries but the engine strips to RelayableEntry
    lanRelayedAt: null,
    status: "PENDING",
    clientSequence: 1n,
    ...overrides,
  } as unknown as Record<string, unknown>;
}

function makePrismaMock(overrides: {
  findManyImpl?: ReturnType<typeof vi.fn>;
  updateManyImpl?: ReturnType<typeof vi.fn>;
  createImpl?: ReturnType<typeof vi.fn>;
} = {}) {
  const findMany = overrides.findManyImpl ?? vi.fn().mockResolvedValue([]);
  const updateMany = overrides.updateManyImpl ?? vi.fn().mockResolvedValue({ count: 0 });
  const create = overrides.createImpl ?? vi.fn().mockResolvedValue({});
  const prisma = {
    syncQueue: {
      findMany,
      updateMany,
      create,
    },
  } as unknown as import("@pharmacy/database/local").PrismaClient;
  return { prisma, findMany, updateMany, create };
}

function hubStatus(overrides: Partial<{ currentHubAddress: string | null; backoffUntil: string | null }> = {}) {
  return {
    currentHubAddress: "192.168.1.10:49500",
    backoffUntil: null,
    ...overrides,
  };
}

function pullOps(...ops: Array<Partial<Record<string, unknown>>>) {
  return ops.map((o) => ({
    operationUuid: "uuid-x",
    operationType: "SALE_CONFIRMATION",
    payload: JSON.stringify({ total: 1 }),
    payloadHash: "hash-x",
    sourceWorkstationId: "ws-other",
    sourceCreatedAt: new Date().toISOString(),
    retryCount: 0,
    ...o,
  }));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("createLocalSyncEngine", () => {
  const workstationId = "ws-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockReset();
    // Default: hub present, nothing to push/pull
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_local_sync_status") return hubStatus();
      if (cmd === "push_to_hub") return { acceptedOperationUuids: [], accepted: 0, rejected: 0, conflicts: [] };
      if (cmd === "pull_from_hub") return { operations: [], nextSince: new Date().toISOString() };
      return null as unknown;
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Skip conditions
  // -------------------------------------------------------------------------

  describe("runCycle — skip conditions", () => {
    it("skips cycle when currentHubAddress is null", async () => {
      const { prisma, findMany } = makePrismaMock();
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus({ currentHubAddress: null });
        throw new Error("should not be called");
      });

      const engine = createLocalSyncEngine({ prisma, workstationId });

      const result = await engine.runCycle();

      expect(result.outcome).toBe("skipped-no-hub");
      expect(result.pushedToHub).toBe(0);
      expect(result.adoptedFromHub).toBe(0);
      expect(findMany).not.toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalledWith("get_local_sync_status");
    });

    it("skips cycle when invoke throws (non-Tauri environment)", async () => {
      const { prisma, findMany } = makePrismaMock();
      mockInvoke.mockRejectedValueOnce(new Error("command not found"));

      const engine = createLocalSyncEngine({ prisma, workstationId });

      const result = await engine.runCycle();

      expect(result.outcome).toBe("skipped-no-hub");
      expect(findMany).not.toHaveBeenCalled();
    });

    it("skips cycle when backoffUntil is in the future", async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const { prisma, findMany } = makePrismaMock();
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus({ backoffUntil: future });
        throw new Error("should not be called");
      });

      const engine = createLocalSyncEngine({ prisma, workstationId });

      const result = await engine.runCycle();

      expect(result.outcome).toBe("skipped-no-hub");
      expect(findMany).not.toHaveBeenCalled();
    });

    it("does not skip when backoffUntil is in the past", async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const { prisma } = makePrismaMock();
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus({ backoffUntil: past });
        if (cmd === "push_to_hub") return { acceptedOperationUuids: [], accepted: 0, rejected: 0, conflicts: [] };
        if (cmd === "pull_from_hub") return { operations: [], nextSince: new Date().toISOString() };
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId });

      const result = await engine.runCycle();

      expect(result.outcome).toBe("ok");
    });

    it("does not skip when backoffUntil is invalid date", async () => {
      const { prisma } = makePrismaMock();
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus({ backoffUntil: "not-a-date" });
        if (cmd === "push_to_hub") return { acceptedOperationUuids: [], accepted: 0, rejected: 0, conflicts: [] };
        if (cmd === "pull_from_hub") return { operations: [], nextSince: new Date().toISOString() };
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId });

      const result = await engine.runCycle();

      expect(result.outcome).toBe("ok");
    });
  });

  // -------------------------------------------------------------------------
  // Push phase
  // -------------------------------------------------------------------------

  describe("runCycle — push phase", () => {
    it("marks exactly the accepted uuids as relayed", async () => {
      const entries = [
        makeRelayableEntry({ operationUuid: "uuid-1", id: "id-1" }),
        makeRelayableEntry({ operationUuid: "uuid-2", id: "id-2" }),
        makeRelayableEntry({ operationUuid: "uuid-3", id: "id-3" }),
      ];
      const findMany = vi.fn().mockResolvedValue(entries);
      const updateMany = vi.fn().mockResolvedValue({ count: 2 });
      const { prisma } = makePrismaMock({ findManyImpl: findMany, updateManyImpl: updateMany });

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus();
        if (cmd === "push_to_hub") return { acceptedOperationUuids: ["uuid-1", "uuid-3"], accepted: 2, rejected: 1, conflicts: [] };
        if (cmd === "pull_from_hub") return { operations: [], nextSince: new Date().toISOString() };
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId });

      const result = await engine.runCycle();

      expect(result.pushedToHub).toBe(2);
      expect(updateMany).toHaveBeenCalledOnce();
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["id-1", "id-3"] } },
        data: { lanRelayedAt: expect.any(Date) },
      });
      // uuid-2 must NOT be in the relayed ids
      const inArg = (updateMany.mock.calls[0][0] as { where: { id: { in: string[] } } }).where.id.in;
      expect(inArg).not.toContain("id-2");
    });

    it("leaves entry unmarked when hub omits it (disk-full rejection)", async () => {
      const entries = [
        makeRelayableEntry({ operationUuid: "uuid-disk-full", id: "id-disk" }),
      ];
      const findMany = vi.fn().mockResolvedValue(entries);
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const { prisma } = makePrismaMock({ findManyImpl: findMany, updateManyImpl: updateMany });

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus();
        if (cmd === "push_to_hub") return { acceptedOperationUuids: [], accepted: 0, rejected: 1, conflicts: [] };
        if (cmd === "pull_from_hub") return { operations: [], nextSince: new Date().toISOString() };
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId });

      const result = await engine.runCycle();

      expect(result.pushedToHub).toBe(0);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it("does not call updateMany when no entries are relayable", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const { prisma } = makePrismaMock({ findManyImpl: findMany, updateManyImpl: updateMany });

      const engine = createLocalSyncEngine({ prisma, workstationId });

      const result = await engine.runCycle();

      expect(result.pushedToHub).toBe(0);
      expect(updateMany).not.toHaveBeenCalled();
      // push_to_hub should not be invoked when nothing to push
      expect(mockInvoke).not.toHaveBeenCalledWith("push_to_hub", expect.anything());
    });

    it("sends operations ordered by OPERATION_PRIORITY (PRODUCT_CREATION before SALE)", async () => {
      // Provide entries in reverse priority order to ensure sorting is applied
      const sale = makeRelayableEntry({
        operationUuid: "uuid-sale",
        id: "id-sale",
        operationType: "SALE_CONFIRMATION",
        sourceCreatedAt: new Date("2026-01-10T10:00:00.000Z"),
      });
      const product = makeRelayableEntry({
        operationUuid: "uuid-product",
        id: "id-product",
        operationType: "PRODUCT_CREATION",
        sourceCreatedAt: new Date("2026-01-10T11:00:00.000Z"),
      });
      const findMany = vi.fn().mockResolvedValue([sale, product]);
      const { prisma } = makePrismaMock({ findManyImpl: findMany });

      let pushedOps: Array<{ operationUuid: string }> | null = null;
      mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "get_local_sync_status") return hubStatus();
        if (cmd === "push_to_hub") {
          pushedOps = (args as { operations: Array<{ operationUuid: string }> }).operations;
          return { acceptedOperationUuids: pushedOps.map((o) => o.operationUuid), accepted: pushedOps.length, rejected: 0, conflicts: [] };
        }
        if (cmd === "pull_from_hub") return { operations: [], nextSince: new Date().toISOString() };
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId });

      await engine.runCycle();

      expect(pushedOps).not.toBeNull();
      expect(pushedOps!.map((o) => o.operationUuid)).toEqual(["uuid-product", "uuid-sale"]);
    });
  });

  // -------------------------------------------------------------------------
  // Pull phase
  // -------------------------------------------------------------------------

  describe("runCycle — pull phase", () => {
    it("filters out operations from own workstation", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const create = vi.fn().mockResolvedValue({});
      const { prisma } = makePrismaMock({ findManyImpl: findMany, createImpl: create });

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus();
        if (cmd === "push_to_hub") return { acceptedOperationUuids: [], accepted: 0, rejected: 0, conflicts: [] };
        if (cmd === "pull_from_hub")
          return {
            operations: pullOps(
              { operationUuid: "uuid-own", sourceWorkstationId: "ws-1" },
              { operationUuid: "uuid-other", sourceWorkstationId: "ws-2" },
            ),
            nextSince: new Date().toISOString(),
          };
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId });

      const result = await engine.runCycle();

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ operationUuid: "uuid-other" }),
        }),
      );
      expect(result.adoptedFromHub).toBe(1);
    });

    it("skips duplicate operations via P2002 without aborting", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const dupError = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "test",
      } as never);
      const create = vi
        .fn()
        .mockRejectedValueOnce(dupError)
        .mockResolvedValueOnce({});
      const { prisma } = makePrismaMock({ findManyImpl: findMany, createImpl: create });

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus();
        if (cmd === "push_to_hub") return { acceptedOperationUuids: [], accepted: 0, rejected: 0, conflicts: [] };
        if (cmd === "pull_from_hub")
          return {
            operations: pullOps({ operationUuid: "uuid-dup" }, { operationUuid: "uuid-new" }),
            nextSince: new Date().toISOString(),
          };
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId: "ws-1" });

      const result = await engine.runCycle();

      expect(create).toHaveBeenCalledTimes(2);
      expect(result.adoptedFromHub).toBe(1);
    });

    it("does not abort remaining adopts when one row throws a generic error", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const genericError = new Error("malformed payload");
      const create = vi
        .fn()
        .mockRejectedValueOnce(genericError)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      const { prisma } = makePrismaMock({ findManyImpl: findMany, createImpl: create });

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus();
        if (cmd === "push_to_hub") return { acceptedOperationUuids: [], accepted: 0, rejected: 0, conflicts: [] };
        if (cmd === "pull_from_hub")
          return {
            operations: pullOps({ operationUuid: "uuid-bad" }, { operationUuid: "uuid-2" }, { operationUuid: "uuid-3" }),
            nextSince: new Date().toISOString(),
          };
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId: "ws-1" });

      const result = await engine.runCycle();

      expect(create).toHaveBeenCalledTimes(3);
      expect(result.adoptedFromHub).toBe(2);
      expect(console.warn).toHaveBeenCalled();
    });

    it("adopts foreign ops as PENDING with clientSequence and payload", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const create = vi.fn().mockResolvedValue({});
      const { prisma } = makePrismaMock({ findManyImpl: findMany, createImpl: create });

      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus();
        if (cmd === "push_to_hub") return { acceptedOperationUuids: [], accepted: 0, rejected: 0, conflicts: [] };
        if (cmd === "pull_from_hub")
          return {
            operations: pullOps({
              operationUuid: "uuid-foreign",
              operationType: "CLIENT_CREATION",
              payload: '{"name":"Alice"}',
              payloadHash: "hash-alice",
              sourceWorkstationId: "ws-99",
              sourceCreatedAt: "2026-01-15T12:00:00.000Z",
            }),
            nextSince: new Date().toISOString(),
          };
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId: "ws-1" });

      await engine.runCycle();

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationUuid: "uuid-foreign",
            operationType: "CLIENT_CREATION",
            payload: '{"name":"Alice"}',
            status: "PENDING",
            sourceWorkstationId: "ws-99",
            lanRelayedAt: expect.any(Date),
            clientSequence: expect.any(BigInt),
          }),
        }),
      );
      // clientSequence should be Date.now()*1000 + idx
      const seq = (create.mock.calls[0][0] as { data: { clientSequence: bigint } }).data.clientSequence;
      expect(seq).toBe(BigInt(1700000000000 * 1000 + 0));

      nowSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // onCycleResult
  // -------------------------------------------------------------------------

  describe("onCycleResult", () => {
    it("receives ok outcome after successful push+pull", async () => {
      const entries = [makeRelayableEntry({ operationUuid: "uuid-1", id: "id-1" })];
      const findMany = vi.fn().mockResolvedValue(entries);
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const create = vi.fn().mockResolvedValue({});
      const { prisma } = makePrismaMock({ findManyImpl: findMany, updateManyImpl: updateMany, createImpl: create });
      const onCycleResult = vi.fn();

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus();
        if (cmd === "push_to_hub") return { acceptedOperationUuids: ["uuid-1"], accepted: 1, rejected: 0, conflicts: [] };
        if (cmd === "pull_from_hub") return { operations: pullOps({ operationUuid: "uuid-x" }), nextSince: new Date().toISOString() };
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId, onCycleResult });

      const result = await engine.runCycle();

      expect(result.outcome).toBe("ok");
      expect(onCycleResult).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "ok", pushedToHub: 1, adoptedFromHub: 1 }),
      );
    });

    it("receives skipped-no-hub outcome when there is no hub", async () => {
      const { prisma } = makePrismaMock();
      const onCycleResult = vi.fn();
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus({ currentHubAddress: null });
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId, onCycleResult });

      const result = await engine.runCycle();

      expect(result.outcome).toBe("skipped-no-hub");
      expect(onCycleResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: "skipped-no-hub" }));
    });

    it("receives error outcome when push throws", async () => {
      const entries = [makeRelayableEntry({ operationUuid: "uuid-1" })];
      const findMany = vi.fn().mockResolvedValue(entries);
      const { prisma } = makePrismaMock({ findManyImpl: findMany });
      const onCycleResult = vi.fn();

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") return hubStatus();
        if (cmd === "push_to_hub") throw new Error("network down");
        if (cmd === "pull_from_hub") return { operations: [], nextSince: new Date().toISOString() };
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId, onCycleResult });

      const result = await engine.runCycle();

      expect(result.outcome).toBe("error");
      expect(result.errorMessage).toMatch(/network down/);
      expect(onCycleResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error" }));
    });
  });

  // -------------------------------------------------------------------------
  // Reentrancy guard (tick)
  // -------------------------------------------------------------------------

  describe("reentrancy guard", () => {
    it("does not run overlapping tick cycles while one is in flight", async () => {
      vi.useFakeTimers();

      // Need a pending push so the first tick stays in-flight.
      const entries = [makeRelayableEntry({ operationUuid: "uuid-1", id: "id-1" })];
      const findMany = vi.fn().mockResolvedValue(entries);
      const { prisma } = makePrismaMock({ findManyImpl: findMany });

      let resolvePush: (v: unknown) => void = () => undefined;
      const pushPromise = new Promise((res) => {
        resolvePush = res as (v: unknown) => void;
      });

      let invokeCount = 0;
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status") {
          invokeCount += 1;
          return hubStatus();
        }
        if (cmd === "push_to_hub") {
          return pushPromise as unknown as { acceptedOperationUuids: string[] };
        }
        if (cmd === "pull_from_hub") return { operations: [], nextSince: new Date().toISOString() };
        return null as unknown;
      });

      const engine = createLocalSyncEngine({ prisma, workstationId, intervalMs: 20 });

      engine.start();

      await vi.advanceTimersByTimeAsync(8000);
      // First cycle is now in-flight (waiting on pushPromise)

      await vi.advanceTimersByTimeAsync(25);
      await vi.advanceTimersByTimeAsync(25);

      expect(invokeCount).toBe(1);

      resolvePush({ acceptedOperationUuids: [], accepted: 0, rejected: 0, conflicts: [] });
      await vi.advanceTimersByTimeAsync(0);

      // After completion, scheduleNext(intervalMs) will fire the next tick
      await vi.advanceTimersByTimeAsync(25);
      expect(invokeCount).toBe(2);

      engine.stop();
    });

    it("start() is idempotent and stop() cancels the timer", async () => {
      vi.useFakeTimers();
      const { prisma } = makePrismaMock();
      const engine = createLocalSyncEngine({ prisma, workstationId, intervalMs: 50 });

      engine.start();
      engine.start(); // second start must be no-op

      await vi.advanceTimersByTimeAsync(2010);
      // One cycle: get_local_sync_status + pull_from_hub (push skipped when no entries)
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(mockInvoke).toHaveBeenCalledWith("get_local_sync_status");

      engine.stop();

      await vi.advanceTimersByTimeAsync(200);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });
});
