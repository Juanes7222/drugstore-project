/**
 * Test database helper.
 *
 * Connects directly to the test PostgreSQL (via PrismaClient from
 * `@pharmacy/database`) to seed initial data and clean up state between tests.
 *
 * ## Why direct database access instead of API calls
 *
 * - Seeding admin users requires a hashed password that can only be created
 *   by the server's `PasswordHasherService`.  By inserting the hash directly,
 *   we avoid depending on a public registration endpoint that doesn't exist.
 * - Cleanup (truncating tables) is faster and more reliable than issuing
 *   DELETE API calls for every record created during a test.
 * - Introspection (checking what the server stored) lets us verify that API
 *   calls had the intended side effects without exposing internal data via a
 *   test-only endpoint.
 *
 * ## Usage
 *
 * ```ts
 * const db = new TestDatabase();
 * await db.seedAdminUser({ username: "admin", password: "Test123!" });
 * // ... run tests ...
 * await db.truncateAll();
 * await db.close();
 * ```
 */
import { PrismaClient } from "@pharmacy/database";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DATABASE_URL =
  "postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db";

/**
 * Well-known IDs used by the test harness so tests can reference them.
 *
 * Some endpoints (e.g. POST /sales-pos via CreateSaleSchema, POST /cash-shifts/:id/cash-counts
 * via RegisterCashCountSchema) validate certain fields with z.uuid().  Use valid UUIDs
 * for all seeded data to pass that validation.
 */
export const TEST_IDS = {
  WORKSTATION: "integration-test-ws-001",
  ADMIN_USER: "integration-test-admin-001",
  ADMIN_USERNAME: "admin@pharmacy.test",
  ADMIN_PASSWORD: "AdminTest123!",
  /** Role that can create users (must match @Roles(RoleType.OWNER, RoleType.MANAGER) in users.controller). */
  ADMIN_ROLE: "OWNER",

  // Sale flow identifiers (valid UUIDv4 for Zod z.uuid() validation — 3rd group must start with 4, 4th with 8/9/a/b)
  SALE_PRODUCT_ID: "10000000-0000-4000-a000-000000000001",
  SALE_TAX_SCHEME_ID: "20000000-0000-4000-a000-000000000001",
  SALE_LOT_ID: "30000000-0000-4000-a000-000000000001",
  SALE_CASH_PM_ID: "40000000-0000-4000-a000-000000000001",
  SALE_PRICE_HISTORY_ID: "50000000-0000-4000-a000-000000000001",
  SALE_TAX_HISTORY_ID: "60000000-0000-4000-a000-000000000001",
  SALE_SUPPLIER_ID: "70000000-0000-4000-a000-000000000001",
  SALE_PURCHASE_RECEPTION_ID: "80000000-0000-4000-a000-000000000001",
  SALE_FISCAL_RESOLUTION_ID: "90000000-0000-4000-a000-000000000001",
  SALE_FISCAL_ALLOCATION_ID: "a0000000-0000-4000-a000-000000000001",
} as const;

/** Seed data constants shared across sale flow tests. */
export const SALE_SEED = {
  PRODUCT_INTERNAL_CODE: "INT-PROD-SALE-001",
  PRODUCT_NAME: "Sale Test Product",
  BATCH_NUMBER: "BATCH-SALE-001",
  INITIAL_STOCK: 100,
  SALE_QUANTITY: 3,
  UNIT_PRICE: "15000.00",
  TAX_RATE: "0.1900",
  TAX_CODE: "IVA19",
} as const;

// ---------------------------------------------------------------------------
// TestDatabase
// ---------------------------------------------------------------------------

export interface SeedUserOptions {
  id: string;
  username: string;
  password: string;
  role: string;
  fullName?: string;
}

export class TestDatabase {
  private prisma: PrismaClient;

  constructor(databaseUrl?: string) {
    const url = databaseUrl ?? process.env.TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL;
    const adapter = new PrismaPg({ connectionString: url });
    this.prisma = new PrismaClient({ adapter });
  }

  /** Connect to the database. */
  async connect(): Promise<void> {
    await this.prisma.$connect();
  }

  /** Disconnect from the database. */
  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Truncate all tables in the public schema.
   *
   * Uses a single `TRUNCATE` statement with `CASCADE` to handle foreign keys.
   * Skips Prisma's `_Migration` and `_prisma_migrations` tables.
   */
  async truncateAll(): Promise<void> {
    // Disable FK checks temporarily for the truncation
    await this.prisma.$executeRawUnsafe(`SET session_replication_role = 'replica';`);

    const tables = await this.prisma.$queryRawUnsafe<
      Array<{ tablename: string }>
    >(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename NOT LIKE '%migration%'
         AND tablename NOT LIKE '_prisma%'`,
    );

    if (tables.length > 0) {
      const tableNames = tables.map((t) => `"${t.tablename}"`).join(", ");
      await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE;`);
    }

