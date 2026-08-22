/**
 * Unit tests for useQuickButtons.
 *
 * The hook reads the pinned-product list from the module-scoped Zustand
 * user-preferences store, so tests drive it through `setState` against the
 * real store (same pattern as use-sales-keyboard.test.ts) and mock the
 * catalog service at the boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { SaleType } from "@pharmacy/shared-types";
import { useUserPreferencesStore } from "../../stores/user-preferences.store";
import {
  useQuickButtons,
  type UseQuickButtonsDeps,
} from "./use-quick-buttons";
import type { CatalogItem, CatalogService } from "@/services/catalog-service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const catalogItem = (overrides: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "p-001",
  name: "Acetaminofén 500mg",
  barcode: "7701234567890",
  invimaCertificate: null,
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  unitPriceCents: 6_200,
  costCents: null,
  taxPercentage: 19,
  currentStock: 45,
  minimumStock: 10,
  isActive: true,
  lotCode: "L24056",
  lotExpirationDate: "2026-08-30",
  hasCompleteData: true,
  commissionType: null,
  commissionValue: null,
  commissionStartsAt: null,
  commissionEndsAt: null,
  ...overrides,
});

const mockCatalogService: CatalogService = {
  search: vi.fn(),
  getById: vi.fn(),
};

const makeDeps = (
  overrides: Partial<UseQuickButtonsDeps> = {},
): UseQuickButtonsDeps => ({
  catalogService: mockCatalogService,
  onAddCatalogItem: vi.fn(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useQuickButtons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUserPreferencesStore.setState({ quickButtons: [] });
  });

  describe("pinned ids", () => {
    it("returns the pinned ids in insertion order", () => {
      useUserPreferencesStore.setState({ quickButtons: ["p-1", "p-2"] });

      const { result } = renderHook(() => useQuickButtons(makeDeps()));

      expect(result.current.quickProductIds).toEqual(["p-1", "p-2"]);
    });

    it("isPinned is true only for ids in the store", () => {
      useUserPreferencesStore.setState({ quickButtons: ["p-1"] });

      const { result } = renderHook(() => useQuickButtons(makeDeps()));

      expect(result.current.isPinned("p-1")).toBe(true);
      expect(result.current.isPinned("p-2")).toBe(false);
    });
  });

  describe("togglePin", () => {
    it("adds an unpinned product to the store", () => {
      useUserPreferencesStore.setState({ quickButtons: ["p-1"] });
      const { result } = renderHook(() => useQuickButtons(makeDeps()));

      act(() => result.current.togglePin("p-2"));

      expect(useUserPreferencesStore.getState().quickButtons).toEqual([
        "p-1",
        "p-2",
      ]);
      expect(result.current.quickProductIds).toEqual(["p-1", "p-2"]);
    });

    it("removes a pinned product from the store", () => {
      useUserPreferencesStore.setState({ quickButtons: ["p-1", "p-2"] });
      const { result } = renderHook(() => useQuickButtons(makeDeps()));

      act(() => result.current.togglePin("p-1"));

      expect(useUserPreferencesStore.getState().quickButtons).toEqual(["p-2"]);
      expect(result.current.quickProductIds).toEqual(["p-2"]);
    });
  });

  describe("addQuickProduct", () => {
    it("resolves a complete product and adds it with quantity 1", async () => {
      const item = catalogItem();
      vi.mocked(mockCatalogService.getById).mockResolvedValue(item);
      const deps = makeDeps();
      const { result } = renderHook(() => useQuickButtons(deps));

      const added = await act(async () =>
        result.current.addQuickProduct("p-001"),
      );

      expect(added).toBe(true);
      expect(mockCatalogService.getById).toHaveBeenCalledWith("p-001");
      expect(deps.onAddCatalogItem).toHaveBeenCalledWith(item, 1);
    });

    it("returns false without adding when the product is missing", async () => {
      vi.mocked(mockCatalogService.getById).mockResolvedValue(null);
      const deps = makeDeps();
      const { result } = renderHook(() => useQuickButtons(deps));

      const added = await act(async () =>
        result.current.addQuickProduct("p-gone"),
      );

      expect(added).toBe(false);
      expect(deps.onAddCatalogItem).not.toHaveBeenCalled();
    });

    it("returns false without adding when the product has incomplete data", async () => {
      vi.mocked(mockCatalogService.getById).mockResolvedValue(
        catalogItem({ hasCompleteData: false, unitPriceCents: null }),
      );
      const deps = makeDeps();
      const { result } = renderHook(() => useQuickButtons(deps));

      const added = await act(async () =>
        result.current.addQuickProduct("p-incomplete"),
      );

      expect(added).toBe(false);
      expect(deps.onAddCatalogItem).not.toHaveBeenCalled();
    });

    it("returns false without adding when the unit price is missing", async () => {
      vi.mocked(mockCatalogService.getById).mockResolvedValue(
        catalogItem({ hasCompleteData: true, unitPriceCents: null }),
      );
      const deps = makeDeps();
      const { result } = renderHook(() => useQuickButtons(deps));

      const added = await act(async () =>
        result.current.addQuickProduct("p-no-price"),
      );

      expect(added).toBe(false);
      expect(deps.onAddCatalogItem).not.toHaveBeenCalled();
    });
  });
});