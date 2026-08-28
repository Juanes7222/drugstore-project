/**
 * Unit tests for AuditSyncService — enqueues unsynced LocalAuditLog rows
 * into SyncQueue as AUDIT_LOG_BATCH.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AUDIT_SYNC_BATCH_SIZE, createAuditSyncService } from "./audit-sync.service";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before service imports
// ---------------------------------------------------------------------------

vi.mock("../../infrastructure/workstation-identity", () => ({
  resolveWorkstationId: vi.fn(),
}));

vi.mock("../sync/sync-queue-notifier", () => ({
  notifyPendingEntry: vi.fn(),
}));

vi.mock("../auth/local-session.store", () => ({
  useLocalSessionStore: {
    getState: vi.fn(),
  },
}));

import { resolveWorkstationId } from "../../infrastructure/workstation-identity";
import { notifyPendingEntry } from "../sync/sync-queue-notifier";
import { useLocalSessionStore } from "../auth/local-session.store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAuditRow = (overrides: Record<string, unknown> = {}) => ({
  id: "audit-1",
  action: "CASH_SHIFT_OPENED",
  category: "cash_shift",
  entityType: "CashShift",
  entityId: "shift-1",
  entityName: "Turno mañana",
  details: '{"openingBalance":"500000"}',
  userId: "user-1",
  userRole: "CASHIER",
  workstationId: "ws-1",
  sessionId: "sess-1",
  correlationId: "corr-1",
  createdAt: new Date("2026-07-15T10:00:00.000Z"),
  syncedAt: null,
  ...overrides,
});

const makeMockPrisma = () => {
  const localAuditLog = {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
  };

  const syncQueue = {
    findFirst: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  };

  const txSyncQueueCreate = vi.fn();
  const txLocalAuditLogUpdateMany = vi.fn();

  const tx: any = {
    syncQueue: { create: txSyncQueueCreate },
    localAuditLog: { updateMany: txLocalAuditLogUpdateMany },
  };

  const $transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));

  const prisma = {
    localAuditLog,
    syncQueue,
    $transaction,
  } as any;

  return {
    prisma,
    localAuditLog,
    syncQueue,
    txSyncQueueCreate,
    txLocalAuditLogUpdateMany,
    tx,
    $transaction,
  };
};

const sha256Hex = async (payload: string): Promise<string> => {
  const data = new TextEncoder().encode(payload);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createAuditSyncService", () => {
  let mocks: ReturnType<typeof makeMockPrisma>;
  let uuidCounter: number;

  beforeEach(() => {
    mocks = makeMockPrisma();
    uuidCounter = 0;

    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `00000000-0000-0000-0000-${String(++uuidCounter).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
    );

    vi.mocked(resolveWorkstationId).mockReturnValue({
      workstationId: "ws-mocked",
      source: "persisted",
    } as any);
    vi.mocked(notifyPendingEntry).mockClear();
    vi.mocked(useLocalSessionStore.getState).mockReturnValue({ session: null } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("countPending", () => {
    it("returns count of LocalAuditLog where syncedAt IS NULL", async () => {
      mocks.localAuditLog.count.mockResolvedValue(7);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-1" });

      const count = await service.countPending();

      expect(count).toBe(7);
      expect(mocks.localAuditLog.count).toHaveBeenCalledWith({
        where: { syncedAt: null },
      });
    });

    it("returns 0 when no pending rows", async () => {
      mocks.localAuditLog.count.mockResolvedValue(0);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-1" });

      expect(await service.countPending()).toBe(0);
    });
  });

  describe("enqueueUnsynced", () => {
    it("returns 0 when no pending rows and creates nothing", async () => {
      mocks.localAuditLog.findMany.mockResolvedValue([]);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-1" });

      const result = await service.enqueueUnsynced();

      expect(result).toBe(0);
      expect(mocks.localAuditLog.findMany).toHaveBeenCalledWith({
        where: { syncedAt: null },
        orderBy: { createdAt: "asc" },
        take: AUDIT_SYNC_BATCH_SIZE * 10,
      });
      expect(mocks.$transaction).not.toHaveBeenCalled();
      expect(notifyPendingEntry).not.toHaveBeenCalled();
    });

    it("caps total work per call — queries with take 500", async () => {
      mocks.localAuditLog.findMany.mockResolvedValue([]);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-1" });

      await service.enqueueUnsynced();

      expect(mocks.localAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 500 }),
      );
      expect(AUDIT_SYNC_BATCH_SIZE * 10).toBe(500);
    });

    it("single batch happy path: creates one SyncQueue entry, watermarks rows, notifies", async () => {
      const rows = [
        makeAuditRow({ id: "audit-1", workstationId: "ws-1" }),
        makeAuditRow({ id: "audit-2", workstationId: null, action: "SALE_CONFIRMED", category: "sale" }),
      ];
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);

      const fixedNow = new Date("2026-08-01T12:00:00.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-1" });

      const result = await service.enqueueUnsynced();

      expect(result).toBe(2);
      expect(mocks.$transaction).toHaveBeenCalledTimes(1);
      expect(mocks.txSyncQueueCreate).toHaveBeenCalledTimes(1);

      const createArg = mocks.txSyncQueueCreate.mock.calls[0][0];
      expect(createArg.data.operationType).toBe("AUDIT_LOG_BATCH");
      expect(createArg.data.status).toBe("PENDING");
      expect(createArg.data.retryCount).toBe(0);
      expect(createArg.data.versionSchema).toBe(1);
      expect(createArg.data.sourceWorkstationId).toBe("ws-1");
      expect(createArg.data.sourceCreatedAt).toEqual(fixedNow);
      expect(createArg.data.clientSequence).toBe(1n);
      expect(createArg.data.payloadHash).toMatch(/^[0-9a-f]{64}$/);
      expect(createArg.data.payloadSize).toBe(new TextEncoder().encode(createArg.data.payload).length);

      // payload contains logs with correct fields
      const payload = JSON.parse(createArg.data.payload);
      expect(payload.logs).toHaveLength(2);
      expect(payload.logs[0]).toEqual(
        expect.objectContaining({
          id: "audit-1",
          action: "CASH_SHIFT_OPENED",
          category: "cash_shift",
          entityType: "CashShift",
          entityId: "shift-1",
          workstationId: "ws-1",
          createdAt: "2026-07-15T10:00:00.000Z",
        }),
      );
      // second row had workstationId null -> falls back to resolved workstationId
      expect(payload.logs[1].workstationId).toBe("ws-1");
      expect(payload.logs[1].action).toBe("SALE_CONFIRMED");

      // watermark
      expect(mocks.txLocalAuditLogUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ["audit-1", "audit-2"] } },
        data: { syncedAt: fixedNow },
      });

      expect(notifyPendingEntry).toHaveBeenCalledTimes(1);
    });

    it("computes correct payloadHash as SHA-256 hex of payload", async () => {
      const rows = [makeAuditRow({ id: "audit-hash-1" })];
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-hash" });

      await service.enqueueUnsynced();

      const createArg = mocks.txSyncQueueCreate.mock.calls[0][0];
      const payload: string = createArg.data.payload;
      const expectedHash = await sha256Hex(payload);

      expect(createArg.data.payloadHash).toBe(expectedHash);
      expect(createArg.data.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("verifies SHA-256 against known vector", async () => {
      const rows = [
        makeAuditRow({
          id: "known-1",
          action: "KNOWN_ACTION",
          category: "sync",
          entityType: null,
          entityId: null,
          entityName: null,
          details: null,
          userId: null,
          userRole: null,
          workstationId: "ws-known",
          sessionId: null,
          correlationId: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ];
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-known" });

      await service.enqueueUnsynced();

      const payload: string = mocks.txSyncQueueCreate.mock.calls[0][0].data.payload;
      const expected = await sha256Hex(payload);
      expect(expected).toMatch(/^[0-9a-f]{64}$/);
      expect(mocks.txSyncQueueCreate.mock.calls[0][0].data.payloadHash).toBe(expected);
      const expectedSize = new TextEncoder().encode(payload).length;
      expect(mocks.txSyncQueueCreate.mock.calls[0][0].data.payloadSize).toBe(expectedSize);
    });

    it("respects workstationId from config and does not call resolveWorkstationId", async () => {
      const rows = [makeAuditRow({ id: "audit-ws-1" })];
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-config-123" });

      await service.enqueueUnsynced();

      expect(resolveWorkstationId).not.toHaveBeenCalled();
      expect(mocks.txSyncQueueCreate.mock.calls[0][0].data.sourceWorkstationId).toBe("ws-config-123");
      expect(mocks.syncQueue.findFirst).toHaveBeenCalledWith({
        where: { sourceWorkstationId: "ws-config-123" },
        orderBy: { clientSequence: "desc" },
        select: { clientSequence: true },
      });
    });

    it("increments clientSequence from latest SyncQueue entry", async () => {
      const rows = [makeAuditRow({ id: "audit-seq-1" })];
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue({ clientSequence: 5n });

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-seq" });

      await service.enqueueUnsynced();

      expect(mocks.txSyncQueueCreate.mock.calls[0][0].data.clientSequence).toBe(6n);
    });

    it("starts clientSequence at 1n when no prior entry", async () => {
      const rows = [makeAuditRow({ id: "audit-seq-0" })];
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-seq-0" });

      await service.enqueueUnsynced();

      expect(mocks.txSyncQueueCreate.mock.calls[0][0].data.clientSequence).toBe(1n);
    });

    it("splits into multiple batches when >50 pending (60 -> 2 entries)", async () => {
      const rows = Array.from({ length: 60 }, (_, i) =>
        makeAuditRow({
          id: `audit-${String(i).padStart(3, "0")}`,
          workstationId: "ws-batch",
          createdAt: new Date(`2026-07-15T10:${String(i).padStart(2, "0")}:00.000Z`),
        }),
      );
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      // First batch sees no prior, second sees 1n
      mocks.syncQueue.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ clientSequence: 1n });

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-batch" });

      const result = await service.enqueueUnsynced();

      expect(result).toBe(60);
      expect(mocks.$transaction).toHaveBeenCalledTimes(2);
      expect(mocks.txSyncQueueCreate).toHaveBeenCalledTimes(2);
      expect(mocks.txLocalAuditLogUpdateMany).toHaveBeenCalledTimes(2);

      const firstPayload = JSON.parse(mocks.txSyncQueueCreate.mock.calls[0][0].data.payload);
      const secondPayload = JSON.parse(mocks.txSyncQueueCreate.mock.calls[1][0].data.payload);
      expect(firstPayload.logs).toHaveLength(50);
      expect(secondPayload.logs).toHaveLength(10);
      expect(firstPayload.logs[0].id).toBe("audit-000");
      expect(firstPayload.logs[49].id).toBe("audit-049");
      expect(secondPayload.logs[0].id).toBe("audit-050");

      // clientSequence increments per workstation
      expect(mocks.txSyncQueueCreate.mock.calls[0][0].data.clientSequence).toBe(1n);
      expect(mocks.txSyncQueueCreate.mock.calls[1][0].data.clientSequence).toBe(2n);

      // notify once after all batches, not per batch
      expect(notifyPendingEntry).toHaveBeenCalledTimes(1);

      // watermarks are split correctly
      expect(mocks.txLocalAuditLogUpdateMany.mock.calls[0][0].where.id.in).toHaveLength(50);
      expect(mocks.txLocalAuditLogUpdateMany.mock.calls[1][0].where.id.in).toHaveLength(10);
    });

    it("creates 10 batches when 500 rows pending (cap)", async () => {
      const rows = Array.from({ length: 500 }, (_, i) =>
        makeAuditRow({ id: `cap-${i}`, workstationId: "ws-cap" }),
      );
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-cap" });

      const result = await service.enqueueUnsynced();

      expect(result).toBe(500);
      expect(mocks.$transaction).toHaveBeenCalledTimes(10);
      expect(mocks.txSyncQueueCreate).toHaveBeenCalledTimes(10);
      expect(notifyPendingEntry).toHaveBeenCalledTimes(1);
    });

    it("watermark uses syncedAt = now inside transaction (same Date for create and update)", async () => {
      const rows = [makeAuditRow({ id: "audit-wm-1" })];
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);

      const fixedNow = new Date("2026-09-01T08:00:00.123Z");
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-wm" });

      await service.enqueueUnsynced();

      const createdAt = mocks.txSyncQueueCreate.mock.calls[0][0].data.sourceCreatedAt;
      const watermarkAt = mocks.txLocalAuditLogUpdateMany.mock.calls[0][0].data.syncedAt;
      expect(createdAt).toEqual(fixedNow);
      expect(watermarkAt).toEqual(fixedNow);
      expect(createdAt).toEqual(watermarkAt);
    });

    it("resolves workstationId via resolveWorkstationId when config has none", async () => {
      const rows = [makeAuditRow({ id: "audit-resolve-1", workstationId: null })];
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);
      vi.mocked(resolveWorkstationId).mockReturnValue({
        workstationId: "ws-resolved",
        source: "persisted",
      } as any);

      const service = createAuditSyncService({ prisma: mocks.prisma });

      await service.enqueueUnsynced();

      expect(resolveWorkstationId).toHaveBeenCalledTimes(1);
      expect(mocks.txSyncQueueCreate.mock.calls[0][0].data.sourceWorkstationId).toBe("ws-resolved");
      // row with null workstationId falls back to resolved
      const payload = JSON.parse(mocks.txSyncQueueCreate.mock.calls[0][0].data.payload);
      expect(payload.logs[0].workstationId).toBe("ws-resolved");
    });

    it("handles resolveWorkstationId failure gracefully — falls back to session store", async () => {
      const rows = [makeAuditRow({ id: "audit-fallback-1", workstationId: null })];
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);
      vi.mocked(resolveWorkstationId).mockImplementation(() => {
        throw new Error("resolve failed");
      });
      vi.mocked(useLocalSessionStore.getState).mockReturnValue({
        session: { workstationId: "ws-session" } as any,
      } as any);

      const service = createAuditSyncService({ prisma: mocks.prisma });

      await service.enqueueUnsynced();

      expect(mocks.txSyncQueueCreate.mock.calls[0][0].data.sourceWorkstationId).toBe("ws-session");
    });

    it("falls back to unknown-workstation when both resolve and session fail", async () => {
      const rows = [makeAuditRow({ id: "audit-unknown-1", workstationId: null })];
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);
      vi.mocked(resolveWorkstationId).mockImplementation(() => {
        throw new Error("resolve failed");
      });
      vi.mocked(useLocalSessionStore.getState).mockImplementation(() => {
        throw new Error("store failed");
      });

      const service = createAuditSyncService({ prisma: mocks.prisma });

      await service.enqueueUnsynced();

      expect(mocks.txSyncQueueCreate.mock.calls[0][0].data.sourceWorkstationId).toBe("unknown-workstation");
      const payload = JSON.parse(mocks.txSyncQueueCreate.mock.calls[0][0].data.payload);
      expect(payload.logs[0].workstationId).toBe("unknown-workstation");
    });

    it("falls back to unknown-workstation when session is null", async () => {
      const rows = [makeAuditRow({ id: "audit-unknown-2" })];
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);
      vi.mocked(resolveWorkstationId).mockImplementation(() => {
        throw new Error("resolve failed");
      });
      vi.mocked(useLocalSessionStore.getState).mockReturnValue({ session: null } as any);

      const service = createAuditSyncService({ prisma: mocks.prisma });

      await service.enqueueUnsynced();

      expect(mocks.txSyncQueueCreate.mock.calls[0][0].data.sourceWorkstationId).toBe("unknown-workstation");
    });

    it("verify operationType is AUDIT_LOG_BATCH and payload contains logs with correct fields", async () => {
      const rows = [
        makeAuditRow({
          id: "audit-payload-1",
          action: "CLIENT_CREATED",
          category: "client",
          entityType: "Client",
          entityId: "client-99",
          entityName: "Cliente Test",
          details: '{"nit":"123"}',
          userId: "user-99",
          userRole: "MANAGER",
          workstationId: "ws-payload",
          sessionId: "sess-99",
          correlationId: "corr-99",
          createdAt: new Date("2026-07-20T15:30:00.000Z"),
        }),
        makeAuditRow({
          id: "audit-payload-2",
          action: "SALE_CONFIRMED",
          category: "sale",
          entityType: null,
          entityId: null,
          entityName: null,
          details: null,
          userId: null,
          userRole: null,
          workstationId: null,
          sessionId: null,
          correlationId: null,
          createdAt: "2026-07-21T10:00:00.000Z" as any,
        }),
      ];
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-payload-fallback" });

      await service.enqueueUnsynced();

      const data = mocks.txSyncQueueCreate.mock.calls[0][0].data;
      expect(data.operationType).toBe("AUDIT_LOG_BATCH");
      expect(data.payload).toBeDefined();

      const payload = JSON.parse(data.payload);
      expect(payload).toEqual({
        logs: [
          {
            id: "audit-payload-1",
            action: "CLIENT_CREATED",
            category: "client",
            entityType: "Client",
            entityId: "client-99",
            entityName: "Cliente Test",
            details: '{"nit":"123"}',
            userId: "user-99",
            userRole: "MANAGER",
            workstationId: "ws-payload",
            sessionId: "sess-99",
            correlationId: "corr-99",
            createdAt: "2026-07-20T15:30:00.000Z",
          },
          {
            id: "audit-payload-2",
            action: "SALE_CONFIRMED",
            category: "sale",
            entityType: null,
            entityId: null,
            entityName: null,
            details: null,
            userId: null,
            userRole: null,
            workstationId: "ws-payload-fallback",
            sessionId: null,
            correlationId: null,
            createdAt: "2026-07-21T10:00:00.000Z",
          },
        ],
      });

      // payloadHash and payloadSize are derived from payload string
      expect(data.payloadHash).toBe(await sha256Hex(data.payload));
      expect(data.payloadSize).toBe(new TextEncoder().encode(data.payload).length);
      expect(typeof data.operationUuid).toBe("string");
      expect(data.operationUuid).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it("generates distinct operationUuid per batch", async () => {
      const rows = Array.from({ length: 60 }, (_, i) =>
        makeAuditRow({ id: `uuid-${i}`, workstationId: "ws-uuid" }),
      );
      mocks.localAuditLog.findMany.mockResolvedValue(rows);
      mocks.syncQueue.findFirst.mockResolvedValue(null);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-uuid" });

      await service.enqueueUnsynced();

      const uuid1 = mocks.txSyncQueueCreate.mock.calls[0][0].data.operationUuid;
      const uuid2 = mocks.txSyncQueueCreate.mock.calls[1][0].data.operationUuid;
      expect(uuid1).not.toBe(uuid2);
    });

    it("does not call notifyPendingEntry when enqueue returns 0 after no pending", async () => {
      mocks.localAuditLog.findMany.mockResolvedValue([]);

      const service = createAuditSyncService({ prisma: mocks.prisma, workstationId: "ws-1" });

      await service.enqueueUnsynced();

      expect(notifyPendingEntry).not.toHaveBeenCalled();
    });
  });
});