    await this.prisma.$executeRawUnsafe(`SET session_replication_role = 'origin';`);
  }

  // -----------------------------------------------------------------------
  // Seeding
  // -----------------------------------------------------------------------

  /**
   * Seed a workstation used by integration tests.
   */
  async seedWorkstation(overrides?: {
    id?: string;
    name?: string;
    code?: string;
  }): Promise<void> {
    const id = overrides?.id ?? TEST_IDS.WORKSTATION;
    await this.prisma.workstation.upsert({
      where: { id },
      create: {
        id,
        name: overrides?.name ?? "Integration Test Workstation",
        code: overrides?.code ?? "WS-INT-001",
        isActive: true,
        registeredAt: new Date(),
      },
      update: {},
    });
  }

  /**
   * Seed a user with a known password (argon2-hashed).
   *
   * The user will be created with `ACTIVE` status and can be used to log in
   * via the standard `POST /auth/login` endpoint.
   */
  async seedUser(options: SeedUserOptions): Promise<void> {
    const passwordHash = await argon2.hash(options.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    await this.prisma.user.upsert({
      where: { id: options.id },
      create: {
        id: options.id,
        username: options.username,
        fullName: options.fullName ?? options.username,
        passwordHash,
        passwordAlgorithm: "argon2id",
        role: options.role,
        status: "ACTIVE",
        isActive: true,
        authMethod: "PASSWORD_ONLY",
        emailVerifiedAt: new Date(),
      },
      update: {
        passwordHash,
        passwordAlgorithm: "argon2id",
        status: "ACTIVE",
        isActive: true,
      },
    });
  }

  /**
   * Seed the default admin user and workstation.
   *
   * Convenience wrapper — calls both `seedWorkstation()` and `seedUser()`
   * with the well-known test admin credentials.
   */
  async seedDefaults(): Promise<void> {
    await this.seedWorkstation();
    await this.seedUser({
      id: TEST_IDS.ADMIN_USER,
      username: TEST_IDS.ADMIN_USERNAME,
      password: TEST_IDS.ADMIN_PASSWORD,
      role: TEST_IDS.ADMIN_ROLE,
      fullName: "Integration Test Admin",
    });
  }

  // -----------------------------------------------------------------------
  // Sale data seeding
  // -----------------------------------------------------------------------

  /**
   * Seed the test data needed for a sale lifecycle test.
   *
   * Creates: tax scheme, product, price history, tax history, lot with stock,
   * and a cash payment method.
   */
  async seedSaleData(): Promise<void> {
    const adminId = TEST_IDS.ADMIN_USER;

    // 1. Tax scheme
    await this.prisma.taxScheme.create({
      data: {
        id: TEST_IDS.SALE_TAX_SCHEME_ID,
        code: SALE_SEED.TAX_CODE,
        name: "IVA 19%",
        taxType: "IVA",
        rate: SALE_SEED.TAX_RATE,
        effectiveFrom: new Date("2024-01-01"),
        isActive: true,
        createdById: adminId,
      },
    });

    // 2. Product
    await this.prisma.product.create({
      data: {
        id: TEST_IDS.SALE_PRODUCT_ID,
        internalCode: SALE_SEED.PRODUCT_INTERNAL_CODE,
        commercialName: SALE_SEED.PRODUCT_NAME,
        genericName: "Test Generic",
        activePrinciple: "Test Principle",
        laboratory: "Test Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: adminId,
      },
    });

    // 3. Product price history
    await this.prisma.productPriceHistory.create({
      data: {
        id: TEST_IDS.SALE_PRICE_HISTORY_ID,
        productId: TEST_IDS.SALE_PRODUCT_ID,
        price: SALE_SEED.UNIT_PRICE,
        effectiveFrom: new Date(),
        changedById: adminId,
        changedAt: new Date(),
      },
    });

    // 4. Product tax history
    await this.prisma.productTaxHistory.create({
      data: {
        id: TEST_IDS.SALE_TAX_HISTORY_ID,
        productId: TEST_IDS.SALE_PRODUCT_ID,
        taxSchemeId: TEST_IDS.SALE_TAX_SCHEME_ID,
        effectiveFrom: new Date(),
        changedById: adminId,
        changedAt: new Date(),
      },
    });

    // 5. Update product with current price & tax pointers
    await this.prisma.product.update({
      where: { id: TEST_IDS.SALE_PRODUCT_ID },
      data: {
        currentPriceId: TEST_IDS.SALE_PRICE_HISTORY_ID,
        currentTaxHistoryId: TEST_IDS.SALE_TAX_HISTORY_ID,
      },
    });

    // 6. Supplier (needed for PurchaseReception FK)
    await this.prisma.supplier.create({
      data: {
        id: TEST_IDS.SALE_SUPPLIER_ID,
        identificationType: "NIT",
        identificationNumber: "900999999-1",
        businessName: "Test Supplier for Sale Flow",
        createdById: adminId,
      },
    });

    // 7. Lot with stock
    await this.prisma.lot.create({
      data: {
        id: TEST_IDS.SALE_LOT_ID,
        batchNumber: SALE_SEED.BATCH_NUMBER,
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date("2024-06-01"),
        state: "ACTIVE",
        currentStock: SALE_SEED.INITIAL_STOCK,
        version: 0,
        productId: TEST_IDS.SALE_PRODUCT_ID,
      },
    });

    // 8. Purchase reception (needed for PurchaseReceptionItem FK)
    await this.prisma.purchaseReception.create({
      data: {
        id: TEST_IDS.SALE_PURCHASE_RECEPTION_ID,
        sequentialNumber: 999999,
        state: "CONFIRMED",
        receivedAt: new Date("2024-06-01"),
        createdById: adminId,
        supplierId: TEST_IDS.SALE_SUPPLIER_ID,
        subtotal: (SALE_SEED.INITIAL_STOCK * 12000).toFixed(2),
        totalAmount: (SALE_SEED.INITIAL_STOCK * 12000).toFixed(2),
      },
    });

    // 9. Purchase reception item for FIFO cost tracking
    // (The lotsService.consumeStockForSale queries purchaseReceptionItem.realUnitCost
    //  to determine the cost of each lot at sale time.)
    await this.prisma.purchaseReceptionItem.create({
      data: {
        id: crypto.randomUUID(),
        purchaseReceptionId: TEST_IDS.SALE_PURCHASE_RECEPTION_ID,
        productId: TEST_IDS.SALE_PRODUCT_ID,
        lotId: TEST_IDS.SALE_LOT_ID,
        receivedQuantity: SALE_SEED.INITIAL_STOCK,
        realUnitCost: "12000.00",
        taxSchemeId: TEST_IDS.SALE_TAX_SCHEME_ID,
        subtotal: (SALE_SEED.INITIAL_STOCK * 12000).toFixed(2),
        total: (SALE_SEED.INITIAL_STOCK * 12000).toFixed(2),
      },
    });

    // 10. Fiscal resolution (needed for sale confirmation — createPendingDocumentForSale
    //     calls allocateDocumentNumber which requires an active INVOICE allocation)
    await this.prisma.fiscalResolution.create({
      data: {
        id: TEST_IDS.SALE_FISCAL_RESOLUTION_ID,
        resolutionNumber: "RES-INT-TEST-001",
        documentType: "INVOICE",
        prefix: "TST",
        rangeFrom: 1,
        rangeTo: 999999,
        validFrom: new Date("2024-01-01"),
        validTo: new Date("2030-12-31"),
        state: "ACTIVE",
      },
    });

    // 11. Fiscal resolution allocation (binds the resolution to the test workstation)
    await this.prisma.fiscalResolutionAllocation.create({
      data: {
        id: TEST_IDS.SALE_FISCAL_ALLOCATION_ID,
        resolutionId: TEST_IDS.SALE_FISCAL_RESOLUTION_ID,
        workstationId: TEST_IDS.WORKSTATION,
        rangeFrom: 1,
        rangeTo: 999999,
        allocatedAt: new Date("2024-01-01"),
        allocatedByUserId: adminId,
      },
    });

    // 12. Cash payment method
    await this.prisma.paymentMethod.create({
      data: {
        id: TEST_IDS.SALE_CASH_PM_ID,
        internalCode: "CASH",
        name: "Cash",
        category: "CASH",
        isCash: true,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Sale data cleanup
  // -----------------------------------------------------------------------

  /**
   * Remove sale-specific seed data.  Call in afterAll or between tests.
   *
   * Uses individual deletes (not TRUNCATE) so it can be called without
   * affecting other test data (admin user, workstation, etc.).
   */
  async cleanupSaleData(): Promise<void> {
    await this.prisma.inventoryMovement.deleteMany({ where: { lotId: TEST_IDS.SALE_LOT_ID } });
    await this.prisma.saleItemLot.deleteMany({ where: { lotId: TEST_IDS.SALE_LOT_ID } });
    await this.prisma.salePayment.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_IDS.WORKSTATION } } } });
    await this.prisma.saleItem.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_IDS.WORKSTATION } } } });
    await this.prisma.sale.deleteMany({ where: { cashShift: { workstationId: TEST_IDS.WORKSTATION } } });
    await this.prisma.shiftCashCount.deleteMany({ where: { cashShift: { workstationId: TEST_IDS.WORKSTATION } } });
    await this.prisma.cashShift.deleteMany({ where: { workstationId: TEST_IDS.WORKSTATION } });
    await this.prisma.fiscalDocument.deleteMany({ where: { allocationId: TEST_IDS.SALE_FISCAL_ALLOCATION_ID } });
    await this.prisma.fiscalResolutionAllocation.deleteMany({ where: { id: TEST_IDS.SALE_FISCAL_ALLOCATION_ID } });
    await this.prisma.fiscalResolution.deleteMany({ where: { id: TEST_IDS.SALE_FISCAL_RESOLUTION_ID } });
    await this.prisma.inventoryMovement.deleteMany({ where: { lotId: TEST_IDS.SALE_LOT_ID } });
    await this.prisma.saleItemLot.deleteMany({ where: { lotId: TEST_IDS.SALE_LOT_ID } });
    await this.prisma.salePayment.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_IDS.WORKSTATION } } } });
    await this.prisma.saleItem.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_IDS.WORKSTATION } } } });
    await this.prisma.sale.deleteMany({ where: { cashShift: { workstationId: TEST_IDS.WORKSTATION } } });
    await this.prisma.shiftCashCount.deleteMany({ where: { cashShift: { workstationId: TEST_IDS.WORKSTATION } } });
    await this.prisma.cashShift.deleteMany({ where: { workstationId: TEST_IDS.WORKSTATION } });
    await this.prisma.purchaseReceptionItem.deleteMany({ where: { lotId: TEST_IDS.SALE_LOT_ID } });
    await this.prisma.purchaseReception.deleteMany({ where: { id: TEST_IDS.SALE_PURCHASE_RECEPTION_ID } });
    await this.prisma.lot.deleteMany({ where: { id: TEST_IDS.SALE_LOT_ID } });
    await this.prisma.productTaxHistory.deleteMany({ where: { productId: TEST_IDS.SALE_PRODUCT_ID } });
    await this.prisma.productPriceHistory.deleteMany({ where: { productId: TEST_IDS.SALE_PRODUCT_ID } });
    await this.prisma.productBarcode.deleteMany({ where: { productId: TEST_IDS.SALE_PRODUCT_ID } });
    await this.prisma.product.deleteMany({ where: { id: TEST_IDS.SALE_PRODUCT_ID } });
    await this.prisma.taxScheme.deleteMany({ where: { id: TEST_IDS.SALE_TAX_SCHEME_ID } });
    await this.prisma.paymentMethod.deleteMany({ where: { id: TEST_IDS.SALE_CASH_PM_ID } });
    await this.prisma.supplier.deleteMany({ where: { id: TEST_IDS.SALE_SUPPLIER_ID } });
  }

  // -----------------------------------------------------------------------
  // Introspection helpers
  // -----------------------------------------------------------------------

  /**
   * Count users by role.
   */
  async countUsersByRole(): Promise<Record<string, number>> {
    const rows = await this.prisma.user.groupBy({
      by: ["role"],
      _count: { id: true },
    });
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.role] = row._count.id;
    }
    return result;
  }

  /**
   * Find a user by username.
   */
  async findUserByUsername(username: string) {
    return this.prisma.user.findFirst({ where: { username } });
  }

  /**
   * Find a user by id.
   */
  async findUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Find a product by id.
   */
  async findProductById(id: string) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  /**
   * Find sync queue entries matching the given filters.
   */
  async findSyncQueueEntries(params: {
    status?: string;
    operationType?: string;
    limit?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (params.status) where.status = params.status;
    if (params.operationType) where.operationType = params.operationType;
    return this.prisma.syncQueue.findMany({
      where: where as any,
      orderBy: { receivedAt: 'desc' },
      take: params.limit ?? 10,
    });
  }

  /**
   * Find confirmed sales by cash shift ID.
   */
  async findSalesByCashShift(cashShiftId: string) {
    return this.prisma.sale.findMany({
      where: { cashShiftId },
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Get the current stock for a lot.
   */
  async getLotStock(lotId: string): Promise<number> {
    const lot = await this.prisma.lot.findUnique({
      where: { id: lotId },
      select: { currentStock: true },
    });
    return lot?.currentStock ?? -1;
  }

  /**
   * Create a lot with stock and the associated purchase reception / item
   * needed for FIFO cost tracking.  Returns the new lot ID.
   *
   * The caller must ensure the referenced supplier and tax scheme already
   * exist in the database.
   */
  async seedLotForProduct(params: {
    productId: string;
    supplierId: string;
    taxSchemeId: string;
    batchNumber?: string;
    initialStock?: number;
    unitCost?: string;
  }): Promise<string> {
    const batch = params.batchNumber ?? `BATCH-${crypto.randomUUID().slice(0, 8)}`;
    const stock = params.initialStock ?? 100;
    const cost = params.unitCost ?? "12000.00";

    const lotId = crypto.randomUUID();
    const receptionId = crypto.randomUUID();

    await this.prisma.lot.create({
      data: {
        id: lotId,
        productId: params.productId,
        batchNumber: batch,
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date(),
        state: "ACTIVE",
        currentStock: stock,
        version: 0,
      },
    });

    await this.prisma.purchaseReception.create({
      data: {
        id: receptionId,
        sequentialNumber: Math.floor(Math.random() * 900000) + 100000,
        state: "CONFIRMED",
        receivedAt: new Date(),
        createdById: TEST_IDS.ADMIN_USER,
        supplierId: params.supplierId,
        subtotal: (stock * Number.parseFloat(cost)).toFixed(2),
        totalAmount: (stock * Number.parseFloat(cost)).toFixed(2),
      },
    });

    await this.prisma.purchaseReceptionItem.create({
      data: {
        id: crypto.randomUUID(),
        purchaseReceptionId: receptionId,
        productId: params.productId,
        lotId,
        receivedQuantity: stock,
        realUnitCost: cost,
        taxSchemeId: params.taxSchemeId,
        subtotal: (stock * Number.parseFloat(cost)).toFixed(2),
        total: (stock * Number.parseFloat(cost)).toFixed(2),
      },
    });

    return lotId;
  }

  /**
   * Delete a lot and its associated purchase reception / item by lot ID.
   */
  async cleanupLot(lotId: string): Promise<void> {
    // Find reception IDs BEFORE deleting items (otherwise query returns empty)
    const items = await this.prisma.purchaseReceptionItem.findMany({
      where: { lotId },
      select: { purchaseReceptionId: true },
    });
    const receptionIds = [...new Set(items.map(i => i.purchaseReceptionId))];

    await this.prisma.inventoryMovement.deleteMany({ where: { lotId } });
    await this.prisma.saleItemLot.deleteMany({ where: { lotId } });
    await this.prisma.purchaseReceptionItem.deleteMany({ where: { lotId } });

    for (const rid of receptionIds) {
      await this.prisma.purchaseReception.deleteMany({ where: { id: rid } });
    }
    await this.prisma.lot.deleteMany({ where: { id: lotId } });
  }

  /**
   * Delete a product and its related records (barcodes, price/tax history).
   * Safe to call even for products that were created dynamically during a test.
   */
  async deleteProduct(productId: string): Promise<void> {
    await this.prisma.productBarcode.deleteMany({ where: { productId } });
    await this.prisma.productPriceHistory.deleteMany({ where: { productId } });
    await this.prisma.productTaxHistory.deleteMany({ where: { productId } });
    await this.prisma.product.deleteMany({ where: { id: productId } });
  }

  /**
   * Seed a tax scheme with the given values.
   */
  async seedTaxScheme(params: {
    id: string;
    code: string;
    name: string;
    taxType: string;
    rate: string;
    createdById?: string;
  }): Promise<void> {
    await this.prisma.taxScheme.create({
      data: {
        id: params.id,
        code: params.code,
        name: params.name,
        taxType: params.taxType,
        rate: params.rate,
        effectiveFrom: new Date("2024-01-01"),
        isActive: true,
        createdById: params.createdById ?? TEST_IDS.ADMIN_USER,
      },
    });
  }

  /**
   * Delete a tax scheme by ID.
   */
  async deleteTaxScheme(id: string): Promise<void> {
    // ProductTaxHistory references must be deleted first
    await this.prisma.productTaxHistory.deleteMany({ where: { taxSchemeId: id } });
    await this.prisma.purchaseReceptionItem.deleteMany({ where: { taxSchemeId: id } });
    await this.prisma.taxScheme.deleteMany({ where: { id } });
  }
}
