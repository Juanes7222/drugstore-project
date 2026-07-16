/**
 * Sale annulment integration flow: create sale → confirm → annul → stock restored.
 *
 * These tests verify the complete annulment lifecycle against the real apps/server:
 *
 * 1. Login as admin and create a cashier user
 * 2. Login as cashier and open a cash shift
 * 3. Create a sale (IN_PROGRESS)
 * 4. Confirm the sale (CONFIRMED) — stock is reduced
 * 5. Login as admin (annul requires ADMIN role) and annul the sale
 * 6. Verify stock is restored via DB introspection
 *
 * This flow mirrors how annulments work in a real pharmacy: a cashier handles
 * the sale, but only a manager/admin can annul a confirmed transaction.
 *
 * ## Seed data
 *
 * - Admin user + workstation (globalSetup)
 * - Tax scheme, product, price history, tax history, lot, payment method,
 *   fiscal resolution (created in this file's beforeAll via
 *   TestDatabase.seedSaleData)
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
const CASHIER_USERNAME = "cashier-annul-flow@test.pharmacy";
const CASHIER_PASSWORD = "CashierAnnul123!";
const ADMIN_USER_USERNAME = "admin-user-annul-flow@test.pharmacy";
const ADMIN_USER_PASSWORD = "AdminUserAnnul123!";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Sale annulment: create sale → confirm → annul → stock restored", () => {
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

    // Seed sale-specific data (product, lot, tax scheme, fiscal resolution)
    await db.seedSaleData();

    // Login as admin (OWNER role) and create a cashier user via API
    await admin.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);
    await admin.createUser({
      displayName: "Annul Flow Cashier",
      username: CASHIER_USERNAME,
      role: "CASHIER",
      initialPassword: CASHIER_PASSWORD,
    });
    admin.clearToken();

    // The annul endpoint requires @Roles(RoleType.ADMIN), not OWNER, but the
    // server's CreateUserSchema only allows role: enum["MANAGER", "CASHIER"].
    // Seed an ADMIN role user directly in the database instead.
    await db.seedUser({
      id: "annul-admin-user-001",
      username: ADMIN_USER_USERNAME,
      password: ADMIN_USER_PASSWORD,
      role: "ADMIN",
      fullName: "Annul Flow Admin",
    });
  });

  afterAll(async () => {
    cashier.clearToken();
    admin.clearToken();
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
      openingNotes: "Annulment integration test shift opening",
    });

    shiftId = shift.id;

    expect(shift).toHaveProperty("id");
    expect(shift.state).toBe("OPEN");
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
  // Step 4: Confirm the sale (CONFIRMED) — stock reduced
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
    expect(Number.parseFloat(confirmed.payments[0].amount.toString())).toBe(saleTotal);

    // Verify stock was reduced via DB introspection
    const stockAfter = await db.getLotStock(TEST_IDS.SALE_LOT_ID);
    expect(stockAfter).toBe(SALE_SEED.INITIAL_STOCK - SALE_SEED.SALE_QUANTITY);
  });

  // -----------------------------------------------------------------------
  // Step 5: Annul the sale (ANNULLED) — stock restored
  // -----------------------------------------------------------------------

  it("annuls the sale (ANNULLED) and restores stock (ADMIN role)", async () => {
    // The annul endpoint requires @Roles(RoleType.ADMIN), so we switch to
    // the admin user created in beforeAll (role ADMIN, not OWNER).
    const adminUser = new TestClient(SERVER_URL, WORKSTATION_ID);
    const adminLogin = await adminUser.login(
      ADMIN_USER_USERNAME,
      ADMIN_USER_PASSWORD,
    );
    expect(adminLogin.user.role).toBe("ADMIN");

    const result = await adminUser.annulSale(saleId, {
      annulmentReason: "Integration test annulment — verifying stock reversal",
      annulmentNotes: "Stock should be restored to pre-sale level",
    });

    expect(result).toHaveProperty("operationalState");
    expect((result as Record<string, unknown>).operationalState).toBe("ANNULLED");
    expect((result as Record<string, unknown>).annulledAt).toBeDefined();

    // Verify stock was restored via DB introspection
    const stockAfterAnnul = await db.getLotStock(TEST_IDS.SALE_LOT_ID);
    expect(stockAfterAnnul).toBe(SALE_SEED.INITIAL_STOCK);
  });

  // -----------------------------------------------------------------------
  // Step 6: Register closing cash count (using sale amount)
  // -----------------------------------------------------------------------

  it("registers a closing cash count", async () => {
    const result = await cashier.registerCashCount(shiftId, {
      countType: "CLOSING",
      paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
      expectedAmount: saleTotal.toFixed(2),
      declaredAmount: saleTotal.toFixed(2),
    });

    expect(result).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Step 7: Close the cash shift
  // -----------------------------------------------------------------------

  it("closes the cash shift", async () => {
    const result = await cashier.closeShift(shiftId, {
      closingNotes: "Annulment integration test shift closure",
    });

    expect(result).toHaveProperty("state");
    expect((result as Record<string, unknown>).state).toBe("CLOSED");
    expect((result as Record<string, unknown>).closedAt).toBeDefined();
  });
});
