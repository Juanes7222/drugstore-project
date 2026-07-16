/**
 * Sync retry integration flow: fail → retry → PENDING.
 *
 * These tests verify that a failed sync queue entry can be retried:
 *
 * 1. Send a SALE_CONFIRMATION with an invalid payload (missing createSaleDto)
 * 2. Wait for SyncProcessingJob cron to process it → FAILED (business rule)
 * 3. Call POST /sync/queue/:id/retry as ADMIN → status resets to PENDING
 * 4. Verify the retry cleared error message and retry timer
 *
 * ## Why invalid payload instead of FISCAL_DOCUMENT_SYNC
 *
 * The cron only picks up SUPPORTED_TYPES (SALE_CONFIRMATION, SHIFT_CLOSURE,
 * CLIENT_CREATION, INVENTORY_ADJUSTMENT).  Unsupported types like
 * FISCAL_DOCUMENT_SYNC stay PENDING forever and never become FAILED.
 * Sending a supported type with a broken payload triggers the same retry
 * path that a real corrupt offline operation would.
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as crypto from "node:crypto";
import { TestClient } from "../harness/test-client";
import { TestDatabase, TEST_IDS } from "../harness/test-database";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SERVER_URL = process.env.TEST_SERVER_URL ?? "http://localhost:3001";
const WORKSTATION_ID = process.env.TEST_WORKSTATION_ID ?? TEST_IDS.WORKSTATION;
const CASHIER_USERNAME = "cashier-retry-flow@test.pharmacy";
const CASHIER_PASSWORD = "CashierRetry123!";
const ADMIN_USER_USERNAME = "admin-retry-flow@test.pharmacy";
const ADMIN_USER_PASSWORD = "AdminRetry123!";

const SYNC_PROCESSING_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 2_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computePayloadHash(payload: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Sync retry: fail → retry → PENDING", () => {
  const owner = new TestClient(SERVER_URL, WORKSTATION_ID);
  const cashier = new TestClient(SERVER_URL, WORKSTATION_ID);
  const adminUser = new TestClient(SERVER_URL, WORKSTATION_ID);
  let db: TestDatabase;

  // Shared state between tests
  let shiftId: string = "";
  let failedEntryId: string = "";

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    await db.seedSaleData();

    await owner.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);
    await owner.createUser({
      displayName: "Sync Retry Cashier",
      username: CASHIER_USERNAME,
      role: "CASHIER",
      initialPassword: CASHIER_PASSWORD,
    });

    // ADMIN role cannot be created via API (CreateUserSchema only allows
    // MANAGER | CASHIER), seed directly in DB.
    await db.seedUser({
      id: "retry-admin-user-001",
      username: ADMIN_USER_USERNAME,
      password: ADMIN_USER_PASSWORD,
      role: "ADMIN",
      fullName: "Sync Retry Admin",
    });

    owner.clearToken();
  });

  afterAll(async () => {
    cashier.clearToken();
    adminUser.clearToken();
    owner.clearToken();
    if (db) {
      await db.cleanupSaleData();
      await db.close();
    }
  });

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  it("server is reachable", async () => {
    const health = await cashier.health();
    expect(health.reachable).toBe(true);
    expect(health.statusCode).toBeGreaterThanOrEqual(100);
  });

  // -----------------------------------------------------------------------
  // Step 1: Login + open shift
  // -----------------------------------------------------------------------

  it("logs in as cashier and opens a shift", async () => {
    const loginRes = await cashier.login(CASHIER_USERNAME, CASHIER_PASSWORD);
    expect(loginRes.user.role).toBe("CASHIER");

    const shift = await cashier.openShift({
      openingBalance: "50000.00",
      openingNotes: "Sync retry test shift",
    });
    shiftId = shift.id;
    expect(shift.state).toBe("OPEN");
  });

  // -----------------------------------------------------------------------
  // Step 2: Send an invalid sync batch
  // -----------------------------------------------------------------------

  it("queues a SALE_CONFIRMATION with invalid payload", async () => {
    // Missing createSaleDto causes the dispatcher to fail with TypeError
    // when the cron processes it, resulting in FAILED status.
    const payload: Record<string, unknown> = {
      userId: "invalid-user-id",
      confirmSaleDto: {
        payments: [{
          paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
          amount: 50000,
        }],
      },
    };

    const result = await cashier.sendSyncBatch({
      operations: [{
        operationType: "SALE_CONFIRMATION",
        operationUuid: crypto.randomUUID(),
        payload,
        payloadHash: computePayloadHash(payload),
        sourceCreatedAt: new Date().toISOString(),
        clientSequence: 1,
      }],
    });

    expect(result[0].status).toBe("ACCEPTED");
  });

  // -----------------------------------------------------------------------
  // Step 3: Wait for cron to process → FAILED
  // -----------------------------------------------------------------------

  it("fails processing and shows failed > 0 in sync status", async () => {
    // Login as ADMIN for retry steps (sync queue requires ADMIN role)
    const loginRes = await adminUser.login(ADMIN_USER_USERNAME, ADMIN_USER_PASSWORD);
    expect(loginRes.user.role).toBe("ADMIN");

    const deadline = Date.now() + SYNC_PROCESSING_TIMEOUT_MS;
    let failed = false;

    while (Date.now() < deadline) {
      const status = await adminUser.getSyncStatus();
      if (status.failed > 0) {
        failed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    expect(failed).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Step 4: Find the failed entry in DB and retry via API
  // -----------------------------------------------------------------------

  it("retries the FAILED entry and resets status to PENDING", async () => {
    // Use DB introspection to find the failed entry (avoids 500 on the
    // GET /sync/queue endpoint caused by QuerySyncQueueDto defaults not
    // being applied with bare @Query()).
    const failedEntries = await db.findSyncQueueEntries({
      status: "FAILED",
      limit: 5,
    });

    expect(failedEntries.length).toBeGreaterThanOrEqual(1);
    const entry = failedEntries[0];
    expect(entry.status).toBe("FAILED");
    expect(entry.lastErrorMessage).toBeTruthy();

    failedEntryId = entry.id;

    // Call retry via API (admin user is logged in from step 3)
    const result = await adminUser.retrySyncEntry(failedEntryId);

    expect(result).toHaveProperty("status");
    expect((result as Record<string, unknown>).status).toBe("PENDING");
    expect((result as Record<string, unknown>).lastErrorMessage).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Step 5: Verify the entry is now PENDING in DB
  // -----------------------------------------------------------------------

  it("verifies the entry is now PENDING in the database", async () => {
    expect(failedEntryId).toBeTruthy();

    const entries = await db.findSyncQueueEntries({
      status: "PENDING",
      limit: 10,
    });

    const found = entries.find((e: Record<string, unknown>) => e.id === failedEntryId);
    expect(found).toBeDefined();
    expect(found!.status).toBe("PENDING");
    expect(found!.lastErrorMessage).toBeNull();
    expect(found!.nextRetryAt).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Step 6: Close the shift
  // -----------------------------------------------------------------------

  it("closes the cash shift", async () => {
    await cashier.registerCashCount(shiftId, {
      countType: "CLOSING",
      paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
      expectedAmount: "50000.00",
      declaredAmount: "50000.00",
    });

    const result = await cashier.closeShift(shiftId, {
      closingNotes: "Sync retry test closure",
    });
    expect((result as Record<string, unknown>).state).toBe("CLOSED");
  });
});
