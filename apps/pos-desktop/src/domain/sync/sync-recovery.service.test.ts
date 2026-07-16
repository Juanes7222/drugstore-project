/**
 * Unit tests for SyncRecoveryService — retry and discard operations.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSyncRecoveryService, type SyncRecoveryService, EntryNotInPermanentFailureException, EntryStateChangedException, EntryNotReplayableException, type PayloadSnapshotGenerator } from "./sync-recovery.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    syncQueue: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    syncRecoveryLog: {
      create: vi.fn(),
    },
  };

  const transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));

  const prisma = {
    $transaction: transaction,
    syncQueue: tx.syncQueue,
    syncRecoveryLog: tx.syncRecoveryLog,
  } as any;

  return { prisma, tx };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SyncRecoveryService", () => {
  let prisma: any;
  let tx: any;
  let service: SyncRecoveryService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
  });

  describe("retryEntry", () => {
    it("resets PERMANENT_FAILURE entry to PENDING for replayable types", async () => {
      tx.syncQueue.findUnique.mockResolvedValue({
        id: "entry-1",
        status: "PERMANENT_FAILURE",
        operationType: "CLIENT_RETURN",
        payload: JSON.stringify({ returnId: "ret-1" }),
        payloadHash: "hash-old",
        operationUuid: "uuid-1",
      });
      tx.syncQueue.update.mockResolvedValue({
        id: "entry-1",
        status: "PENDING",
      });
      tx.syncRecoveryLog.create.mockResolvedValue({});

      service = createSyncRecoveryService({ prisma });

      const result = await service.retryEntry("entry-1", "user-1");

      expect(result.status).toBe("PENDING");
      expect(result.payloadResnapshotted).toBe(false);
      expect(tx.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "entry-1", status: "PERMANENT_FAILURE" },
          data: expect.objectContaining({
            status: "PENDING",
            retryCount: 0,
            failureCategory: null,
          }),
        }),
      );
    });

    it("uses snapshot generator for SALE_CONFIRMATION re-snapshot", async () => {
      const snapshotGenerator: PayloadSnapshotGenerator = vi.fn().mockResolvedValue({
        payload: { userId: "user-001", createSaleDto: {}, confirmSaleDto: {}, metadata: {} },
        payloadHash: "new-hash",
      });

      tx.syncQueue.findUnique.mockResolvedValue({
        id: "entry-1",
        status: "PERMANENT_FAILURE",
        operationType: "SALE_CONFIRMATION",
        payload: JSON.stringify({ metadata: { localSaleId: "sale-1" } }),
        payloadHash: "old-hash",
        operationUuid: "uuid-1",
      });
      tx.syncQueue.update.mockResolvedValue({
        id: "entry-1",
        status: "PENDING",
      });
      tx.syncRecoveryLog.create.mockResolvedValue({});

      service = createSyncRecoveryService({
        prisma,
        snapshotGenerators: { SALE_CONFIRMATION: snapshotGenerator },
      });

      const result = await service.retryEntry("entry-1", "user-1");

      expect(result.payloadResnapshotted).toBe(true);
      expect(snapshotGenerator).toHaveBeenCalled();
      expect(tx.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payload: expect.any(String),
            payloadHash: "new-hash",
          }),
        }),
      );
    });

    it("throws EntryNotInPermanentFailureException when entry is not PERMANENT_FAILURE", async () => {
      tx.syncQueue.findUnique.mockResolvedValue({
        id: "entry-1",
        status: "PENDING",
        operationType: "CLIENT_RETURN",
        payload: "{}",
        payloadHash: "hash",
        operationUuid: "uuid-1",
      });

      service = createSyncRecoveryService({ prisma });

      await expect(
        service.retryEntry("entry-1", "user-1"),
      ).rejects.toThrow(EntryNotInPermanentFailureException);
    });

    it("throws EntryNotReplayableException for unsupported operation types", async () => {
      tx.syncQueue.findUnique.mockResolvedValue({
        id: "entry-1",
        status: "PERMANENT_FAILURE",
        operationType: "UNKNOWN_TYPE",
        payload: "{}",
        payloadHash: "hash",
        operationUuid: "uuid-1",
      });

      service = createSyncRecoveryService({ prisma });

      await expect(
        service.retryEntry("entry-1", "user-1"),
      ).rejects.toThrow(EntryNotReplayableException);
    });

    it("throws EntryStateChangedException when Prisma P2025 is thrown on update", async () => {
      tx.syncQueue.findUnique.mockResolvedValue({
        id: "entry-1",
        status: "PERMANENT_FAILURE",
        operationType: "CLIENT_RETURN",
        payload: "{}",
        payloadHash: "hash",
        operationUuid: "uuid-1",
      });
      tx.syncQueue.update.mockRejectedValue({ code: "P2025" });

      service = createSyncRecoveryService({ prisma });

      await expect(
        service.retryEntry("entry-1", "user-1"),
      ).rejects.toThrow(EntryStateChangedException);
    });
  });

  describe("discardEntry", () => {
    it("marks a PERMANENT_FAILURE entry as DISCARDED", async () => {
      tx.syncQueue.findUnique.mockResolvedValue({
        id: "entry-1",
        status: "PERMANENT_FAILURE",
      });
      tx.syncQueue.update.mockResolvedValue({
        id: "entry-1",
        status: "DISCARDED",
      });
      tx.syncRecoveryLog.create.mockResolvedValue({});

      service = createSyncRecoveryService({ prisma });

      const result = await service.discardEntry("entry-1", "Customer cancelled", "user-1");

      expect(result.status).toBe("DISCARDED");
      expect(tx.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "entry-1", status: "PERMANENT_FAILURE" },
          data: expect.objectContaining({
            status: "DISCARDED",
            lastErrorMessage: "DISCARDED: Customer cancelled",
          }),
        }),
      );
      expect(tx.syncRecoveryLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "DISCARD",
            reason: "Customer cancelled",
            actorUserId: "user-1",
          }),
        }),
      );
    });

    it("throws EntryNotInPermanentFailureException when entry is not PERMANENT_FAILURE", async () => {
      tx.syncQueue.findUnique.mockResolvedValue({
        id: "entry-1",
        status: "PENDING",
      });

      service = createSyncRecoveryService({ prisma });

      await expect(
        service.discardEntry("entry-1", "reason", "user-1"),
      ).rejects.toThrow(EntryNotInPermanentFailureException);
    });
  });
});
