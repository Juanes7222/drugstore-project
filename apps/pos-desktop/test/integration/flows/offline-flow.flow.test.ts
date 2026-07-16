/**
 * Offline sync integration flow: sync batch → processing → sale created.
 *
 * These tests simulate what the POS desktop does when it comes back online
 * after creating a sale while disconnected:
 *
 * 1. Seed server data → login cashier → open shift
 * 2. Send a SALE_CONFIRMATION sync batch → verify ACCEPTED
 * 3. Send the same operation UUID again → verify ALREADY_ACCEPTED (idempotency)
 * 4. Send a batch with a bad payload hash → verify REJECTED
 * 5. Check sync queue status has sourceWorkstationId populated
 * 6. Poll the cron-based SyncProcessingJob until it processes the batch
 * 7. Verify the sale was created and confirmed server-side
 * 8. Close the cash shift
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
const CASHIER_USERNAME = "cashier-offline-flow@test.pharmacy";
const CASHIER_PASSWORD = "CashierOff123!";

/** Max time (ms) to wait for the sync cron job (runs every 30s). */
const SYNC_PROCESSING_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 2_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex digest of a JSON object, matching SyncService.computePayloadHash. */
function computePayloadHash(payload: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Offline sync: batch → processing → sale created", () => {
  const owner = new TestClient(SERVER_URL, WORKSTATION_ID);
  const cashier = new TestClient(SERVER_URL, WORKSTATION_ID);
  let db: TestDatabase;

  // Shared state
  let cashierUserId: string = "";
  let shiftId: string = "";

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    await db.seedSaleData();

    await owner.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);
    const created = await owner.createUser({
      displayName: "Offline Flow Cashier",
      username: CASHIER_USERNAME,
      role: "CASHIER",
      initialPassword: CASHIER_PASSWORD,
    });
    cashierUserId = created.id;
    owner.clearToken();
  });

  afterAll(async () => {
    cashier.clearToken();
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
      openingNotes: "Offline sync integration test",
    });
    shiftId = shift.id;
    expect(shift.state).toBe("OPEN");
  });

  // -----------------------------------------------------------------------
  // Step 2: Send valid sync batch → ACCEPTED
  // -----------------------------------------------------------------------

  it("accepts a valid SALE_CONFIRMATION sync batch", async () => {
    const payload: Record<string, unknown> = {
      userId: cashierUserId,
      createSaleDto: {
        saleType: "FREE_SALE",
        cashShiftId: shiftId,
        items: [{
          productId: TEST_IDS.SALE_PRODUCT_ID,
          quantity: 2,
          unitPrice: "15000.00",
        }],
      },
      confirmSaleDto: {
        payments: [{
          paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
          amount: 50000,
        }],
      },
    };

    const operationUuid = crypto.randomUUID();
    const result = await cashier.sendSyncBatch({
      operations: [{
        operationType: "SALE_CONFIRMATION",
        operationUuid,
        payload,
        payloadHash: computePayloadHash(payload),
        sourceCreatedAt: new Date().toISOString(),
        clientSequence: 1,
      }],
    });

    expect(result).toHaveLength(1);
    expect(result[0].operationUuid).toBe(operationUuid);
    expect(result[0].status).toBe("ACCEPTED");
  });

  // -----------------------------------------------------------------------
  // Step 3: Same UUID again → ALREADY_ACCEPTED (idempotency)
  // -----------------------------------------------------------------------

  it("rejects a duplicate operation UUID with ALREADY_ACCEPTED", async () => {
    const payload: Record<string, unknown> = {
      userId: cashierUserId,
      createSaleDto: {
        saleType: "FREE_SALE",
        cashShiftId: shiftId,
        items: [{
          productId: TEST_IDS.SALE_PRODUCT_ID,
          quantity: 1,
          unitPrice: "15000.00",
        }],
      },
      confirmSaleDto: {
        payments: [{
          paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
          amount: 20000,
        }],
      },
    };

    const operationUuid = crypto.randomUUID();

    // First send — should be ACCEPTED
    const first = await cashier.sendSyncBatch({
      operations: [{
        operationType: "SALE_CONFIRMATION",
        operationUuid,
        payload,
        payloadHash: computePayloadHash(payload),
        sourceCreatedAt: new Date().toISOString(),
        clientSequence: 2,
      }],
    });
    expect(first[0].status).toBe("ACCEPTED");

    // Second send with same UUID — should be ALREADY_ACCEPTED
    const second = await cashier.sendSyncBatch({
      operations: [{
        operationType: "SALE_CONFIRMATION",
        operationUuid,
        payload,
        payloadHash: computePayloadHash(payload),
        sourceCreatedAt: new Date().toISOString(),
        clientSequence: 2,
      }],
    });
    expect(second[0].status).toBe("ALREADY_ACCEPTED");
  });

  // -----------------------------------------------------------------------
  // Step 4: Bad payload hash → REJECTED
  // -----------------------------------------------------------------------

  it("rejects a batch with mismatched payload hash", async () => {
    const payload: Record<string, unknown> = {
      userId: cashierUserId,
      createSaleDto: {
        saleType: "FREE_SALE",
        cashShiftId: shiftId,
        items: [{
          productId: TEST_IDS.SALE_PRODUCT_ID,
          quantity: 1,
          unitPrice: "15000.00",
        }],
      },
      confirmSaleDto: {
        payments: [{
          paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
          amount: 20000,
        }],
      },
    };

    const wrongHash = "0000000000000000000000000000000000000000000000000000000000000000";

    const result = await cashier.sendSyncBatch({
      operations: [{
        operationType: "SALE_CONFIRMATION",
        operationUuid: crypto.randomUUID(),
        payload,
        payloadHash: wrongHash,
        sourceCreatedAt: new Date().toISOString(),
        clientSequence: 3,
      }],
    });

    expect(result[0].status).toBe("REJECTED");
    expect(result[0].error).toBe("PAYLOAD_HASH_MISMATCH");
  });

  // -----------------------------------------------------------------------
  // Step 5: Verify sourceWorkstationId in sync status
  // -----------------------------------------------------------------------

  it("reports sourceWorkstationId matching the logged-in workstation", async () => {
    const status = await cashier.getSyncStatus();
    expect(status.sourceWorkstationId).toBe(WORKSTATION_ID);
    expect(status.pending).toBeGreaterThanOrEqual(2);
  });

  // -----------------------------------------------------------------------
  // Step 6: Poll cron until the batch is processed, verify sale exists
  // -----------------------------------------------------------------------

  it("processes the sync batch and creates a confirmed sale (polls cron)", async () => {
    const deadline = Date.now() + SYNC_PROCESSING_TIMEOUT_MS;
    let processed = false;

    while (Date.now() < deadline) {
      const status = await cashier.getSyncStatus();
      if (status.pending === 0) {
        processed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    expect(processed).toBe(true);

    // The sync operation creates AND confirms the sale atomically.
    // Find the most recent confirmed sale for this cash shift via DB.
    const dbSales = await db.findSalesByCashShift(shiftId);
    expect(dbSales.length).toBeGreaterThanOrEqual(1);

    const createdSale = dbSales[0];
    expect(createdSale.operationalState).toBe("CONFIRMED");
    expect(createdSale.cashShiftId).toBe(shiftId);
    expect(createdSale.workstationId).toBe(WORKSTATION_ID);
  });

  // -----------------------------------------------------------------------
  // Step 7: Close the shift
  // -----------------------------------------------------------------------

  it("closes the cash shift", async () => {
    await cashier.registerCashCount(shiftId, {
      countType: "CLOSING",
      paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
      expectedAmount: "50000.00",
      declaredAmount: "50000.00",
    });

    const result = await cashier.closeShift(shiftId, {
      closingNotes: "Offline flow test closure",
    });
    expect((result as Record<string, unknown>).state).toBe("CLOSED");
  });
});
