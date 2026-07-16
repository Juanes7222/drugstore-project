/**
 * Sale lifecycle integration flow: open shift → create sale → confirm → close.
 *
 * These tests verify the complete sale lifecycle against the real apps/server:
 *
 * 1. Login as cashier (created via POST /users by the seeded admin)
 * 2. Open a cash shift
 * 3. Create a sale (IN_PROGRESS)
 * 4. Confirm the sale (CONFIRMED) — stock is reduced
 * 5. Register a closing cash count
 * 6. Close the cash shift
 *
 * Each step depends on the previous one succeeding.  Shared state (shiftId,
 * saleId) is set before assertions so that a failing assertion in one step
 * does not cascade undefined IDs into the next.
 *
 * ## Seed data
 *
 * - Admin user + workstation (globalSetup)
 * - Tax scheme, product, price history, tax history, lot, payment method
 *   (created in this file's beforeAll via TestDatabase.seedSaleData)
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { TestClient } from "../harness/test-client";
import { TestDatabase, TEST_IDS, SALE_SEED } from "../harness/test-database";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SERVER_URL = process.env.TEST_SERVER_URL ?? "http://localhost:3001";
const WORKSTATION_ID = process.env.TEST_WORKSTATION_ID ?? TEST_IDS.WORKSTATION;
const CASHIER_USERNAME = "cashier-sale-flow@test.pharmacy";
const CASHIER_PASSWORD = "CashierSale123!";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Sale lifecycle: open shift → create sale → confirm → close", () => {
  const admin = new TestClient(SERVER_URL, WORKSTATION_ID);
  const cashier = new TestClient(SERVER_URL, WORKSTATION_ID);
  let db: TestDatabase;

  // Shared state between test steps (assigned BEFORE assertions so a
  // failing assertion does not cascade undefined IDs into the next step).
  let shiftId: string = "";
  let saleId: string = "";
  let saleTotal: number = 0;

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();

    // Seed sale-specific data (product, lot, tax scheme, payment method)
    await db.seedSaleData();

    // Login as admin and create a cashier user
    await admin.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);
    await admin.createUser({
      displayName: "Sale Flow Cashier",
      username: CASHIER_USERNAME,
      role: "CASHIER",
      initialPassword: CASHIER_PASSWORD,
    });
    admin.clearToken();
  });

  afterAll(async () => {
    cashier.clearToken();
    admin.clearToken();
    if (db) {
      await db.cleanupSaleData();
      await db.close();
    }
  });  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  it("server is reachable", async () => {
    const health = await cashier.health();
    expect(health.reachable).toBe(true);
    expect(health.statusCode).toBeGreaterThanOrEqual(100);
  });

  // -----------------------------------------------------------------------
  // Step 1: Login as cashier
  // -----------------------------------------------------------------------

  it("logs in as cashier", async () => {
    const loginRes = await cashier.login(CASHIER_USERNAME, CASHIER_PASSWORD);
    expect(loginRes).toHaveProperty("accessToken");
    expect(loginRes.user.role).toBe("CASHIER");
  });

  // -----------------------------------------------------------------------
  // Step 2: Open a cash shift
  // -----------------------------------------------------------------------

  it("opens a cash shift", async () => {
    const shift = await cashier.openShift({
      openingBalance: "50000.00",
      openingNotes: "Integration test shift opening",
    });

    // Assign shared state BEFORE assertions
    shiftId = shift.id;

    expect(shift).toHaveProperty("id");
    expect(shift.state).toBe("OPEN");
    // Prisma.Decimal serialises "50000.00" as "50000" (trailing zeros stripped)
    expect(shift.openingBalance).toBeDefined();
    expect(Number.parseFloat(shift.openingBalance)).toBe(50000);
    expect(shift.workstationId).toBe(WORKSTATION_ID);
  });

  // -----------------------------------------------------------------------
  // Step 3: Create a sale (IN_PROGRESS)
  // -----------------------------------------------------------------------

  it("creates a sale in IN_PROGRESS state", async () => {
    const sale = await cashier.createSale({
      saleType: "FREE_SALE",
      cashShiftId: shiftId,
      items: [
        {
          productId: TEST_IDS.SALE_PRODUCT_ID,
          quantity: SALE_SEED.SALE_QUANTITY,
          unitPrice: SALE_SEED.UNIT_PRICE,
        },
      ],
    });

    // Assign shared state BEFORE assertions
    saleId = sale.id;
    saleTotal = Number.parseFloat(sale.totalAmount.toString());

    expect(sale).toHaveProperty("id");
    expect(sale.operationalState).toBe("IN_PROGRESS");
    expect(sale.cashShiftId).toBe(shiftId);
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].productId).toBe(TEST_IDS.SALE_PRODUCT_ID);
    expect(sale.items[0].quantity).toBe(SALE_SEED.SALE_QUANTITY);
  });

  // -----------------------------------------------------------------------
  // Step 4: Confirm the sale (CONFIRMED)
  // -----------------------------------------------------------------------

  it("confirms the sale (CONFIRMED) and reduces stock", async () => {
    const confirmed = await cashier.confirmSale(saleId, {
      payments: [
        {
          paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
          amount: saleTotal,
        },
      ],
    });

    expect(confirmed.operationalState).toBe("CONFIRMED");
    expect(confirmed.confirmedAt).toBeDefined();
    expect(confirmed.payments).toHaveLength(1);
    expect(confirmed.payments[0].paymentMethodId).toBe(TEST_IDS.SALE_CASH_PM_ID);
    // payment amounts may be serialised as Decimals; compare numerically
    expect(Number.parseFloat(confirmed.payments[0].amount.toString())).toBe(saleTotal);

    // Verify stock was reduced via DB introspection
    const stockAfter = await db.getLotStock(TEST_IDS.SALE_LOT_ID);
    expect(stockAfter).toBe(SALE_SEED.INITIAL_STOCK - SALE_SEED.SALE_QUANTITY);
  });

  // -----------------------------------------------------------------------
  // Step 5: Register closing cash count
  // -----------------------------------------------------------------------

  it("registers a closing cash count", async () => {
    const result = await cashier.registerCashCount(shiftId, {
      countType: "CLOSING",
      paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
      expectedAmount: saleTotal.toFixed(2),
      declaredAmount: saleTotal.toFixed(2),
    });

    // The endpoint returns 201 on success
    expect(result).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Step 6: Close the cash shift
  // -----------------------------------------------------------------------

  it("closes the cash shift", async () => {
    const result = await cashier.closeShift(shiftId, {
      closingNotes: "Integration test shift closure",
    });

    expect(result).toHaveProperty("state");
    expect((result as Record<string, unknown>).state).toBe("CLOSED");
    expect((result as Record<string, unknown>).closedAt).toBeDefined();
  });
});
