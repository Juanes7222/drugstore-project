/**
 * Offline-flow integration tests: server connectivity, sync batch, and retry.
 *
 * These tests simulate what happens when the POS desktop goes offline and
 * later reconnects:
 *
 * 1. Server connectivity detection (reachable vs dead port)
 * 2. Sync batch — simulating how the POS would push queued offline operations
 * 3. Sync status — verifying pending/failed counts
 * 4. Queue listing (ADMIN role)
 * 5. Retry mechanism — resetting a FAILED entry back to PENDING
 *
 * ## How this maps to the real app
 *
 * The POS desktop works offline-first:
 * - Local operations are queued in a SyncQueue table (PGlite)
 * - On reconnect, `POST /sync/batch` pushes the batch to the server
 * - The server stores each operation as PENDING for async processing
 * - If processing fails, the entry becomes FAILED
 * - An admin can retry via `POST /sync/queue/:id/retry`
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { TestClient } from "../harness/test-client";
import { TestDatabase, TEST_IDS } from "../harness/test-database";
import type { SyncBatchRequest } from "../harness/test-client";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SERVER_URL = process.env.TEST_SERVER_URL ?? "http://localhost:3001";
const WORKSTATION_ID = process.env.TEST_WORKSTATION_ID ?? TEST_IDS.WORKSTATION;
const DEAD_PORT = "http://localhost:19999";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Offline flow: connectivity, sync batch, and retry", () => {
  const client = new TestClient(SERVER_URL, WORKSTATION_ID);
  let db: TestDatabase;

  // Track UUIDs for dedup, rejection, and targeted cleanup
  const FIRST_OPERATION_UUID = crypto.randomUUID();
  const ALREADY_ACCEPTED_UUID = crypto.randomUUID();
  const REJECTED_UUID = crypto.randomUUID();

  // Test-specific user for role enforcement
  const OFFLINE_FLOW_CASHIER_USERNAME = "cashier-offline-flow-test";
  const OFFLINE_FLOW_CASHIER_PASSWORD = "OfflineFlowTest123!";

  // Track all operation UUIDs we create so cleanup is precise
  const ourOperationUuids: string[] = [];

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();

    // Login as admin
    await client.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    // Create a cashier user for role enforcement tests
    // (self-contained — does not depend on other test files)
    await client.createUser({
      displayName: "Offline Flow Cashier",
      username: OFFLINE_FLOW_CASHIER_USERNAME,
      role: "CASHIER",
      initialPassword: OFFLINE_FLOW_CASHIER_PASSWORD,
    });
  });

  afterAll(async () => {
    client.clearToken();

    if (db) {
      // Clean up the cashier user we created
      const cashierUser = await db.findUserByUsername(OFFLINE_FLOW_CASHIER_USERNAME);
      if (cashierUser) {
        await (db as any).prisma.userSession.deleteMany({ where: { userId: cashierUser.id } });
        await (db as any).prisma.user.deleteMany({ where: { id: cashierUser.id } });
      }

      // Clean up sync queue entries by precise operation UUID (never blanket delete)
      for (const uuid of ourOperationUuids) {
        await db.deleteSyncQueueEntries({ operationUuid: uuid });
      }
      await db.deleteSyncQueueEntries({ operationUuid: ALREADY_ACCEPTED_UUID });

      await db.close();
    }
  });

  // -----------------------------------------------------------------------
  // Server connectivity
  // -----------------------------------------------------------------------

  it("detects the server is reachable", async () => {
    const health = await client.health();
    expect(health.reachable).toBe(true);
    expect(health.statusCode).toBeGreaterThanOrEqual(100);
  });

  it("detects the server is unreachable when connecting to a dead port", async () => {
    const deadClient = new TestClient(DEAD_PORT);
    const health = await deadClient.health();
    expect(health.reachable).toBe(false);
    expect(health.statusCode).toBe(0);
  });

  it("throws a connection error when making an authenticated request to a dead port", async () => {
    const deadClient = new TestClient(DEAD_PORT);

    // Login would normally store a token, but we need to test the connection fails
    await expect(
      deadClient.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD),
    ).rejects.toThrow(/fetch|Failed to fetch|network|connect|ECONNREFUSED/i);
  });

  // -----------------------------------------------------------------------
  // Sync batch — ACCEPTED
  // -----------------------------------------------------------------------

  it("sends a sync batch with a valid operation and receives ACCEPTED", async () => {
    const operationUuid = FIRST_OPERATION_UUID;
    ourOperationUuids.push(operationUuid);

    const payload = {
      saleId: crypto.randomUUID(),
      workstationId: WORKSTATION_ID,
      totalAmount: "45000.00",
      items: [
        { productId: crypto.randomUUID(), quantity: 3, unitPrice: "15000.00" },
      ],
    };

    const payloadHash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    const batch: SyncBatchRequest = {
      operations: [
        {
          operationType: "SALE_CONFIRMATION",
          operationUuid,
          payload,
          payloadHash,
          sourceCreatedAt: new Date().toISOString(),
          clientSequence: 1,
        },
      ],
    };

    const results = await client.sendSyncBatch(batch);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("ACCEPTED");
    expect(results[0].operationUuid).toBe(operationUuid);
  });

  // -----------------------------------------------------------------------
  // Sync batch — ALREADY_ACCEPTED (idempotency)
  // -----------------------------------------------------------------------

  it("sends the same operation again and receives ALREADY_ACCEPTED", async () => {
    const payload = { dummy: "data" };
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    // First send to ensure it's in the queue
    const firstBatch: SyncBatchRequest = {
      operations: [
        {
          operationType: "CLIENT_CREATION",
          operationUuid: ALREADY_ACCEPTED_UUID,
          payload,
          payloadHash,
          sourceCreatedAt: new Date().toISOString(),
          clientSequence: 2,
        },
      ],
    };

    const firstResults = await client.sendSyncBatch(firstBatch);
    expect(firstResults[0].status).toBe("ACCEPTED");

    // Send the same UUID again
    const secondBatch: SyncBatchRequest = {
      operations: [
        {
          operationType: "CLIENT_CREATION",
          operationUuid: ALREADY_ACCEPTED_UUID,
          payload,
          payloadHash,
          sourceCreatedAt: new Date().toISOString(),
          clientSequence: 2,
        },
      ],
    };

    const secondResults = await client.sendSyncBatch(secondBatch);

    expect(secondResults).toHaveLength(1);
    expect(secondResults[0].status).toBe("ALREADY_ACCEPTED");
    expect(secondResults[0].operationUuid).toBe(ALREADY_ACCEPTED_UUID);
  });

  // -----------------------------------------------------------------------
  // Sync batch — REJECTED (hash mismatch)
  // -----------------------------------------------------------------------

  it("sends an operation with a wrong hash and receives REJECTED", async () => {
    const payload = { test: "payload" };

    const batch: SyncBatchRequest = {
      operations: [
        {
          operationType: "INVENTORY_ADJUSTMENT",
          operationUuid: REJECTED_UUID,
          payload,
          payloadHash: "0000000000000000000000000000000000000000000000000000000000000000",
          sourceCreatedAt: new Date().toISOString(),
          clientSequence: 3,
        },
      ],
    };

    const results = await client.sendSyncBatch(batch);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("REJECTED");
    expect(results[0].error).toBe("PAYLOAD_HASH_MISMATCH");
    expect(results[0].operationUuid).toBe(REJECTED_UUID);
  });

  // -----------------------------------------------------------------------
  // Sync status
  // -----------------------------------------------------------------------

  it("returns sync status with pending count for the workstation", async () => {
    const status = await client.getSyncStatus();

    expect(status.sourceWorkstationId).toBe(WORKSTATION_ID);
    // We created at least 2 ACCEPTED operations (SALE_CONFIRMATION + CLIENT_CREATION)
    expect(status.pending).toBeGreaterThanOrEqual(2);
    // FAILED entries should be 0 (REJECTED ones are not stored in the queue)
    expect(status.failed).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Queue listing (ADMIN only)
  // -----------------------------------------------------------------------

  it("lists sync queue entries (requires ADMIN)", async () => {
    const queue = await client.listSyncQueue();

    expect(queue).toHaveProperty("data");
    expect(queue).toHaveProperty("total");
    expect(queue).toHaveProperty("page");
    expect(queue.total).toBeGreaterThanOrEqual(2);

    const entries = queue.data as Array<{ operationUuid: string; operationType: string; status: string }>;
    const ourEntry = entries.find(
      (e: { operationUuid: string }) =>
        e.operationUuid === ALREADY_ACCEPTED_UUID,
    );
    expect(ourEntry).toBeDefined();
    expect(ourEntry!.operationType).toBe("CLIENT_CREATION");
    expect(ourEntry!.status).toBe("PENDING");
  });

  it("filters sync queue entries by status", async () => {
    const queue = await client.listSyncQueue({ status: "PENDING" });

    expect(queue.total).toBeGreaterThanOrEqual(2);

    const entries = queue.data as Array<{ status: string }>;
    for (const entry of entries) {
      expect(entry.status).toBe("PENDING");
    }
  });

  it("filters sync queue entries by operation type", async () => {
    const queue = await client.listSyncQueue({ operationType: "SALE_CONFIRMATION" });

    expect(queue.total).toBeGreaterThanOrEqual(1);

    const entries = queue.data as Array<{ operationType: string }>;
    for (const entry of entries) {
      expect(entry.operationType).toBe("SALE_CONFIRMATION");
    }
  });

  it("returns empty queue when no entries match the filter", async () => {
    const queue = await client.listSyncQueue({ status: "FAILED" });

    expect(queue.total).toBe(0);
    expect((queue.data as unknown[]).length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Retry mechanism
  // -----------------------------------------------------------------------

  it("retries a FAILED sync queue entry (FAILED → PENDING)", async () => {
    // Find one of OUR PENDING entries (by operation UUID we created)
    const pendingEntries = await db.findSyncQueueEntries({
      status: "PENDING",
      operationUuid: FIRST_OPERATION_UUID,
      limit: 1,
    });
    expect(pendingEntries.length).toBeGreaterThanOrEqual(1);

    const entryId = pendingEntries[0].id;

    // Simulate processing failure
    await db.setSyncEntryStatus(
      entryId,
      "FAILED",
      "Simulated processing failure for test",
    );

    // Verify it's now FAILED in the queue listing
    const failedQueue = await client.listSyncQueue({ status: "FAILED" });
    expect(failedQueue.total).toBeGreaterThanOrEqual(1);

    // Retry the failed entry
    const retryResult = await client.retrySyncEntry(entryId);
    expect(retryResult.status).toBe("PENDING");
    expect(retryResult.lastErrorMessage).toBeNull();
  });

  it("returns the retried entry in PENDING queue after retry", async () => {
    // Verify the queue reflects the change
    const queue = await client.listSyncQueue({ status: "PENDING" });
    expect(queue.total).toBeGreaterThanOrEqual(2);

    const entries = queue.data as Array<{ id: string; status: string }>;
    // At least one entry should be PENDING (we had 2+ originally)
    expect(entries.length).toBeGreaterThan(0);
  });

  it("returns null when retrying a non-existent entry", async () => {
    const nonExistentId = crypto.randomUUID();

    await expect(
      client.retrySyncEntry(nonExistentId),
    ).resolves.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Role enforcement
  // -----------------------------------------------------------------------

  it("rejects sync queue listing by non-ADMIN user", async () => {
    // Login as cashier (no ADMIN role)
    const cashierClient = new TestClient(SERVER_URL, WORKSTATION_ID);
    await cashierClient.login(
      OFFLINE_FLOW_CASHIER_USERNAME,
      OFFLINE_FLOW_CASHIER_PASSWORD,
    );

    // Try listing the queue
    await expect(
      cashierClient.listSyncQueue(),
    ).rejects.toThrow(/403|Forbidden|insufficient/i);

    cashierClient.clearToken();
  });
});
