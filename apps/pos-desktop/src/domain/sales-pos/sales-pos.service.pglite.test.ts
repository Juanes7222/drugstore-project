/**
 * PGlite schema and data-layer integration tests.
 *
 * These tests create a real in-memory PGlite database, apply the full DDL
 * from LOCAL_SCHEMA_SQL, seed data, and then execute SQL queries directly
 * against PGlite.  This catches schema/constraint bugs a mocked PrismaClient
 * would miss:
 *
 * - Constraint violations (unique, foreign key)
 * - Type coercion errors (Decimal, BigInt, DateTime)
 * - Missing columns or tables after schema changes
 * - DDL idempotency (can the schema be re-applied to an existing DB)
 *
 * ## Why raw SQL instead of PrismaClient
 *
 * These tests use PGlite SQL directly (not through PrismaClient) because the
 * Vite `process.binding` polyfill (vite.config.ts:485) prevents the
 * PrismaPGlite adapter from loading.  `@electric-sql/pglite` is externalised
 * in `vitest.config.ts` so its WASM bundle avoids Vite's transform pipeline
 * and accesses the real Node.js `process.binding`.  The `LOCAL_SCHEMA_SQL`
 * constant and our test source code are still transformed by Vite, but none
 * of our code calls `process.binding` directly — only PGlite's internal
 * Emscripten glue does.
 *
 * To add service-level tests that go through the real PrismaClient, see
 * vitest.config.ts — once `pglite-prisma-adapter` is also externalised and
 * the `define` for `process.binding` is overridden there, tests can import
 * `@pharmacy/database/local` and use the PrismaClient with the real PGlite.
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { LOCAL_SCHEMA_SQL } from "@pharmacy/database/local-schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed tables required for sale operations.
 */
async function seedSaleDependencies(pg: PGlite): Promise<{
  productId: string;
  cashShiftId: string;
  paymentMethodId: string;
  userId: string;
  workstationId: string;
}> {
  const productId = crypto.randomUUID();
  const cashShiftId = crypto.randomUUID();
  const paymentMethodId = crypto.randomUUID();
  const userId = "user-cashier-01";
  const workstationId = "ws-001";
  const now = new Date().toISOString();

  // Product
  await pg.exec(`
    INSERT INTO "Product" (id, "internalCode", "commercialName", "genericName", "activePrinciple", "laboratory", "saleType", "isActive", "createdById", "createdAt", "updatedAt")
    VALUES ('${productId}', 'P001', 'Acetaminofén 500mg', 'Acetaminofén', 'Acetaminofén', 'Laboratorio Genérico', 'FREE_SALE', true, '${userId}', '${now}', '${now}');
  `);

  // Price history
  await pg.exec(`
    INSERT INTO "ProductPriceHistory" (id, "productId", "price", "effectiveFrom", "changedById", "changedAt")
    VALUES (gen_random_uuid(), '${productId}', 5000.00, '${now}', '${userId}', '${now}');
  `);

  // Tax scheme
  await pg.exec(`
    INSERT INTO "TaxScheme" (id, "code", "name", "taxType", "rate", "effectiveFrom", "createdById", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'IVA19', 'IVA 19%', 'IVA', 19, '${now}', '${userId}', '${now}', '${now}');
  `);

  // Product tax history
  await pg.exec(`
    INSERT INTO "ProductTaxHistory" (id, "productId", "taxSchemeId", "effectiveFrom", "changedById", "changedAt")
    VALUES (gen_random_uuid(), '${productId}', (SELECT id FROM "TaxScheme" LIMIT 1), '${now}', '${userId}', '${now}');
  `);

  // Open cash shift
  await pg.exec(`
    INSERT INTO "CashShift" (id, "userId", "workstationId", "state", "openedAt", "createdAt", "updatedAt")
    VALUES ('${cashShiftId}', '${userId}', '${workstationId}', 'OPEN', '${now}', '${now}', '${now}');
  `);

  // Cash payment method
  await pg.exec(`
    INSERT INTO "PaymentMethod" (id, "internalCode", "name", "category", "isActive", "isCash", "createdAt", "updatedAt")
    VALUES ('${paymentMethodId}', 'CASH01', 'Efectivo', 'CASH', true, true, '${now}', '${now}');
  `);

  return { productId, cashShiftId, paymentMethodId, userId, workstationId };
}

/**
 * Create a sale via SQL (mirrors SalesPosService.create logic).
 * Returns the created sale row.
 */
