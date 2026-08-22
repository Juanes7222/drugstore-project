/**
 * Unit tests for useSalesTransaction hook.
 *
 * Covers: initial state, handleSelect (complete/unrestricted, restricted,
 * incomplete), handleConfirmRestricted, handleCancelRestricted, and
 * handleCheckout.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createContext } from "react";
import { renderHook, act } from "@testing-library/react";
import { useSalesTransaction } from "./use-sales-transaction";
import { addItem, setClient } from "@/store/slices/sales-slice";
import { initializePayment } from "@/store/slices/payment-slice";
import { setActiveScreen } from "@/store/slices/ui-slice";
import { SaleType } from "@pharmacy/shared-types";
import type { CatalogItem } from "@/services/catalog-service";
import type {
  CartItem,
  SaleDeliveryDraft,
  SalesState,
} from "@/store/slices/sales-types";

// ---------------------------------------------------------------------------
// Hoisted mocks for Redux hooks and infrastructure
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
let mockSalesState: SalesState = {
  items: [],
  selectedClient: null,
  delivery: null,
  selectedLineId: null,
  undoStack: [],
  heldCarts: [],
};

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => mockDispatch,
  // Invoke the real selector against a mutable state so each selector
  // returns its own slice of state.
  useAppSelector: (selector: unknown) =>
    (selector as (state: { sales: SalesState }) => unknown)({
      sales: mockSalesState,
    }),
}));

const mockCatalogService = { search: vi.fn(), getById: vi.fn() };

vi.mock("@infra/catalog-service-factory", () => ({
  createCatalogService: () => mockCatalogService,
}));

const mockSalesPosService = { create: vi.fn() };
const mockClientsService = { create: vi.fn() };

vi.mock("../components/common/service-context", () => ({
  // useProductSyncWait reads the raw context; null context makes it a no-op.
  ServiceContext: createContext(null),
  useSalesPosService: () => mockSalesPosService,
  useClientsService: () => mockClientsService,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const unrestrictedItem: CatalogItem = {
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
};

const restrictedItem: CatalogItem = {
  id: "p-005",
  name: "Clonazepam 2mg",
  barcode: "7705678901234",
  invimaCertificate: "RS-2024-001",
  saleType: SaleType.CONTROLLED_SUBSTANCE,
  requiresPrescription: true,
  isRestricted: true,
  unitPriceCents: 18_900,
  costCents: null,
  taxPercentage: 19,
  currentStock: 34,
  minimumStock: 5,
  isActive: true,
  lotCode: "CZ-2401",
  lotExpirationDate: "2027-01-10",
  hasCompleteData: true,
  commissionType: null,
  commissionValue: null,
  commissionStartsAt: null,
  commissionEndsAt: null,
};

const incompleteItem: CatalogItem = {
  ...unrestrictedItem,
  id: "p-incomplete",
  unitPriceCents: null,
  hasCompleteData: false,
};

// Cart item for the checkout test. Tax-exempt so selectTotalCents
// equals the plain unit price (50 000).
const checkoutCartItem: CartItem = {
  id: "line-1",
  productId: "p-001",
  name: "Acetaminofén 500mg",
  invimaCertificate: "",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  lotCode: "L24056",
  lotExpirationDate: "2026-08-30",
  unitPriceCents: 50_000,
  overrideUnitPriceCents: null,
  discountPercentage: null,
  costCents: null,
  taxPercentage: 0,
  quantity: 1,
  commissionType: null,
  commissionValue: null,
  commissionStartsAt: null,
  commissionEndsAt: null,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useSalesTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSalesState = {
      items: [],
      selectedClient: null,
      delivery: null,
      selectedLineId: null,
      undoStack: [],
      heldCarts: [],
    };
  });

  describe("initial state", () => {
    it("returns catalogService, null pendingItem, and false isDialogOpen", () => {
      const { result } = renderHook(() => useSalesTransaction());

      expect(result.current.catalogService).toBe(mockCatalogService);
      expect(result.current.pendingItem).toBeNull();
      expect(result.current.isDialogOpen).toBe(false);
      // selectedClient derives from mockSalesState via the real selector —
      // not asserted here.
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
          invimaCertificate: "",
          saleType: unrestrictedItem.saleType,
          requiresPrescription: unrestrictedItem.requiresPrescription,
          isRestricted: false,
          lotCode: unrestrictedItem.lotCode,
          lotExpirationDate: unrestrictedItem.lotExpirationDate,
          unitPriceCents: unrestrictedItem.unitPriceCents!,
          taxPercentage: unrestrictedItem.taxPercentage,
          quantity: 1,
          overrideUnitPriceCents: null,
          discountPercentage: null,
          costCents: null,
          commissionType: null,
          commissionValue: null,
          commissionStartsAt: null,
          commissionEndsAt: null,
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
          invimaCertificate: restrictedItem.invimaCertificate ?? "",
          saleType: restrictedItem.saleType,
          requiresPrescription: restrictedItem.requiresPrescription,
          isRestricted: true,
          lotCode: restrictedItem.lotCode,
          lotExpirationDate: restrictedItem.lotExpirationDate,
          unitPriceCents: restrictedItem.unitPriceCents!,
          taxPercentage: restrictedItem.taxPercentage,
          quantity: 1,
          overrideUnitPriceCents: null,
          discountPercentage: null,
          costCents: null,
          commissionType: null,
          commissionValue: null,
          commissionStartsAt: null,
          commissionEndsAt: null,
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
    it("dispatches initializePayment with totalDue then navigates to payment screen", async () => {
      mockSalesState = {
        items: [checkoutCartItem],
        selectedClient: null,
        delivery: null,
        selectedLineId: null,
        undoStack: [],
        heldCarts: [],
      };
      mockSalesPosService.create.mockResolvedValue({ id: "sale-1" });
      const { result } = renderHook(() => useSalesTransaction());

      await act(async () => {
        await result.current.handleCheckout();
      });

      expect(mockSalesPosService.create).toHaveBeenCalledWith({
        clientId: null,
        delivery: null,
        items: [
          {
            productId: "p-001",
            quantity: 1,
            unitPrice: undefined,
            discountPercentage: undefined,
            discountReason: undefined,
          },
        ],
      });
      expect(mockDispatch).toHaveBeenCalledWith(
        initializePayment({ totalCents: 50_000 }),
      );
      expect(mockDispatch).toHaveBeenCalledWith(setActiveScreen("payment"));
    });

    it("forwards the delivery draft to create and charges its fee in the grand total", async () => {
      const deliveryDraft: SaleDeliveryDraft = {
        state: "PENDING",
        address: "Calle 10 #20-30",
        contactName: "Ana Gómez",
        contactPhone: "5551234",
        notes: null,
        scheduledAt: null,
        feeCents: 5_000,
      };
      mockSalesState = {
        items: [checkoutCartItem],
        selectedClient: null,
        delivery: deliveryDraft,
        selectedLineId: null,
        undoStack: [],
        heldCarts: [],
      };
      mockSalesPosService.create.mockResolvedValue({ id: "sale-2" });
      const { result } = renderHook(() => useSalesTransaction());

      await act(async () => {
        await result.current.handleCheckout();
      });

      expect(mockSalesPosService.create).toHaveBeenCalledWith({
        clientId: null,
        delivery: deliveryDraft,
        items: [
          {
            productId: "p-001",
            quantity: 1,
            unitPrice: undefined,
            discountPercentage: undefined,
            discountReason: undefined,
          },
        ],
      });
      // 50_000 item total + 5_000 delivery fee
      expect(mockDispatch).toHaveBeenCalledWith(
        initializePayment({ totalCents: 55_000 }),
      );
      expect(mockDispatch).toHaveBeenCalledWith(setActiveScreen("payment"));
    });
  });

  describe("handleSelectClient", () => {
    it("dispatches setClient with the given client", () => {
      const { result } = renderHook(() => useSalesTransaction());
      const client = {
        id: "c-001",
        name: "Juan Pérez",
        identification: "CC-123456789",
      };

      act(() => {
        result.current.handleSelectClient(client);
      });

      expect(mockDispatch).toHaveBeenCalledWith(setClient(client));
    });
  });

  describe("handleClearClient", () => {
    it("dispatches setClient with null", () => {
      const { result } = renderHook(() => useSalesTransaction());

      act(() => {
        result.current.handleClearClient();
      });

      expect(mockDispatch).toHaveBeenCalledWith(setClient(null));
    });
  });
});
