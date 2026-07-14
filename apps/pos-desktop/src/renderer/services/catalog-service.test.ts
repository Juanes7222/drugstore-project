/**
 * Tests for catalog-service pure utility functions.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SaleType } from "@pharmacy/shared-types";
import {
  isCatalogItemRestricted,
  isNearExpiry,
  isLowStock,
  type CatalogItem,
} from "./catalog-service";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const createItem = (overrides: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "p-001",
  name: "Generic Product",
  genericName: "Generic",
  barcode: "7701234567890",
  invimaCertificate: null,
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  unitPriceCents: 5000,
  taxPercentage: 19,
  currentStock: 100,
  minimumStock: 10,
  isActive: true,
  lotCode: "LOT-001",
  lotExpirationDate: "2027-12-31",
  hasCompleteData: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// isCatalogItemRestricted
// ---------------------------------------------------------------------------

describe("isCatalogItemRestricted", () => {
  it("returns false for FREE_SALE without prescription", () => {
    const item = createItem({ saleType: SaleType.FREE_SALE, requiresPrescription: false });

    expect(isCatalogItemRestricted(item)).toBe(false);
  });

  it("returns true for CONTROLLED_SUBSTANCE", () => {
    const item = createItem({ saleType: SaleType.CONTROLLED_SUBSTANCE });

    expect(isCatalogItemRestricted(item)).toBe(true);
  });

  it("returns true when requiresPrescription is true", () => {
    const item = createItem({ saleType: SaleType.FREE_SALE, requiresPrescription: true });

    expect(isCatalogItemRestricted(item)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isNearExpiry
// ---------------------------------------------------------------------------

describe("isNearExpiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for a date within 30 days", () => {
    // 15 days from reference — well within the 30-day window.
    const expiry = "2026-07-28";

    expect(isNearExpiry(expiry)).toBe(true);
  });

  it("returns false for a date more than 30 days away", () => {
    // 60 days from reference — outside the window.
    const expiry = "2026-09-11";

    expect(isNearExpiry(expiry)).toBe(false);
  });

  it("returns false for an already-expired date", () => {
    const expiry = "2026-06-01";

    expect(isNearExpiry(expiry)).toBe(false);
  });

  it("returns true for the exact boundary (30 days)", () => {
    // 30 days from July 13 is August 12.
    const expiry = "2026-08-12";

    expect(isNearExpiry(expiry)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isLowStock
// ---------------------------------------------------------------------------

describe("isLowStock", () => {
  it("returns true when currentStock equals minimumStock", () => {
    const item = createItem({ currentStock: 5, minimumStock: 5 });

    expect(isLowStock(item)).toBe(true);
  });

  it("returns true when currentStock is below minimumStock", () => {
    const item = createItem({ currentStock: 2, minimumStock: 10 });

    expect(isLowStock(item)).toBe(true);
  });

  it("returns false when currentStock exceeds minimumStock", () => {
    const item = createItem({ currentStock: 20, minimumStock: 10 });

    expect(isLowStock(item)).toBe(false);
  });
});