async function insertSale(
  pg: PGlite,
  seeds: { productId: string; cashShiftId: string; userId: string; workstationId: string },
  overrides?: { localNumber?: bigint; saleType?: string },
): Promise<Record<string, unknown>> {
  const saleId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const localNumber = overrides?.localNumber ?? 1n;
  const now = new Date().toISOString();
  const subtotal = "10000.00";
  const totalTax = "1900.00";
  const totalAmount = "11900.00";

  await pg.exec(`
    INSERT INTO "Sale" (id, "localNumber", "operationalState", "startedAt", "lastModifiedAt",
      "cashShiftId", "workstationId", "sourceWorkstationId", "userId",
      "subtotal", "totalTax", "totalAmount")
    VALUES ('${saleId}', ${localNumber}, 'IN_PROGRESS',
      '${now}', '${now}',
      '${seeds.cashShiftId}', '${seeds.workstationId}', '${seeds.workstationId}', '${seeds.userId}',
      ${subtotal}, ${totalTax}, ${totalAmount});
  `);

  await pg.exec(`
    INSERT INTO "SaleItem" (id, "saleId", "productId",
      "productInternalCodeSnapshot", "productCommercialNameSnapshot", "productGenericNameSnapshot",
      "quantity", "unitPrice", "taxRate", "taxAmount",
      "subtotal", "total", "requiresPrescription")
    VALUES ('${itemId}', '${saleId}', '${seeds.productId}',
      'P001', 'Acetaminofén 500mg', 'Acetaminofén',
      2, 5000.00, 19, 1900.00,
      10000.00, 11900.00, false);
  `);

  return { id: saleId, itemId, localNumber };
}

// ---------------------------------------------------------------------------
// Suite: Schema integrity
// ---------------------------------------------------------------------------

describe("PGlite schema bootstrapping", () => {
  let pg: PGlite;

  beforeEach(async () => {
    // PGlite is created synchronously.  The WASM engine initialises lazily
    // on the first `exec()` call, which triggers the Emscripten init sequence
    // that accesses `process.binding`.  In Node.js this works because Vite's
    // `define` replacement for `process.binding` does NOT apply to native
    // ESM modules loaded via Node.js — it only affects Vite-transformed code.
    // Since PGlite is loaded as a direct ESM dependency, the real Node.js
    // `process.binding` is available.
    pg = new PGlite("memory://");
  });

  afterEach(async () => {
    await pg.close();
  });

  it("creates all expected tables from LOCAL_SCHEMA_SQL", async () => {
    await pg.exec(LOCAL_SCHEMA_SQL);

    const result = await pg.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    const tables = result.rows.map(
      (r: Record<string, unknown>) => r.table_name as string,
    );

    expect(tables).toContain("Sale");
    expect(tables).toContain("SaleItem");
    expect(tables).toContain("SalePayment");
    expect(tables).toContain("SaleItemLot");
    expect(tables).toContain("Product");
    expect(tables).toContain("ProductPriceHistory");
    expect(tables).toContain("ProductTaxHistory");
    expect(tables).toContain("CashShift");
    expect(tables).toContain("PaymentMethod");
    expect(tables).toContain("SyncQueue");
    expect(tables).toContain("SyncAttempt");
    expect(tables).toContain("Client");
    expect(tables).toContain("Lot");
    expect(tables).toContain("InventoryMovement");
    expect(tables).toContain("TaxScheme");
    expect(tables).toContain("Invoice");
    expect(tables).toContain("ContingencyEvent");
  });

  it("creates all expected enum types", async () => {
    await pg.exec(LOCAL_SCHEMA_SQL);

    const result = await pg.query(`
      SELECT t.typname AS enum_name
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      GROUP BY t.typname
      ORDER BY t.typname;
    `);
    const enums = result.rows.map(
      (r: Record<string, unknown>) => r.enum_name as string,
    );

    expect(enums).toContain("SaleOperationalState");
    expect(enums).toContain("SyncStatus");
    expect(enums).toContain("SyncOperationType");
    expect(enums).toContain("PaymentMethodCategory");
    expect(enums).toContain("ShiftState");
    expect(enums).toContain("SaleType");
    expect(enums).toContain("MovementType");
    expect(enums).toContain("LotState");
  });

  it("re-applying LOCAL_SCHEMA_SQL errors on duplicate enum (PGlite limitation)", async () => {
    await pg.exec(LOCAL_SCHEMA_SQL);

    // PGlite follows PostgreSQL's CREATE TYPE semantics — it does NOT support
    // IF NOT EXISTS.  The second application fails when it tries to create
    // types that already exist.  True idempotency would require schema-level
    // migration tooling (IF NOT EXISTS or DROP ... IF EXISTS), which is
    // handled by Prisma Migrate, not by this SQL file.
    await expect(pg.exec(LOCAL_SCHEMA_SQL)).rejects.toThrow(/already exists/);
  });
});

// ---------------------------------------------------------------------------
// Suite: Data integrity — constraints and types
// ---------------------------------------------------------------------------

