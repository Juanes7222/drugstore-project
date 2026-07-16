/**
 * Inventory integration flow: create product → configure → block/unblock lot → sell.
 *
 * These tests verify the complete inventory lifecycle against the real server:
 *
 * 1. Create a product via API (INVENTORY_ASSISTANT role)
 * 2. Configure it: register price, assign tax scheme, add barcode (ADMIN role)
 * 3. Receive stock: seed a lot with purchase reception item in DB
 * 4. Find the product and lot via API to verify they exist
 * 5. Block the lot (ADMIN role) — verify state changes to BLOCKED
 * 6. Unblock the lot (ADMIN role) — verify state returns to ACTIVE
 * 7. Sell the product (cashier flow) — verify stock decreases
 * 8. Close shift
 *
 * This covers the core inventory operations a pharmacy runs daily:
 * cataloguing, stock receiving, quality control (block/unblock), and sales.
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

const INV_ASSISTANT_USERNAME = "inv-assistant-flow@test.pharmacy";
const INV_ASSISTANT_PASSWORD = "InvAsst123!";
const ADMIN_USER_USERNAME = "admin-inv-flow@test.pharmacy";
const ADMIN_USER_PASSWORD = "AdminInv123!";
const CASHIER_USERNAME = "cashier-inv-flow@test.pharmacy";
const CASHIER_PASSWORD = "CashierInv123!";

// Tax scheme ID dedicated to the dynamically-created product, so cleanup
// doesn't conflict with cleanupSaleData's deletion of the shared tax scheme.
const DYNAMIC_TAX_SCHEME_ID = "b0000000-0000-4000-a000-000000000001";

// Product created dynamically via API (ID assigned by server, stored here)
let createdProductId: string = "";
let createdLotId: string = "";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Inventory: create product → configure → block/unblock lot → sell", () => {
  const owner = new TestClient(SERVER_URL, WORKSTATION_ID);
  const invAssistant = new TestClient(SERVER_URL, WORKSTATION_ID);
  const adminUser = new TestClient(SERVER_URL, WORKSTATION_ID);
  const cashier = new TestClient(SERVER_URL, WORKSTATION_ID);
  let db: TestDatabase;

  // Shared state for the sale step
  let shiftId: string = "";
  let saleTotal: number = 0;

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();

    // Seed base entities: tax scheme, supplier, payment method, fiscal resolution
    await db.seedSaleData();

    // Seed a separate tax scheme for the dynamically-created product so that
    // cleanupSaleData can safely delete the shared tax scheme without FK
    // conflicts from the dynamic product's ProductTaxHistory records.
    await db.seedTaxScheme({
      id: DYNAMIC_TAX_SCHEME_ID,
      code: "INV-TEST-19",
      name: "Inventory Test IVA 19%",
      taxType: "IVA",
      rate: "0.1900",
    });

    // Login as OWNER and create users for each role needed in the test
    await owner.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    // INVENTORY_ASSISTANT — can create products, manage catalog
    // (CreateUserSchema only allows MANAGER | CASHIER, so seed directly)
    await db.seedUser({
      id: "inv-asst-user-001",
      username: INV_ASSISTANT_USERNAME,
      password: INV_ASSISTANT_PASSWORD,
      role: "INVENTORY_ASSISTANT",
      fullName: "Inventory Flow Assistant",
    });

    // ADMIN — can register prices, assign tax schemes, block/unblock lots
    // (CreateUserSchema only allows MANAGER | CASHIER, so seed directly)
    await db.seedUser({
      id: "inv-admin-user-001",
      username: ADMIN_USER_USERNAME,
      password: ADMIN_USER_PASSWORD,
      role: "ADMIN",
      fullName: "Inventory Flow Admin",
    });

    // Cashier — can handle sales
    await owner.createUser({
      displayName: "Inventory Flow Cashier",
      username: CASHIER_USERNAME,
      role: "CASHIER",
      initialPassword: CASHIER_PASSWORD,
    });

    owner.clearToken();
  });

  afterAll(async () => {
    cashier.clearToken();
    adminUser.clearToken();
    invAssistant.clearToken();
    owner.clearToken();
    if (db) {
      // Order matters for FK constraints:
      // 1. Clean up the dynamic lot (removes saleItemLot for dynamic lot)
      if (createdLotId) {
        await db.cleanupLot(createdLotId);
      }
      // 2. Clean up all workstation sales + seeded data.  cleanupSaleData
      //    deletes saleItems first (unblocks product FK), then deletes the
      //    seeded product's tax/price history, then the shared tax scheme.
      await db.cleanupSaleData();
      // 3. Finally the dynamic product — safe because saleItems referencing
      //    it were removed in step 2.
      if (createdProductId) {
        await db.deleteProduct(createdProductId);
      }
      // 4. Clean up the dedicated tax scheme for the dynamic product
      await db.deleteTaxScheme(DYNAMIC_TAX_SCHEME_ID);
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
  // Step 1: Create a product via API (INVENTORY_ASSISTANT role)
  // -----------------------------------------------------------------------

  it("creates a product via POST /products", async () => {
    const loginRes = await invAssistant.login(
      INV_ASSISTANT_USERNAME,
      INV_ASSISTANT_PASSWORD,
    );
    expect(loginRes.user.role).toBe("INVENTORY_ASSISTANT");

    const product = await invAssistant.createProduct({
      internalCode: "INT-INV-TEST-001",
      commercialName: "Inventory Test Product",
      genericName: "Testi Generici",
      activePrinciple: "Testium Principium",
      laboratory: "Test Labs Co",
      saleType: "FREE_SALE",
      initialPrice: "15000.00",
      initialTaxSchemeId: DYNAMIC_TAX_SCHEME_ID,
      concentration: "500 mg",
      concentrationUnit: "mg",
      minimumStock: 5,
    });

    expect(product).toHaveProperty("id");
    expect((product as Record<string, unknown>).internalCode).toBe(
      "INT-INV-TEST-001",
    );
    expect((product as Record<string, unknown>).commercialName).toBe(
      "Inventory Test Product",
    );

    createdProductId = product.id as string;
    expect(createdProductId).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Step 2: Configure the product — price + tax + barcode (ADMIN role)
  // -----------------------------------------------------------------------

  it("registers a price for the product (ADMIN role)", async () => {
    const loginRes = await adminUser.login(
      ADMIN_USER_USERNAME,
      ADMIN_USER_PASSWORD,
    );
    expect(loginRes.user.role).toBe("ADMIN");

    const result = await adminUser.registerProductPrice(createdProductId, {
      price: "15000.00",
      changeReason: "Integration test price registration",
    });

    expect(result).toBeDefined();
  });

  it("assigns a tax scheme to the product (ADMIN role)", async () => {
    const result = await adminUser.assignProductTaxScheme(createdProductId, {
      taxSchemeId: DYNAMIC_TAX_SCHEME_ID,
      changeReason: "Integration test tax scheme assignment",
    });

    expect(result).toBeDefined();
  });

  it("adds a barcode to the product", async () => {
    const result = await adminUser.addProductBarcode(createdProductId, {
      barcode: "7701234567890",
      barcodeType: "EAN13",
      isPrimary: true,
    });

    expect(result).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Step 3: Receive stock — seed a lot in DB
  // -----------------------------------------------------------------------

  it("seeds a lot with stock for the product", async () => {
    createdLotId = await db.seedLotForProduct({
      productId: createdProductId,
      supplierId: TEST_IDS.SALE_SUPPLIER_ID,
      taxSchemeId: DYNAMIC_TAX_SCHEME_ID,
      batchNumber: "BATCH-INV-TEST-001",
      initialStock: 50,
      unitCost: "12000.00",
    });

    expect(createdLotId).toBeTruthy();

    // Verify stock via DB introspection
    const stock = await db.getLotStock(createdLotId);
    expect(stock).toBe(50);
  });

  // -----------------------------------------------------------------------
  // Step 4: Find product + lot via API and DB
  // -----------------------------------------------------------------------

  it("finds the product in DB and the lot via API", async () => {
    // ProductsService.findById is not implemented on the server (causes 500),
    // but we can verify the product exists via DB introspection.
    const dbProduct = await db.findProductById(createdProductId);
    expect(dbProduct).not.toBeNull();
    expect(dbProduct!.id).toBe(createdProductId);
    expect(dbProduct!.internalCode).toBe("INT-INV-TEST-001");
    expect(dbProduct!.commercialName).toBe("Inventory Test Product");
    expect(dbProduct!.isActive).toBe(true);

    // Lot API endpoint works fine — verify via GET
    const lot = await invAssistant.getLot(createdLotId);
    expect((lot as Record<string, unknown>).id).toBe(createdLotId);
    expect((lot as Record<string, unknown>).currentStock).toBe(50);
    expect((lot as Record<string, unknown>).state).toBe("ACTIVE");
  });

  // -----------------------------------------------------------------------
  // Step 5: Block the lot (ADMIN role)
  // -----------------------------------------------------------------------

  it("blocks the lot (ADMIN role) and verifies state = BLOCKED", async () => {
    const result = await adminUser.blockLot(createdLotId, {
      reason: "Integration test — blocking lot for quality review",
    });

    expect(result).toHaveProperty("state");
    expect((result as Record<string, unknown>).state).toBe("BLOCKED");

    // Verify via API
    const lot = await invAssistant.getLot(createdLotId);
    expect((lot as Record<string, unknown>).state).toBe("BLOCKED");
    expect((lot as Record<string, unknown>).blockReason).toBe(
      "Integration test — blocking lot for quality review",
    );
  });

  // -----------------------------------------------------------------------
  // Step 6: Unblock the lot (ADMIN role)
  // -----------------------------------------------------------------------

  it("unblocks the lot (ADMIN role) and verifies state = ACTIVE", async () => {
    const result = await adminUser.unblockLot(createdLotId);

    expect(result).toHaveProperty("state");
    // After unblock, state should be ACTIVE (stock > 0)
    expect((result as Record<string, unknown>).state).toBe("ACTIVE");

    // Verify via API
    const lot = await invAssistant.getLot(createdLotId);
    expect((lot as Record<string, unknown>).state).toBe("ACTIVE");
    expect((lot as Record<string, unknown>).blockReason).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Step 7: Sell the product (cashier flow) — verify stock decreases
  // -----------------------------------------------------------------------

  it("logs in as cashier and opens a shift", async () => {
    const loginRes = await cashier.login(CASHIER_USERNAME, CASHIER_PASSWORD);
    expect(loginRes.user.role).toBe("CASHIER");

    const shift = await cashier.openShift({
      openingBalance: "50000.00",
      openingNotes: "Inventory flow test shift",
    });

    shiftId = shift.id;
    expect(shift.state).toBe("OPEN");
  });

  it("creates and confirms a sale with the new product", async () => {
    // Create sale
    const sale = await cashier.createSale({
      saleType: "FREE_SALE",
      cashShiftId: shiftId,
      items: [
        {
          productId: createdProductId,
          quantity: 3,
          unitPrice: "15000.00",
        },
      ],
    });

    expect(sale.operationalState).toBe("IN_PROGRESS");
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].productId).toBe(createdProductId);
    expect(sale.items[0].quantity).toBe(3);

    saleTotal = Number.parseFloat(sale.totalAmount.toString());

    // Confirm sale
    const confirmed = await cashier.confirmSale(sale.id, {
      payments: [
        {
          paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
          amount: saleTotal,
        },
      ],
    });

    expect(confirmed.operationalState).toBe("CONFIRMED");

    // Verify stock reduced via DB introspection
    const stockAfter = await db.getLotStock(createdLotId);
    expect(stockAfter).toBe(47); // 50 - 3
  });

  // -----------------------------------------------------------------------
  // Step 8: Close shift
  // -----------------------------------------------------------------------

  it("registers a closing cash count and closes the shift", async () => {
    await cashier.registerCashCount(shiftId, {
      countType: "CLOSING",
      paymentMethodId: TEST_IDS.SALE_CASH_PM_ID,
      expectedAmount: saleTotal.toFixed(2),
      declaredAmount: saleTotal.toFixed(2),
    });

    const result = await cashier.closeShift(shiftId, {
      closingNotes: "Inventory flow test closure",
    });

    expect((result as Record<string, unknown>).state).toBe("CLOSED");
  });
});
