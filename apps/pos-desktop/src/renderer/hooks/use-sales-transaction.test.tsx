/**
 * Unit tests for useSalesTransaction hook.
 *
 * Covers: initial state, handleSelect (complete/unrestricted, restricted,
 * incomplete), handleConfirmRestricted, handleCancelRestricted, and
 * handleCheckout.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSalesTransaction } from "./use-sales-transaction";
import { addItem } from "@/store/slices/sales-slice";
import { initializePayment } from "@/store/slices/payment-slice";
import { setActiveScreen } from "@/store/slices/ui-slice";
import { SaleType } from "@pharmacy/shared-types";
import type { CatalogItem } from "@/services/catalog-service";

// ---------------------------------------------------------------------------
// Hoisted mocks for Redux hooks and infrastructure
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
let mockTotalCents = 0;

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: () => mockTotalCents,
}));

const mockCatalogService = { search: vi.fn() };

vi.mock("@infra/catalog-service-factory", () => ({
  createCatalogService: () => mockCatalogService,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const unrestrictedItem: CatalogItem = {
  id: "p-001",
  name: "Acetaminofén 500mg",
  genericName: "Paracetamol",
  barcode: "7701234567890",
  invimaCertificate: null,
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  unitPriceCents: 6_200,
  taxPercentage: 19,
  currentStock: 45,
  minimumStock: 10,
  isActive: true,
  lotCode: "L24056",
  lotExpirationDate: "2026-08-30",
  hasCompleteData: true,
};

const restrictedItem: CatalogItem = {
  id: "p-005",
  name: "Clonazepam 2mg",
  genericName: "Clonazepam",
  barcode: "7705678901234",
  invimaCertificate: "RS-2024-001",
  saleType: SaleType.CONTROLLED_SUBSTANCE,
  requiresPrescription: true,
  isRestricted: true,
  unitPriceCents: 18_900,
  taxPercentage: 19,
  currentStock: 34,
  minimumStock: 5,
  isActive: true,
  lotCode: "CZ-2401",
  lotExpirationDate: "2027-01-10",
  hasCompleteData: true,
};

const incompleteItem: CatalogItem = {
  ...unrestrictedItem,
  id: "p-incomplete",
  unitPriceCents: null,
  hasCompleteData: false,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useSalesTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTotalCents = 0;
  });

  describe("initial state", () => {
    it("returns catalogService, null pendingItem, and false isDialogOpen", () => {
      const { result } = renderHook(() => useSalesTransaction());

      expect(result.current.catalogService).toBe(mockCatalogService);
      expect(result.current.pendingItem).toBeNull();
      expect(result.current.isDialogOpen).toBe(false);
    });
  });

  describe("handleSelect", () => {
    it("dispatches addItem for a complete, unrestricted item", () => {
      const { result } = renderHook(() => useSalesTransaction());

      act(() => {
        result.current.handleSelect(unrestrictedItem);
      });

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(
        addItem({
          id: `${unrestrictedItem.id}::${unrestrictedItem.lotCode}`,
          productId: unrestrictedItem.id,
          name: unrestrictedItem.name,
          genericName: unrestrictedItem.genericName,
          invimaCertificate: "",
          saleType: unrestrictedItem.saleType,
          requiresPrescription: unrestrictedItem.requiresPrescription,
          isRestricted: false,
          lotCode: unrestrictedItem.lotCode,
          lotExpirationDate: unrestrictedItem.lotExpirationDate,
          unitPriceCents: unrestrictedItem.unitPriceCents,
          taxPercentage: unrestrictedItem.taxPercentage,
          quantity: 1,
        }),
      );
      expect(result.current.pendingItem).toBeNull();
      expect(result.current.isDialogOpen).toBe(false);
    });

    it("sets pendingItem and opens dialog for a restricted item without dispatching", () => {
      const { result } = renderHook(() => useSalesTransaction());

      act(() => {
        result.current.handleSelect(restrictedItem);
      });

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(result.current.pendingItem).toEqual(restrictedItem);
      expect(result.current.isDialogOpen).toBe(true);
    });

    it("does nothing when item has incomplete data", () => {
      const { result } = renderHook(() => useSalesTransaction());

      act(() => {
        result.current.handleSelect(incompleteItem);
      });

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(result.current.pendingItem).toBeNull();
      expect(result.current.isDialogOpen).toBe(false);
    });
  });

  describe("handleConfirmRestricted", () => {
    it("dispatches addItem with the pending item and clears state", () => {
      const { result } = renderHook(() => useSalesTransaction());

      // Prime the pending item via handleSelect
      act(() => {
        result.current.handleSelect(restrictedItem);
      });
      expect(result.current.pendingItem).toEqual(restrictedItem);

      act(() => {
        result.current.handleConfirmRestricted();
      });

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(
        addItem({
          id: `${restrictedItem.id}::${restrictedItem.lotCode}`,
          productId: restrictedItem.id,
          name: restrictedItem.name,
          genericName: restrictedItem.genericName,
          invimaCertificate: restrictedItem.invimaCertificate ?? "",
          saleType: restrictedItem.saleType,
          requiresPrescription: restrictedItem.requiresPrescription,
          isRestricted: true,
          lotCode: restrictedItem.lotCode,
          lotExpirationDate: restrictedItem.lotExpirationDate,
          unitPriceCents: restrictedItem.unitPriceCents,
          taxPercentage: restrictedItem.taxPercentage,
          quantity: 1,
        }),
      );
      expect(result.current.pendingItem).toBeNull();
      expect(result.current.isDialogOpen).toBe(false);
    });

    it("does nothing when pendingItem is null", () => {
      const { result } = renderHook(() => useSalesTransaction());

      act(() => {
        result.current.handleConfirmRestricted();
      });

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(result.current.pendingItem).toBeNull();
      expect(result.current.isDialogOpen).toBe(false);
    });
  });

  describe("handleCancelRestricted", () => {
    it("clears pendingItem and closes dialog without dispatching", () => {
      const { result } = renderHook(() => useSalesTransaction());

      // Prime state via handleSelect
      act(() => {
        result.current.handleSelect(restrictedItem);
      });
      expect(result.current.isDialogOpen).toBe(true);

      act(() => {
        result.current.handleCancelRestricted();
      });

      expect(result.current.pendingItem).toBeNull();
      expect(result.current.isDialogOpen).toBe(false);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe("handleCheckout", () => {
    it("dispatches initializePayment with totalDue then navigates to payment screen", () => {
      mockTotalCents = 50_000;
      const { result } = renderHook(() => useSalesTransaction());

      act(() => {
        result.current.handleCheckout();
      });

      expect(mockDispatch).toHaveBeenCalledWith(
        initializePayment({ totalCents: 50_000 }),
      );
      expect(mockDispatch).toHaveBeenCalledWith(setActiveScreen("payment"));
    });
  });
});