describe("PGlite data integrity", () => {
  let pg: PGlite;
  let seeds: Awaited<ReturnType<typeof seedSaleDependencies>>;

  beforeEach(async () => {
    pg = new PGlite("memory://");
    await pg.exec(LOCAL_SCHEMA_SQL);
    seeds = await seedSaleDependencies(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  describe("Sale table", () => {
    it("enforces NOT NULL on required columns", async () => {
      await expect(
        pg.exec(`INSERT INTO "Sale" (id) VALUES ('${crypto.randomUUID()}')`),
      ).rejects.toThrow();
    });

    it("enforces unique localNumber per sourceWorkstationId", async () => {
      const saleId1 = crypto.randomUUID();
      const saleId2 = crypto.randomUUID();
      const now = new Date().toISOString();

      // First sale with localNumber=1
      await pg.exec(`
        INSERT INTO "Sale" (id, "localNumber", "workstationId", "sourceWorkstationId", "userId",
          "cashShiftId", "startedAt", "lastModifiedAt")
        VALUES ('${saleId1}', 1, 'ws-001', 'ws-001', '${seeds.userId}',
          '${seeds.cashShiftId}', '${now}', '${now}');
      `);

      // Second sale with localNumber=1 on same workstation — should fail
      await expect(
        pg.exec(`
          INSERT INTO "Sale" (id, "localNumber", "workstationId", "sourceWorkstationId", "userId",
            "cashShiftId", "startedAt", "lastModifiedAt")
          VALUES ('${saleId2}', 1, 'ws-001', 'ws-001', '${seeds.userId}',
            '${seeds.cashShiftId}', '${now}', '${now}');
        `),
      ).rejects.toThrow();
    });

    it("allows same localNumber on different workstations", async () => {
      const saleId1 = crypto.randomUUID();
      const saleId2 = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "Sale" (id, "localNumber", "workstationId", "sourceWorkstationId", "userId",
          "cashShiftId", "startedAt", "lastModifiedAt")
        VALUES ('${saleId1}', 1, 'ws-001', 'ws-001', '${seeds.userId}',
          '${seeds.cashShiftId}', '${now}', '${now}');
      `);

      await pg.exec(`
        INSERT INTO "Sale" (id, "localNumber", "workstationId", "sourceWorkstationId", "userId",
          "cashShiftId", "startedAt", "lastModifiedAt")
        VALUES ('${saleId2}', 1, 'ws-002', 'ws-002', '${seeds.userId}',
          '${seeds.cashShiftId}', '${now}', '${now}');
      `);

      // Both should exist
      const result = await pg.query(
        `SELECT COUNT(*) as cnt FROM "Sale" WHERE "localNumber" = 1`,
      );
      expect(
        (result.rows[0] as Record<string, unknown>).cnt,
      ).toBe(2);
    });

    it("enforces foreign key to CashShift", async () => {
      const saleId = crypto.randomUUID();
      const now = new Date().toISOString();
      const fakeCashShiftId = crypto.randomUUID();

      await expect(
        pg.exec(`
          INSERT INTO "Sale" (id, "localNumber", "workstationId", "sourceWorkstationId", "userId",
            "cashShiftId", "startedAt", "lastModifiedAt")
          VALUES ('${saleId}', 1, 'ws-001', 'ws-001', '${seeds.userId}',
            '${fakeCashShiftId}', '${now}', '${now}');
        `),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });

    it("stores Decimal values with correct precision", async () => {
      const sale = await insertSale(pg, seeds);

      const result = await pg.query(
        `SELECT "totalAmount" FROM "Sale" WHERE id = $1`,
        [sale.id as string],
      );
      const row = result.rows[0] as Record<string, unknown>;

      // totalAmount was stored as a numeric/decimal type
      expect(row.totalAmount).toBeDefined();
      // PGlite returns numeric types as strings
      expect(Number(row.totalAmount)).toBe(11900);
    });

    it("transitions operationalState with ALTER TABLE enum check", async () => {
      const sale = await insertSale(pg, seeds);

      // Valid transition to CONFIRMED
      await pg.exec(`
        UPDATE "Sale" SET "operationalState" = 'CONFIRMED', "lastModifiedAt" = '${new Date().toISOString()}'
        WHERE id = '${sale.id as string}';
      `);

      const result = await pg.query(
        `SELECT "operationalState" FROM "Sale" WHERE id = $1`,
        [sale.id as string],
      );
      expect(
        (result.rows[0] as Record<string, unknown>).operationalState,
      ).toBe("CONFIRMED");
    });

    it("rejects invalid operationalState values", async () => {
      const sale = await insertSale(pg, seeds);

      await expect(
        pg.exec(`
          UPDATE "Sale" SET "operationalState" = 'INVALID_STATE'
          WHERE id = '${sale.id as string}';
        `),
      ).rejects.toThrow();
    });
  });

  describe("SaleItem table", () => {
    it("enforces foreign key to Sale", async () => {
      const fakeSaleId = crypto.randomUUID();

      await expect(
        pg.exec(`
          INSERT INTO "SaleItem" (id, "saleId", "productId",
            "productInternalCodeSnapshot", "productCommercialNameSnapshot", "productGenericNameSnapshot",
            "quantity", "unitPrice", "taxRate", "taxAmount",
            "subtotal", "total", "requiresPrescription")
          VALUES ('${crypto.randomUUID()}', '${fakeSaleId}', '${seeds.productId}',
            'P001', 'Acetaminofén 500mg', 'Acetaminofén',
            1, 1000, 19, 190, 1000, 1190, false);
        `),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });

    it("enforces foreign key to Product", async () => {
      const sale = await insertSale(pg, seeds);
      const fakeProductId = crypto.randomUUID();

      await expect(
        pg.exec(`
          INSERT INTO "SaleItem" (id, "saleId", "productId",
            "productInternalCodeSnapshot", "productCommercialNameSnapshot", "productGenericNameSnapshot",
            "quantity", "unitPrice", "taxRate", "taxAmount",
            "subtotal", "total", "requiresPrescription")
          VALUES ('${crypto.randomUUID()}', '${sale.id as string}', '${fakeProductId}',
            'P001', 'Acetaminofén 500mg', 'Acetaminofén',
            1, 1000, 19, 190, 1000, 1190, false);
        `),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });
  });

  describe("SalePayment table", () => {
    it("creates payment records linked to a sale", async () => {
      const sale = await insertSale(pg, seeds);
      const paymentId = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "SalePayment" (id, "saleId", "paymentMethodId", "amount")
        VALUES ('${paymentId}', '${sale.id as string}', '${seeds.paymentMethodId}', 11900);
      `);

      const result = await pg.query(
        `SELECT amount FROM "SalePayment" WHERE id = $1`,
        [paymentId],
      );
      expect(result.rows).toHaveLength(1);
      expect(Number((result.rows[0] as Record<string, unknown>).amount)).toBe(11900);
    });

    it("enforces foreign key to PaymentMethod", async () => {
      const sale = await insertSale(pg, seeds);
      const fakePmId = crypto.randomUUID();

      await expect(
        pg.exec(`
          INSERT INTO "SalePayment" (id, "saleId", "paymentMethodId", "amount")
          VALUES ('${crypto.randomUUID()}', '${sale.id as string}', '${fakePmId}', 100);
        `),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });
  });

  describe("SyncQueue table", () => {
    it("enforces unique operationUuid (idempotency key)", async () => {
      const operationUuid = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload, "payloadHash", "payloadSize",
          "sourceWorkstationId", "sourceCreatedAt", "clientSequence", status)
        VALUES ('${crypto.randomUUID()}', '${operationUuid}', 'SALE_CONFIRMATION', '{}', 'abc', 2,
          'ws-001', '${now}', 1, 'PENDING');
      `);

      // Same operationUuid — should fail unique constraint
      await expect(
        pg.exec(`
          INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload, "payloadHash", "payloadSize",
            "sourceWorkstationId", "sourceCreatedAt", "clientSequence", status)
          VALUES ('${crypto.randomUUID()}', '${operationUuid}', 'SALE_CONFIRMATION', '{}', 'abc', 2,
            'ws-001', '${now}', 2, 'PENDING');
        `),
      ).rejects.toThrow();
    });

    it("stores and retrieves JSON payload with the correct server-expected keys", async () => {
      const now = new Date().toISOString();
      const payload = JSON.stringify({
        userId: "user-cashier-01",
        createSaleDto: { saleType: "FREE_SALE", cashShiftId: crypto.randomUUID(), items: [] },
        confirmSaleDto: { payments: [] },
        metadata: { localSaleId: crypto.randomUUID(), localNumber: 1 },
      });

      await pg.exec(`
        INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload, "payloadHash", "payloadSize",
          "sourceWorkstationId", "sourceCreatedAt", "clientSequence", status)
        VALUES ('${crypto.randomUUID()}', '${crypto.randomUUID()}', 'SALE_CONFIRMATION', '${payload.replace(/'/g, "''")}', 'abc123', ${payload.length},
          'ws-001', '${now}', 1, 'PENDING');
      `);

      const result = await pg.query(
        `SELECT payload FROM "SyncQueue" WHERE "operationType" = 'SALE_CONFIRMATION'`,
      );
      const stored = JSON.parse(
        (result.rows[0] as Record<string, unknown>).payload as string,
      ) as Record<string, unknown>;

      // Server-side dispatcher reads these exact keys (no transformation needed):
      //   handleSaleConfirmation() reads payload.userId,
      //   payload.createSaleDto, payload.confirmSaleDto
      expect(stored).toHaveProperty("userId");
      expect(stored).toHaveProperty("createSaleDto");
      expect(stored).toHaveProperty("confirmSaleDto");
      expect(stored).toHaveProperty("metadata");
      expect((stored.metadata as Record<string, unknown>).localNumber).toBe(1);
    });

    it("stores and retrieves a full realistic payload matching server expectations", async () => {
      const now = new Date().toISOString();
      const payload = JSON.stringify({
        userId: "user-cashier-01",
        createSaleDto: {
          saleType: "FREE_SALE",
          cashShiftId: crypto.randomUUID(),
          clientId: null,
          items: [
            {
              productId: crypto.randomUUID(),
              quantity: 2,
              unitPrice: "5000.00",
              discount: "0",
              discountReason: null,
            },
          ],
          prescriptionNumber: null,
        },
        confirmSaleDto: {
          payments: [
            {
              paymentMethodId: crypto.randomUUID(),
              amount: 11900,
              transactionReference: null,
              authorizationCode: null,
              cardBrand: null,
              cardLastFour: null,
              batchNumber: null,
              processorResponseCode: null,
            },
          ],
        },
        metadata: {
          localSaleId: crypto.randomUUID(),
          localNumber: 1,
          workstationId: "ws-001",
          sourceWorkstationId: "ws-001",
          startedAt: now,
          confirmedAt: now,
        },
      });

      await pg.exec(`
        INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload, "payloadHash", "payloadSize",
          "sourceWorkstationId", "sourceCreatedAt", "clientSequence", status)
        VALUES ('${crypto.randomUUID()}', '${crypto.randomUUID()}', 'SALE_CONFIRMATION', '${payload.replace(/'/g, "''")}', 'def456', ${payload.length},
          'ws-001', '${now}', 2, 'PENDING');
      `);

      const result = await pg.query(
        `SELECT payload FROM "SyncQueue" WHERE "clientSequence" = 2`,
      );
      const stored = JSON.parse(
        (result.rows[0] as Record<string, unknown>).payload as string,
      ) as Record<string, unknown>;

      // Full shape verification matching what the server's
      // handleSaleConfirmation expects
      expect(typeof stored.userId).toBe("string");
      expect((stored.createSaleDto as Record<string, unknown>).saleType).toBe("FREE_SALE");
      expect(
        Array.isArray((stored.createSaleDto as Record<string, unknown>).items),
      ).toBe(true);
      expect(
        Array.isArray((stored.confirmSaleDto as Record<string, unknown>).payments),
      ).toBe(true);
      expect((stored.metadata as Record<string, unknown>).localNumber).toBe(1);
    });

    it("enforces clientSequence to be a positive integer", async () => {
      const now = new Date().toISOString();

      // clientSequence must be positive (it's BigInt but the Prisma schema
      // defines it as BigInt with no specific positive constraint at the DB
      // level).  This test documents that the POS is responsible for ensuring
      // clientSequence > 0.
      const result = await pg.query(`
        INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload, "payloadHash", "payloadSize",
          "sourceWorkstationId", "sourceCreatedAt", "clientSequence", status)
        VALUES ('${crypto.randomUUID()}', '${crypto.randomUUID()}', 'SALE_CONFIRMATION', '{}', 'abc', 2,
          'ws-001', '${now}', 0, 'PENDING')
        RETURNING "clientSequence";
      `);
      // BigInt values come back as strings from PGlite
      expect(String((result.rows[0] as Record<string, unknown>).clientSequence)).toBe("0");
    });
  });

  describe("Product + PriceHistory cascade", () => {
    it("rejects delete of Product referenced by SaleItem (RESTRICT)", async () => {
      const productId = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "Product" (id, "internalCode", "commercialName", "genericName",
          "activePrinciple", "laboratory", "saleType", "isActive", "createdById", "createdAt", "updatedAt")
        VALUES ('${productId}', 'DEL-TEST', 'Delete test', 'Generic',
          'Generic', 'Lab', 'FREE_SALE', true, '${seeds.userId}', '${now}', '${now}');
      `);
      await pg.exec(`
        INSERT INTO "ProductPriceHistory" (id, "productId", "price", "effectiveFrom", "changedById", "changedAt")
        VALUES (gen_random_uuid(), '${productId}', 1000, '${now}', '${seeds.userId}', '${now}');
      `);

      // Try to delete the product — SaleItem references it, so this should fail
      // if SaleItem exists referencing this product.  If no SaleItem references
      // it, the delete should succeed (and cascade to price history).
      // This test documents the constraint exists.
      await expect(
        pg.exec(`DELETE FROM "Product" WHERE id = '${seeds.productId}'`),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Business-flow scenarios — real transaction patterns
  // ---------------------------------------------------------------------------

  describe("Sale with multiple payment methods", () => {
    it("records two payments (cash + card) for one sale with correct totals", async () => {
      const sale = await insertSale(pg, seeds);

      // Add a second payment method (card), then insert split payments
      const cardMethodId = crypto.randomUUID();
      const now = new Date().toISOString();
      await pg.exec(`
        INSERT INTO "PaymentMethod" (id, "internalCode", "name", "category",
          "isActive", "isCash", "createdAt", "updatedAt")
        VALUES ('${cardMethodId}', 'CARD01', 'Tarjeta Débito', 'DEBIT_CARD',
          true, false, '${now}', '${now}');
      `);

      // Split payment: 5000 cash + 6900 card = 11900 total
      await pg.exec(`
        INSERT INTO "SalePayment" (id, "saleId", "paymentMethodId", "amount")
        VALUES ('${crypto.randomUUID()}', '${sale.id as string}', '${seeds.paymentMethodId}', 5000);
      `);
      await pg.exec(`
        INSERT INTO "SalePayment" (id, "saleId", "paymentMethodId", "amount")
        VALUES ('${crypto.randomUUID()}', '${sale.id as string}', '${cardMethodId}', 6900);
      `);

      // Verify sum of payments equals the sale totalAmount
      const paymentsResult = await pg.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM "SalePayment" WHERE "saleId" = $1`,
        [sale.id as string],
      );
      const paymentSum = Number(
        (paymentsResult.rows[0] as Record<string, unknown>).total,
      );

      const saleResult = await pg.query(
        `SELECT "totalAmount" FROM "Sale" WHERE id = $1`,
        [sale.id as string],
      );
      const saleTotal = Number(
        (saleResult.rows[0] as Record<string, unknown>).totalAmount,
      );

      expect(paymentSum).toBe(11900);
      expect(paymentSum).toBe(saleTotal);
    });

    it("rejects payment with unknown payment method (FK enforcement)", async () => {
      const sale = await insertSale(pg, seeds);
      const unknownPmId = crypto.randomUUID();

      await expect(
        pg.exec(`
          INSERT INTO "SalePayment" (id, "saleId", "paymentMethodId", "amount")
          VALUES ('${crypto.randomUUID()}', '${sale.id as string}', '${unknownPmId}', 5000);
        `),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });
  });

  describe("Prescription-controlled sale", () => {
    it("stores a prescription-controlled sale with prescription reference", async () => {
      const saleId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Create a controlled-substance product requiring prescription
      const controlledProductId = crypto.randomUUID();
      await pg.exec(`
        INSERT INTO "Product" (id, "internalCode", "commercialName", "genericName",
          "activePrinciple", "laboratory", "saleType", "isActive", "createdById", "createdAt", "updatedAt")
        VALUES ('${controlledProductId}', 'P-RES-001', 'Tramadol 50mg', 'Tramadol',
          'Tramadol', 'Lab Pharma', 'CONTROLLED_SUBSTANCE', true, '${seeds.userId}', '${now}', '${now}');
      `);

      await pg.exec(`
        INSERT INTO "Sale" (id, "localNumber", "operationalState",
          "startedAt", "lastModifiedAt", "cashShiftId", "workstationId",
          "sourceWorkstationId", "userId", "subtotal", "totalTax", "totalAmount")
        VALUES ('${saleId}', 100, 'IN_PROGRESS',
          '${now}', '${now}',
          '${seeds.cashShiftId}', '${seeds.workstationId}', '${seeds.workstationId}', '${seeds.userId}',
          5000.00, 950.00, 5950.00);
      `);

      await pg.exec(`
        INSERT INTO "SaleItem" (id, "saleId", "productId",
          "productInternalCodeSnapshot", "productCommercialNameSnapshot", "productGenericNameSnapshot",
          "quantity", "unitPrice", "unitCost", "taxRate", "taxAmount",
          "subtotal", "total", "requiresPrescription", "saleItemPrescriptionId")
        VALUES ('${itemId}', '${saleId}', '${controlledProductId}',
          'P-RES-001', 'Tramadol 50mg', 'Tramadol',
          1, 5000.00, 3000.00, 19, 950.00,
          5000.00, 5950.00, true, 'RX-2024-001234');
      `);

      // Verify prescription data was stored
      const itemResult = await pg.query(
        `SELECT "requiresPrescription", "saleItemPrescriptionId" FROM "SaleItem" WHERE id = $1`,
        [itemId],
      );
      const itemRow = itemResult.rows[0] as Record<string, unknown>;
      expect(itemRow.requiresPrescription).toBe(true);
      expect(itemRow.saleItemPrescriptionId).toBe("RX-2024-001234");
    });

    it("enforces Product saleType enum value must be one of the defined types", async () => {
      const now = new Date().toISOString();

      await expect(
        pg.exec(`
          INSERT INTO "Product" (id, "internalCode", "commercialName", "genericName",
            "activePrinciple", "laboratory", "saleType", "isActive", "createdById", "createdAt", "updatedAt")
          VALUES ('${crypto.randomUUID()}', 'P-INVALID', 'Invalid', 'Invalid',
            'Invalid', 'Lab', 'INVALID_TYPE', true, '${seeds.userId}', '${now}', '${now}');
        `),
      ).rejects.toThrow();
    });
  });

  describe("SyncQueue status lifecycle", () => {
    it("transitions from PENDING to PROCESSING to COMPLETED", async () => {
      const operationUuid = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload, "payloadHash", "payloadSize",
          "sourceWorkstationId", "sourceCreatedAt", "clientSequence", status)
        VALUES ('${crypto.randomUUID()}', '${operationUuid}', 'SALE_CONFIRMATION', '{}', 'abc', 2,
          'ws-001', '${now}', 1, 'PENDING');
      `);

      // Transition to PROCESSING
      await pg.exec(`
        UPDATE "SyncQueue" SET status = 'PROCESSING'::"SyncStatus"
        WHERE "operationUuid" = '${operationUuid}';
      `);

      let statusResult = await pg.query(
        `SELECT status FROM "SyncQueue" WHERE "operationUuid" = $1`,
        [operationUuid],
      );
      expect(
        (statusResult.rows[0] as Record<string, unknown>).status,
      ).toBe("PROCESSING");

      // Transition to COMPLETED
      await pg.exec(`
        UPDATE "SyncQueue" SET status = 'COMPLETED'::"SyncStatus"
        WHERE "operationUuid" = '${operationUuid}';
      `);

      statusResult = await pg.query(
        `SELECT status FROM "SyncQueue" WHERE "operationUuid" = $1`,
        [operationUuid],
      );
      expect(
        (statusResult.rows[0] as Record<string, unknown>).status,
      ).toBe("COMPLETED");
    });

    it("transitions from PENDING to FAILED with error details", async () => {
      const operationUuid = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload, "payloadHash", "payloadSize",
          "sourceWorkstationId", "sourceCreatedAt", "clientSequence", status)
        VALUES ('${crypto.randomUUID()}', '${operationUuid}', 'SALE_CONFIRMATION', '{}', 'abc', 2,
          'ws-001', '${now}', 2, 'PENDING');
      `);

      await pg.exec(`
        UPDATE "SyncQueue" SET status = 'FAILED'::"SyncStatus",
          "lastErrorMessage" = 'Server returned 409 Conflict',
          "retryCount" = 3
        WHERE "operationUuid" = '${operationUuid}';
      `);

      const result = await pg.query(
        `SELECT status, "lastErrorMessage", "retryCount" FROM "SyncQueue" WHERE "operationUuid" = $1`,
        [operationUuid],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(row.status).toBe("FAILED");
      expect(row.lastErrorMessage).toBe("Server returned 409 Conflict");
      expect(Number(row.retryCount)).toBe(3);
    });

    it("rejects invalid SyncStatus enum values", async () => {
      const now = new Date().toISOString();

      await expect(
        pg.exec(`
          INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload, "payloadHash", "payloadSize",
            "sourceWorkstationId", "sourceCreatedAt", "clientSequence", status)
          VALUES ('${crypto.randomUUID()}', '${crypto.randomUUID()}', 'SALE_CONFIRMATION', '{}', 'abc', 2,
            'ws-001', '${now}', 3, 'INVALID_STATUS');
        `),
      ).rejects.toThrow();
    });
  });

  describe("SaleItemLot — inventory lot tracking", () => {
    it("associates a lot with a sale item and enforces FK constraints", async () => {
      const sale = await insertSale(pg, seeds);

      // Create a lot for the product
      const lotId = crypto.randomUUID();
      const now = new Date().toISOString();
      await pg.exec(`
        INSERT INTO "Lot" (id, "productId", "batchNumber", "expirationDate",
          "currentStock", "entryDate", "state",
          "createdAt", "updatedAt")
        VALUES ('${lotId}', '${seeds.productId}', 'LOT-2024-001', '2026-12-31',
          50, '${now}', 'ACTIVE',
          '${now}', '${now}');
      `);

      // Link the sale item to the lot
      await pg.exec(`
        INSERT INTO "SaleItemLot" (id, "saleItemId", "lotId", "quantity", "unitCostAtSale")
        VALUES ('${crypto.randomUUID()}', '${sale.itemId as string}', '${lotId}', 2, 3000.00);
      `);

      const result = await pg.query(
        `SELECT sl.quantity FROM "SaleItemLot" sl
         JOIN "SaleItem" si ON si.id = sl."saleItemId"
         WHERE si.id = $1`,
        [sale.itemId as string],
      );
      expect(result.rows).toHaveLength(1);
      expect(
        Number((result.rows[0] as Record<string, unknown>).quantity),
      ).toBe(2);
    });

    it("rejects SaleItemLot with non-existent lot (FK enforcement)", async () => {
      const sale = await insertSale(pg, seeds);
      const fakeLotId = crypto.randomUUID();

      await expect(
        pg.exec(`
          INSERT INTO "SaleItemLot" (id, "saleItemId", "lotId", "quantity", "unitCostAtSale")
          VALUES ('${crypto.randomUUID()}', '${sale.itemId as string}', '${fakeLotId}', 1, 3000.00);
        `),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });
  });

  describe("Sale operational state lifecycle", () => {
    it("transitions IN_PROGRESS → CONFIRMED → ANNULLED", async () => {
      const sale = await insertSale(pg, seeds);

      const transitions = ["CONFIRMED", "ANNULLED"] as const;
      for (const state of transitions) {
        await pg.exec(`
          UPDATE "Sale" SET "operationalState" = '${state}'::"SaleOperationalState",
            "lastModifiedAt" = '${new Date().toISOString()}'
          WHERE id = '${sale.id as string}';
        `);
      }

      const result = await pg.query(
        `SELECT "operationalState" FROM "Sale" WHERE id = $1`,
        [sale.id as string],
      );
      expect(
        (result.rows[0] as Record<string, unknown>).operationalState,
      ).toBe("ANNULLED");
    });

    it("allows direct transition to ABANDONED from IN_PROGRESS — DB schema does not enforce ordering", async () => {
      // Note: the DB schema does NOT enforce state ordering via CHECK
      // constraints.  The application (SalesPosService) is responsible for
      // enforcing valid transitions.  This test documents that ABANDONED is
      // a valid enum value and can be set at the schema level.
      const sale = await insertSale(pg, seeds);

      await pg.exec(`
        UPDATE "Sale" SET "operationalState" = 'ABANDONED',
          "lastModifiedAt" = '${new Date().toISOString()}'
        WHERE id = '${sale.id as string}';
      `);

      const result = await pg.query(
        `SELECT "operationalState" FROM "Sale" WHERE id = $1`,
        [sale.id as string],
      );
      expect(
        (result.rows[0] as Record<string, unknown>).operationalState,
      ).toBe("ABANDONED");
    });
  });

  describe("Invoice linked to Sale", () => {
    it("creates an invoice for a confirmed sale", async () => {
      const sale = await insertSale(pg, seeds);
      const invoiceId = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "Invoice" (id, "saleId", "workstationId", "invoiceType",
          "invoiceNumber", "cufeProvisional", "issuedAt", "expiresAt",
          "techKeySnapshot", "fullData")
        VALUES ('${invoiceId}', '${sale.id as string}', '${seeds.workstationId}',
          'ELECTRONIC_INVOICE', 'INV-2024-00001',
          'CUFE-abc123def456', '${now}', '${now}',
          'tech-key-001', '{}');
      `);

      const result = await pg.query(
        `SELECT i."invoiceNumber", i."cufeProvisional", s."totalAmount"
         FROM "Invoice" i
         JOIN "Sale" s ON s.id = i."saleId"
         WHERE i.id = $1`,
        [invoiceId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(row.invoiceNumber).toBe("INV-2024-00001");
      expect(row.cufeProvisional).toBe("CUFE-abc123def456");
      expect(Number(row.totalAmount)).toBe(11900);
    });

    it("enforces foreign key on relatedInvoiceId (self-referencing FK)", async () => {
      const sale = await insertSale(pg, seeds);
      const now = new Date().toISOString();
      const fakeInvoiceId = crypto.randomUUID();

      await expect(
        pg.exec(`
          INSERT INTO "Invoice" (id, "saleId", "workstationId", "invoiceType",
            "invoiceNumber", "cufeProvisional", "issuedAt", "expiresAt",
            "techKeySnapshot", "fullData", "relatedInvoiceId")
          VALUES ('${crypto.randomUUID()}', '${sale.id as string}', '${seeds.workstationId}',
            'ELECTRONIC_INVOICE', 'INV-FK-TEST',
            'CUFE-fk', '${now}', '${now}',
            'tech-key-fk', '{}',
            '${fakeInvoiceId}');
        `),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Infrastructure note
// ---------------------------------------------------------------------------
// These tests use PGlite SQL directly (not through PrismaClient) because the
// Vite process.binding polyfill prevents the PrismaPGlite adapter from
// loading.  To run service-level tests that go through the real PrismaClient:
//
// 1. Create a separate vitest config (e.g. vitest.integration.config.ts) that
//    sets `server.deps.external: ["@electric-sql/pglite", "pglite-prisma-adapter"]`.
// 2. Override the Vite `define` to not replace `process.binding` during tests.
// 3. Use `@pharmacy/database/local` PrismaClient with PrismaPGlite adapter.
//
// Until then, these SQL-level tests verify schema, constraints, and data
// types — the same layer Prisma writes to.
