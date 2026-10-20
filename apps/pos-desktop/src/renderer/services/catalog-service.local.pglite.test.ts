/**
 * Integration test for the local catalogue search against a real PGlite
 * instance with the real local schema.
 *
 * Covers the two properties the sales-counter search depends on:
 *
 * 1. **Exact barcode wins.** `ProductBarcode.barcode` carries a UNIQUE
 *    index, so the scanner path resolves the scanned product through an
 *    index lookup.  It also guarantees the scanned product is the one
 *    returned, even when 20+ other products contain the code as a
 *    substring and would otherwise push it out of the result window.
 *
 * 2. **The `pg_trgm` indexes exist.** Without them the `ILIKE '%term%'`
 *    search falls back to a sequential scan of `Product` /
 *    `ProductBarcode` — the reason the POS search felt slow.
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@pharmacy/database/local";
import { LOCAL_SCHEMA_SQL } from "@pharmacy/database/local-schema";
import { SaleType } from "@pharmacy/shared-types";
import { ensureProductSearchIndexes } from "../../infrastructure/local-database";
import { createLocalCatalogService } from "./catalog-service.local";

const USER_ID = "user-search-test";
const TAX_SCHEME_ID = "tax-search-test";

let pg: PGlite;
let prisma: PrismaClient;

/** Barcode of the product the scanner must always resolve to. */
const SCANNED_BARCODE = "7701234567890";
const SCANNED_PRODUCT_ID = "prod-scanned";

const seedProduct = async (
  id: string,
  commercialName: string,
  internalCode: string,
  barcode: string,
  isActive = true,
) => {
  const now = new Date();
  await prisma.product.create({
    data: {
      id,
      internalCode,
      commercialName,
      concentration: null,
      concentrationUnit: null,
      laboratory: "Genérico",
      saleType: SaleType.FREE_SALE,
      minimumStock: 0,
      isActive,
      invimaRegistry: null,
      atcCode: null,
      therapeuticIndication: null,
      storageConditions: null,
      internalNotes: null,
      commissionType: "NONE",
      commissionValue: 0,
      commissionStartsAt: null,
      commissionEndsAt: null,
      createdById: USER_ID,
      createdAt: now,
      updatedAt: now,
      barcodes: {
        create: {
          id: `bc-${id}`,
          barcode,
          barcodeType: "EAN13",
          isPrimary: true,
        },
      },
    },
  });
};

beforeAll(async () => {
  pg = new PGlite("memory://", { extensions: { pg_trgm } });
  await pg.exec(LOCAL_SCHEMA_SQL);

  const adapter = new PrismaPGlite(pg);
  prisma = new PrismaClient({ adapter });

  const now = new Date();
  await prisma.user.create({
    data: {
      id: USER_ID,
      username: "search-tester",
      displayName: "Search Tester",
      role: "ADMIN",
      passwordHash: "x",
      updatedAt: now,
    },
  });
  await prisma.taxScheme.create({
    data: {
      id: TAX_SCHEME_ID,
      code: "IVA",
      name: "IVA 19%",
      taxType: "IVA",
      rate: 19,
      effectiveFrom: now,
      isActive: true,
      createdById: USER_ID,
      createdAt: now,
      updatedAt: now,
    },
  });

  await seedProduct(
    SCANNED_PRODUCT_ID,
    "Acetaminofén 500mg",
    "INT-0001",
    SCANNED_BARCODE,
  );

  // 25 products whose barcode CONTAINS the scanned code. Under the old
  // substring search these filled the 20-row result window and the
  // scanned product could fall outside it.
  for (let i = 0; i < 25; i++) {
    await seedProduct(
      `prod-noise-${i}`,
      `Producto ruido ${i}`,
      `INT-1${String(i).padStart(3, "0")}`,
      `9${SCANNED_BARCODE}${String(i).padStart(2, "0")}`,
    );
  }

  await seedProduct(
    "prod-inactive",
    "Ibuprofeno 400mg",
    "INT-0002",
    "7709999999999",
    false,
  );

  await seedProduct(
    "prod-partial",
    "Loratadina 10mg",
    "INT-0003",
    "7705550001112",
  );

  await ensureProductSearchIndexes(pg);
});

afterAll(async () => {
  await prisma?.$disconnect();
  await pg?.close();
});

const service = () =>
  createLocalCatalogService({ prismaResolver: async () => prisma as never });

describe("local catalogue search — exact barcode", () => {
  it("resolves the scanned product even when other barcodes contain the code", async () => {
    const results = await service().search(SCANNED_BARCODE);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(SCANNED_PRODUCT_ID);
    expect(results[0].barcode).toBe(SCANNED_BARCODE);
  });

  it("still finds a product by a partial barcode", async () => {
    const results = await service().search("770555000");

    expect(results.map((r) => r.id)).toContain("prod-partial");
  });

  it("does not return an inactive product for its exact barcode", async () => {
    const results = await service().search("7709999999999");

    expect(results.map((r) => r.id)).not.toContain("prod-inactive");
  });
});

describe("local catalogue search — name and internal code", () => {
  it("finds a product by a case-insensitive name fragment", async () => {
    const results = await service().search("acetamino");

    expect(results.map((r) => r.id)).toContain(SCANNED_PRODUCT_ID);
  });

  it("finds a product by internal code", async () => {
    const results = await service().search("INT-0001");

    expect(results.map((r) => r.id)).toContain(SCANNED_PRODUCT_ID);
  });

  it("returns nothing for a term that matches no product", async () => {
    expect(await service().search("zzqqxx")).toEqual([]);
  });
});

describe("product search indexes", () => {
  it("creates the GIN trigram indexes the search relies on", async () => {
    const result = await pg.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexname LIKE '%_trgm_idx'`,
    );
    const names = result.rows.map((r) => r.indexname);

    expect(names).toContain("Product_commercialName_trgm_idx");
    expect(names).toContain("Product_internalCode_trgm_idx");
    expect(names).toContain("ProductBarcode_barcode_trgm_idx");
  });
});
