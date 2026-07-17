/**
 * Multi-workstation integration flow: two cashiers, two workstations,
 * sales remain isolated.
 *
 * These tests verify that sales created on different workstations are
 * properly scoped and don't leak between them:
 *
 * 1. Seed two workstations (WS-A, WS-B) and two cashier users
 * 2. Cashier A opens shift + creates/confirms sale on WS-A
 * 3. Cashier B opens shift + creates/confirms sale on WS-B
 * 4. Verify each sale is for the correct workstation via DB
 * 5. Register cash counts and close both shifts
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

const WS_A_ID = "multi-ws-a-001";
const WS_B_ID = "multi-ws-b-001";

const CASHIER_A_USERNAME = "cashier-ws-a@test.pharmacy";
const CASHIER_A_PASSWORD = "CashierWsA123!";
const CASHIER_B_USERNAME = "cashier-ws-b@test.pharmacy";
const CASHIER_B_PASSWORD = "CashierWsB123!";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Multi-workstation: two cashiers, isolated sales", () => {
  const owner = new TestClient(SERVER_URL);
  const cashierA = new TestClient(SERVER_URL, WS_A_ID);
  const cashierB = new TestClient(SERVER_URL, WS_B_ID);
  let db: TestDatabase;

  // Shared state
  let shiftAId: string = "";
  let shiftBId: string = "";
  let saleATotal: number = 0;

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();

    // Seed base entities (uses TEST_IDS.WORKSTATION = "integration-test-ws-001")
    await db.seedSaleData();

    // Seed two additional workstations
    await db.seedWorkstation({ id: WS_A_ID, name: "Workstation A", code: "WS-A" });
    await db.seedWorkstation({ id: WS_B_ID, name: "Workstation B", code: "WS-B" });

    // Seed fiscal allocations for both workstations with non-overlapping ranges
    // to avoid unique constraint violation on (consecutiveNumber, resolutionId).
    await db.seedFiscalAllocation(WS_A_ID, { rangeFrom: 1, rangeTo: 100000 });
    await db.seedFiscalAllocation(WS_B_ID, { rangeFrom: 100001, rangeTo: 200000 });

    // Login as OWNER and create two cashier users
    await owner.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);
    await owner.createUser({
      displayName: "Cashier WS-A",
      username: CASHIER_A_USERNAME,
      role: "CASHIER",
      initialPassword: CASHIER_A_PASSWORD,
    });
    await owner.createUser({
      displayName: "Cashier WS-B",
      username: CASHIER_B_USERNAME,
      role: "CASHIER",
      initialPassword: CASHIER_B_PASSWORD,
    });
    owner.clearToken();
  });

  afterAll(async () => {
    cashierA.clearToken();
    cashierB.clearToken();
    owner.clearToken();
    if (db) {
      // Clean up WS-A / WS-B allocations BEFORE cleanupSaleData deletes the resolution
      await db.cleanupFiscalAllocation(WS_A_ID);
      await db.cleanupFiscalAllocation(WS_B_ID);
      await db.cleanupWorkstation(WS_A_ID);
      await db.cleanupWorkstation(WS_B_ID);
      await db.cleanupSaleData();
      await db.close();
    }
  });

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  it("server is reachable", async () => {
    const health = await cashierA.health();
    expect(health.reachable).toBe(true);
    expect(health.statusCode).toBeGreaterThanOrEqual(100);
  });

  // -----------------------------------------------------------------------
  // Step 1: Both cashiers log in on their respective workstations
  // -----------------------------------------------------------------------

  it("logs in Cashier A on WS-A and Cashier B on WS-B", async () => {
    const loginA = await cashierA.login(CASHIER_A_USERNAME, CASHIER_A_PASSWORD);
    expect(loginA.user.role).toBe("CASHIER");
    // The TestClient sends x-workstation-id = WS_A_ID on every request,
    // and the login body includes workstationId = WS_A_ID.

    const loginB = await cashierB.login(CASHIER_B_USERNAME, CASHIER_B_PASSWORD);
    expect(loginB.user.role).toBe("CASHIER");
  });

  // -----------------------------------------------------------------------
  // Step 2: Open shifts on each workstation
  // -----------------------------------------------------------------------

  it("Cashier A opens a shift on WS-A", async () => {
    const shift = await cashierA.openShift({
      openingBalance: "50000.00",
      openingNotes: "WS-A multi-workstation shift",
    });
    shiftAId = shift.id;
    expect(shift.state).toBe("OPEN");
    expect(shift.workstationId).toBe(WS_A_ID);
  });

  it("Cashier B opens a shift on WS-B", async () => {
    const shift = await cashierB.openShift({
      openingBalance: "30000.00",
      openingNotes: "WS-B multi-workstation shift",
    });
    shiftBId = shift.id;
    expect(shift.state).toBe("OPEN");
    expect(shift.workstationId).toBe(WS_B_ID);
  });

  // -----------------------------------------------------------------------
  // Step 3: Each cashier creates + confirms a sale on their workstation
  // -----------------------------------------------------------------------

  it("Cashier A creates and confirms a sale on WS-A", async () => {
    const sale = await cashierA.createSale({
      saleType: "FREE_SALE",
      cashShiftId: shiftAId,
      items: [{
        productId: TEST_IDS.SALE_PRODUCT_ID,
        quantity: 2,
        unitPrice: "15000.00",
      }],
    });

    expect(sale.operationalState).toBe("IN_PROGRESS");
    saleATotal = Number.parseFloat(sale.totalAmount.toString());

    const confirmed = await cashierA.confirmSale(sale.id, {
      payments: [{
        paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
        amount: saleATotal,
      }],
    });

    expect(confirmed.operationalState).toBe("CONFIRMED");
  });

  it("Cashier B creates and confirms a sale on WS-B", async () => {
    const sale = await cashierB.createSale({
      saleType: "FREE_SALE",
      cashShiftId: shiftBId,
      items: [{
        productId: TEST_IDS.SALE_PRODUCT_ID,
        quantity: 1,
        unitPrice: "15000.00",
      }],
    });

    expect(sale.operationalState).toBe("IN_PROGRESS");
    const total = Number.parseFloat(sale.totalAmount.toString());

    const confirmed = await cashierB.confirmSale(sale.id, {
      payments: [{
        paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
        amount: total,
      }],
    });

    expect(confirmed.operationalState).toBe("CONFIRMED");
  });

  // -----------------------------------------------------------------------
  // Step 4: Verify via DB that sales are isolated per workstation
  // -----------------------------------------------------------------------

  it("Cashier A's sale belongs to WS-A", async () => {
    const sales = await db.findSalesByCashShift(shiftAId);
    expect(sales.length).toBe(1);

    const sale = sales[0];
    expect(sale.workstationId).toBe(WS_A_ID);
    expect(sale.cashShiftId).toBe(shiftAId);
    expect(sale.operationalState).toBe("CONFIRMED");
  });

  it("Cashier B's sale belongs to WS-B", async () => {
    const sales = await db.findSalesByCashShift(shiftBId);
    expect(sales.length).toBe(1);

    const sale = sales[0];
    expect(sale.workstationId).toBe(WS_B_ID);
    expect(sale.cashShiftId).toBe(shiftBId);
    expect(sale.operationalState).toBe("CONFIRMED");
  });

  // -----------------------------------------------------------------------
  // Step 5: Close both shifts
  // -----------------------------------------------------------------------

  it("closes both cash shifts", async () => {
    // WS-A closing
    await cashierA.registerCashCount(shiftAId, {
      countType: "CLOSING",
      paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
      expectedAmount: saleATotal.toFixed(2),
      declaredAmount: saleATotal.toFixed(2),
    });
    const closeA = await cashierA.closeShift(shiftAId, {
      closingNotes: "WS-A closure",
    });
    expect((closeA as Record<string, unknown>).state).toBe("CLOSED");

    // WS-B closing
    await cashierB.registerCashCount(shiftBId, {
      countType: "CLOSING",
      paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
      expectedAmount: "50000.00",
      declaredAmount: "50000.00",
    });
    const closeB = await cashierB.closeShift(shiftBId, {
      closingNotes: "WS-B closure",
    });
    expect((closeB as Record<string, unknown>).state).toBe("CLOSED");
  });
});
