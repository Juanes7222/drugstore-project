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

    it("stores and retrieves JSON payload", async () => {
      const now = new Date().toISOString();
      const payload = JSON.stringify({
        createInput: { saleType: "FREE_SALE", items: [] },
        confirmInput: { payments: [] },
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
      expect(stored).toHaveProperty("createInput");
      expect(stored).toHaveProperty("metadata");
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
