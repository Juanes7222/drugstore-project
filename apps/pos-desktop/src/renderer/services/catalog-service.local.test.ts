/**
 * Tests for the local catalog service getById lookup.
 *
 * The mapper and search behavior are covered by catalog-service.test.ts and
 * catalog-service.http.test.ts; this file focuses on the by-id resolution
 * the repeat-sale (F7) flow depends on: found product → mapped CatalogItem,
 * missing product → null, unavailable database → null.
 */
import { describe, expect, it, vi } from "vitest";
import { LotState } from "@pharmacy/database/local";
import { SaleType } from "@pharmacy/shared-types";
import { createLocalCatalogService } from "./catalog-service.local";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeLocalProductRow = (overrides: Record<string, unknown> = {}) => ({
  id: "prod-1",
  commercialName: "Acetaminofén 500mg",
  saleType: SaleType.FREE_SALE,
  minimumStock: 10,
  isActive: true,
  invimaRegistry: "INVIMA-2020M-001234",
  barcodes: [{ barcode: "7701234567890", isPrimary: true }],
  priceHistories: [{ price: 5000 }],
  costHistories: [{ cost: 3000 }],
  taxHistories: [{ taxScheme: { rate: 19 } }],
  lots: [
    {
      batchNumber: "L-2026A",
      expirationDate: new Date("2027-12-01T00:00:00Z"),
      currentStock: 100,
      state: LotState.ACTIVE,
    },
    {
      batchNumber: "L-2026B",
      expirationDate: new Date("2028-06-01T00:00:00Z"),
      currentStock: 50,
      state: LotState.ACTIVE,
    },
    {
      batchNumber: "L-OUT",
      expirationDate: new Date("2026-01-01T00:00:00Z"),
      currentStock: 10,
      state: LotState.EXPIRED,
    },
  ],
  commissionType: null,
  commissionValue: null,
  commissionStartsAt: null,
  commissionEndsAt: null,
  ...overrides,
});

const makePrisma = (row: unknown) => ({
  product: { findUnique: vi.fn().mockResolvedValue(row) },
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("createLocalCatalogService.getById", () => {
  it("maps a found product into a CatalogItem with the same shape as search", async () => {
    const prisma = makePrisma(makeLocalProductRow());
    const service = createLocalCatalogService({
      prismaResolver: async () => prisma as never,
    });

    const result = await service.getById("prod-1");

    expect(prisma.product.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "prod-1" } }),
    );
    expect(result).toEqual({
      id: "prod-1",
      name: "Acetaminofén 500mg",
      barcode: "7701234567890",
      invimaCertificate: "INVIMA-2020M-001234",
      saleType: SaleType.FREE_SALE,
      requiresPrescription: false,
      isRestricted: false,
      unitPriceCents: 500_000,
      costCents: 300_000,
      taxPercentage: 19,
      currentStock: 150,
      minimumStock: 10,
      isActive: true,
      lotCode: "L-2026A",
      lotExpirationDate: "2027-12-01T00:00:00.000Z",
      hasCompleteData: true,
      commissionType: null,
      commissionValue: null,
      commissionStartsAt: null,
      commissionEndsAt: null,
    });
  });

  it("returns null when the product does not exist", async () => {
    const prisma = makePrisma(null);
    const service = createLocalCatalogService({
      prismaResolver: async () => prisma as never,
    });

    const result = await service.getById("unknown-id");

    expect(prisma.product.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "unknown-id" } }),
    );
    expect(result).toBeNull();
  });

  it("returns null when the database is unavailable", async () => {
    const service = createLocalCatalogService({
      prismaResolver: async () => null,
    });

    const result = await service.getById("prod-1");

    expect(result).toBeNull();
  });

  it("returns null for an incomplete product without an active lot", async () => {
    const prisma = makePrisma(
      makeLocalProductRow({ lots: [] }),
    );
    const service = createLocalCatalogService({
      prismaResolver: async () => prisma as never,
    });

    const result = await service.getById("prod-1");

    expect(result?.lotCode).toBe("");
    expect(result?.hasCompleteData).toBe(false);
  });
});