/**
 * Regression tests for `applyMissingSchema` upgrade ordering on existing
 * installs.
 *
 * The bug: column backfill (Phase 1) ran `ALTER TABLE "Product" ADD COLUMN
 * "commissionType" "CommissionType" ...` BEFORE missing enum types were
 * created (Phase 2). PostgreSQL requires the enum type to exist when the
 * column is added, so any upgraded install that gained a brand-new Prisma
 * enum failed with `type "CommissionType" does not exist`.  The fix added
 * Phase 0: missing `CREATE TYPE ... AS ENUM` statements run before column
 * backfill, and created enum names are added to the `existingEnums` set so
 * Phase 2 skips them.
 *
 * These tests simulate an old install (a PGlite database whose Product table
 * exists but has no `commissionType` column and no `CommissionType` enum)
 * and drive the real upgrade path.  `applyMissingSchema` is not reachable
 * through `getLocalDatabase()` under Vitest because that path requires a
 * browser/Tauri environment (fetch of `/pglite/` WASM assets), so the
 * function is exported and exercised directly against an in-memory PGlite.
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyMissingSchema } from "./local-database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Product table as it existed before the commission fields landed: no
 * `commissionType` column, no `CommissionType` enum anywhere in the
 * database.  Uses TEXT for `saleType` because the enum type did not exist
 * on the old install.
 */
async function createOldInstall(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE "Product" (
      "id" TEXT NOT NULL,
      "internalCode" TEXT NOT NULL,
      "commercialName" TEXT NOT NULL,
      "laboratory" TEXT NOT NULL,
      "saleType" TEXT NOT NULL,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      "createdById" TEXT NOT NULL,
      CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
    );
  `);
}

async function commissionTypeEnumExists(pg: PGlite): Promise<boolean> {
  const result = await pg.query<{ typname: string }>(
    `SELECT typname FROM pg_type WHERE typtype = 'e' AND typname = 'CommissionType'`,
  );
  return result.rows.length > 0;
}

async function productCommissionTypeColumnExists(pg: PGlite): Promise<boolean> {
  const result = await pg.query<{ columnName: string }>(
    `SELECT column_name AS "columnName"
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Product'
        AND column_name = 'commissionType'`,
  );
  return result.rows.length > 0;
}

async function insertProductWithoutCommission(
  pg: PGlite,
  id: string,
): Promise<void> {
  const now = new Date().toISOString();
  await pg.exec(`
    INSERT INTO "Product" (id, "internalCode", "commercialName", "laboratory",
      "saleType", "isActive", "createdById", "createdAt", "updatedAt")
    VALUES ('${id}', 'P001', 'Acetaminofén 500mg', 'Laboratorio Genérico',
      'FREE_SALE', true, 'user-cashier-01', '${now}', '${now}');
  `);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("applyMissingSchema", () => {
  let pg: PGlite;

  beforeEach(async () => {
    pg = new PGlite("memory://");
    await createOldInstall(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  it("creates missing enum types before backfilling columns on an old install", async () => {
    // Sanity check that the fixture really is an "old install".
    expect(await commissionTypeEnumExists(pg)).toBe(false);
    expect(await productCommissionTypeColumnExists(pg)).toBe(false);

    await expect(applyMissingSchema(pg)).resolves.toBeUndefined();

    const enumValues = await pg.query<{ value: string }>(
      `SELECT e.enumlabel AS value
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'CommissionType'
        ORDER BY e.enumsortorder`,
    );
    expect(enumValues.rows.map((r) => r.value)).toEqual([
      "NONE",
      "PERCENTAGE",
      "FIXED",
    ]);
  });

  it("backfills Product.commissionType with default NONE", async () => {
    await applyMissingSchema(pg);

    const column = await pg.query<{ columnDefault: string | null }>(
      `SELECT column_default AS "columnDefault"
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Product'
          AND column_name = 'commissionType'`,
    );
    expect(column.rows).toHaveLength(1);
    expect(column.rows[0]?.columnDefault).toContain("NONE");

    // Insert without specifying the column — the default must apply.
    const productId = crypto.randomUUID();
    await insertProductWithoutCommission(pg, productId);

    const inserted = await pg.query<{ commissionType: string }>(
      `SELECT "commissionType" FROM "Product" WHERE id = $1`,
      [productId],
    );
    expect(inserted.rows[0]?.commissionType).toBe("NONE");

    // The enum type is usable for explicit values too.
    await pg.query(
      `UPDATE "Product" SET "commissionType" = 'PERCENTAGE' WHERE id = $1`,
      [productId],
    );
    const updated = await pg.query<{ commissionType: string }>(
      `SELECT "commissionType" FROM "Product" WHERE id = $1`,
      [productId],
    );
    expect(updated.rows[0]?.commissionType).toBe("PERCENTAGE");
  });

  it("is idempotent — a second upgrade does not re-execute the enum DDL", async () => {
    await applyMissingSchema(pg);
    await applyMissingSchema(pg);

    // CREATE TYPE has no IF NOT EXISTS, so a re-executed enum statement
    // would have thrown "already exists" on the second run.  The single
    // remaining pg_type row proves Phase 2 skipped it.
    const result = await pg.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM pg_type
        WHERE typtype = 'e' AND typname = 'CommissionType'`,
    );
    expect(result.rows[0]?.count).toBe(1);

    // The backfilled column and its default survive a second upgrade.
    expect(await productCommissionTypeColumnExists(pg)).toBe(true);
    const productId = crypto.randomUUID();
    await insertProductWithoutCommission(pg, productId);
    const inserted = await pg.query<{ commissionType: string }>(
      `SELECT "commissionType" FROM "Product" WHERE id = $1`,
      [productId],
    );
    expect(inserted.rows[0]?.commissionType).toBe("NONE");
  });
});
