/**
 * Unit tests for useSalesKeyboard.
 *
 * The hook's cart/selection/screen reads go through Redux selectors and its
 * session role comes from the module-scoped local-session store, so the
 * Redux hooks are mocked against a mutable state object while the real
 * Zustand store is driven through setState. Keydown events are dispatched
 * on window (or on a real input element for the "while typing" cases).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import i18n from "@/i18n";
import { formatCurrency } from "@/utils/format-currency";
import { SaleType } from "@pharmacy/shared-types";
import {
  removeItem,
  setSelectedLine,
  undoLastChange,
  updateItemDiscount,
  updateItemPrice,
  updateQuantity,
} from "@/store/slices/sales-slice";
import type { PosScreen } from "@/store/slices/ui-types";
import {
  useLocalSessionStore,
  type LocalSession,
} from "../../domain/auth/local-session.store";
import {
  useSalesKeyboard,
  type UseSalesKeyboardDeps,
  type UseSalesKeyboardReturn,
} from "./use-sales-keyboard";
import type { CatalogItem, CatalogService } from "@/services/catalog-service";
import type { CartItem, SalesState } from "@/store/slices/sales-types";

// ---------------------------------------------------------------------------
// Hoisted mocks for Redux hooks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
let mockSalesState: SalesState = {
  items: [],
  selectedClient: null,
  delivery: null,
  selectedLineId: null,
  undoStack: [],
};
let mockUiState: { activeScreen: PosScreen } = { activeScreen: "sales" };

interface MockRoot {
  sales: SalesState;
  ui: { activeScreen: PosScreen };
}

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => mockDispatch,
  // Invoke the real selectors against a mutable state so each selector
  // returns its own slice of state.
  useAppSelector: (selector: unknown) =>
    (selector as (state: MockRoot) => unknown)({
      sales: mockSalesState,
      ui: mockUiState,
    }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseItem = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: "line-1",
  productId: "p-001",
  name: "Acetaminofén 500mg",
  invimaCertificate: "INVIMA-2025-001",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  lotCode: "LOT-A01",
  lotExpirationDate: "2027-06-01",
  unitPriceCents: 500_000,
  overrideUnitPriceCents: null,
  discountPercentage: null,
  costCents: null,
  taxPercentage: 19,
  quantity: 1,
  commissionType: null,
  commissionValue: null,
  commissionStartsAt: null,
  commissionEndsAt: null,
  ...overrides,
});

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

const makeSession = (role: string): LocalSession => ({
  userId: "u-1",
  username: "cashier",
  fullName: "Cajero Uno",
  displayName: "Cajero",
  role,
  subscriptionId: null,
  workstationId: "ws-1",
  accessToken: "",
  refreshToken: "",
  sessionId: "s-1",
  sessionTrust: "LOCAL_UNVERIFIED",
});

const makeDeps = (
  overrides: Partial<UseSalesKeyboardDeps> = {},
): UseSalesKeyboardDeps => ({
  catalogService: mockCatalogService,
  isDialogOpen: false,
  isCreating: false,
  onAddCatalogItem: vi.fn(),
  onCheckout: vi.fn(),
  ...overrides,
});

const mockCatalogService: CatalogService = { search: vi.fn() };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pressKey = (init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => window.dispatchEvent(event));
  return event;
};

/** Dispatch a keydown that bubbles up from a focused input element. */
const pressKeyInInput = (init: KeyboardEventInit): KeyboardEvent => {
  const input = document.createElement("input");
  document.body.appendChild(input);
  input.focus();
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => input.dispatchEvent(event));
  input.remove();
  return event;
};

/** Track whether the event kept bubbling past the capture-phase handler. */
const listenForBubble = (): { fired: () => boolean } => {
  let bubbled = false;
  const listener = () => {
    bubbled = true;
  };
  window.addEventListener("keydown", listener, false);
  return {
    fired: () => {
      window.removeEventListener("keydown", listener, false);
      return bubbled;
    },
  };
};

const setCart = (
  items: CartItem[],
  selectedLineId: string | null = null,
): void => {
  mockSalesState = {
    ...mockSalesState,
    items,
    selectedLineId,
  };
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useSalesKeyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSalesState = {
      items: [],
      selectedClient: null,
      delivery: null,
      selectedLineId: null,
      undoStack: [],
    };
    mockUiState = { activeScreen: "sales" };
    useLocalSessionStore.setState({ session: null });
  });

  afterEach(() => {
    useLocalSessionStore.setState({ session: null });
  });

  describe("submitSearch", () => {
    it("returns 'empty' for a blank query without touching the catalog", async () => {
      const deps = makeDeps();
      const { result } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });

      const outcome = await result.current.submitSearch("   ");

      expect(outcome).toEqual({ status: "empty" });
      expect(mockCatalogService.search).not.toHaveBeenCalled();
    });

    it("parses the 'code xN' suffix and adds with that quantity", async () => {
      const item = catalogItem();
      vi.mocked(mockCatalogService.search).mockResolvedValue([item]);
      const deps = makeDeps();
      const { result } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });

      const outcome = await result.current.submitSearch("7701234567890 x3");

      expect(mockCatalogService.search).toHaveBeenCalledWith("7701234567890");
      expect(outcome).toEqual({ status: "added", item });
      expect(deps.onAddCatalogItem).toHaveBeenCalledWith(item, 3);
    });

    it("parses the quantity suffix on a name query too", async () => {
      const item = catalogItem();
      vi.mocked(mockCatalogService.search).mockResolvedValue([item]);
      const deps = makeDeps();
      const { result } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });

      await result.current.submitSearch("acetaminofen x2");

      expect(mockCatalogService.search).toHaveBeenCalledWith("acetaminofen");
      expect(deps.onAddCatalogItem).toHaveBeenCalledWith(item, 2);
    });

    it("prefers the exact barcode match over the first result", async () => {
      const decoy = catalogItem({
        id: "p-decoy",
        name: "Acetaminofén 500mg",
        barcode: "8888888888888",
      });
      const exact = catalogItem({ id: "p-exact", barcode: "7701234567890" });
      vi.mocked(mockCatalogService.search).mockResolvedValue([decoy, exact]);
      const deps = makeDeps();
      const { result } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });

      const outcome = await result.current.submitSearch("7701234567890");

      expect(outcome).toEqual({ status: "added", item: exact });
      expect(deps.onAddCatalogItem).toHaveBeenCalledWith(exact, 1);
    });

    it("returns 'not-found' when the catalog has no matches", async () => {
      vi.mocked(mockCatalogService.search).mockResolvedValue([]);
      const deps = makeDeps();
      const { result } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });

      const outcome = await result.current.submitSearch("7709999999999");

      expect(outcome).toEqual({ status: "not-found" });
      expect(deps.onAddCatalogItem).not.toHaveBeenCalled();
    });

    it("returns 'incomplete' without adding when the item lacks price data", async () => {
      const incomplete = catalogItem({
        id: "p-incomplete",
        unitPriceCents: null,
        hasCompleteData: false,
      });
      vi.mocked(mockCatalogService.search).mockResolvedValue([incomplete]);
      const deps = makeDeps();
      const { result } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });

      const outcome = await result.current.submitSearch("7701234567890");

      expect(outcome).toEqual({ status: "incomplete", item: incomplete });
      expect(deps.onAddCatalogItem).not.toHaveBeenCalled();
    });

    it("returns 'restricted' and forwards the item with its quantity", async () => {
      const restricted = catalogItem({
        id: "p-005",
        saleType: SaleType.CONTROLLED_SUBSTANCE,
        requiresPrescription: true,
        isRestricted: true,
      });
      vi.mocked(mockCatalogService.search).mockResolvedValue([restricted]);
      const deps = makeDeps();
      const { result } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });

      const outcome = await result.current.submitSearch("7701234567890 x2");

      expect(outcome).toEqual({ status: "restricted", item: restricted });
      expect(deps.onAddCatalogItem).toHaveBeenCalledWith(restricted, 2);
    });
  });

  describe("checkout keys (F9, Ctrl+Enter)", () => {
    it("F9 calls onCheckout", () => {
      const deps = makeDeps();
      renderHook((props) => useSalesKeyboard(props), { initialProps: deps });

      pressKey({ key: "F9" });

      expect(deps.onCheckout).toHaveBeenCalledOnce();
    });

    it("Ctrl+Enter calls onCheckout", () => {
      const deps = makeDeps();
      renderHook((props) => useSalesKeyboard(props), { initialProps: deps });

      pressKey({ key: "Enter", ctrlKey: true });

      expect(deps.onCheckout).toHaveBeenCalledOnce();
    });

    it("F9 fires while the focus is inside an input", () => {
      const deps = makeDeps();
      renderHook((props) => useSalesKeyboard(props), { initialProps: deps });

      pressKeyInInput({ key: "F9" });

      expect(deps.onCheckout).toHaveBeenCalledOnce();
    });

    it("F9 is skipped while the sale is being created", () => {
      const deps = makeDeps({ isCreating: true });
      renderHook((props) => useSalesKeyboard(props), { initialProps: deps });

      pressKey({ key: "F9" });

      expect(deps.onCheckout).not.toHaveBeenCalled();
    });
  });

  describe("undo (Ctrl+Z)", () => {
    it("dispatches undoLastChange when no input is focused", () => {
      renderHook((props) => useSalesKeyboard(props), {
        initialProps: makeDeps(),
      });

      pressKey({ key: "z", ctrlKey: true });

      expect(mockDispatch).toHaveBeenCalledWith(undoLastChange());
    });

    it("does not dispatch when an input is focused", () => {
      renderHook((props) => useSalesKeyboard(props), {
        initialProps: makeDeps(),
      });

      const event = pressKeyInInput({ key: "z", ctrlKey: true });

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it("does nothing when the event was already prevented", () => {
      renderHook((props) => useSalesKeyboard(props), {
        initialProps: makeDeps(),
      });
      const event = new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();

      act(() => window.dispatchEvent(event));

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe("selection movement (arrows)", () => {
    it("does nothing when the cart is empty", () => {
      renderHook((props) => useSalesKeyboard(props), {
        initialProps: makeDeps(),
      });

      pressKey({ key: "ArrowDown" });

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("first ArrowDown press selects the first line", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" }), baseItem({ id: "line-2" })]);
      const { rerender } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      rerender(deps);

      pressKey({ key: "ArrowDown" });

      expect(mockDispatch).toHaveBeenCalledWith(setSelectedLine("line-1"));
    });

    it("ArrowDown moves to the next line and clamps at the last one", () => {
      const deps = makeDeps();
      setCart(
        [baseItem({ id: "line-1" }), baseItem({ id: "line-2" })],
        "line-1",
      );
      const { rerender } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      rerender(deps);

      pressKey({ key: "ArrowDown" });
      expect(mockDispatch).toHaveBeenCalledWith(setSelectedLine("line-2"));

      pressKey({ key: "ArrowDown" });
      expect(mockDispatch).toHaveBeenLastCalledWith(setSelectedLine("line-2"));
    });

    it("ArrowUp moves to the previous line and clamps at the first one", () => {
      const deps = makeDeps();
      setCart(
        [baseItem({ id: "line-1" }), baseItem({ id: "line-2" })],
        "line-2",
      );
      const { rerender } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      rerender(deps);

      pressKey({ key: "ArrowUp" });
      expect(mockDispatch).toHaveBeenCalledWith(setSelectedLine("line-1"));

      pressKey({ key: "ArrowUp" });
      expect(mockDispatch).toHaveBeenLastCalledWith(setSelectedLine("line-1"));
    });

    it("arrows inside an input never move the selection", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const { rerender } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      rerender(deps);

      pressKeyInInput({ key: "ArrowDown" });

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe("line removal (Backspace/Delete)", () => {
    it("Backspace with a selection dispatches removeItem", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const { rerender } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      rerender(deps);

      const event = pressKey({ key: "Backspace" });

      expect(mockDispatch).toHaveBeenCalledWith(removeItem("line-1"));
      expect(event.defaultPrevented).toBe(true);
    });

    it("Delete with a selection dispatches removeItem", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const { rerender } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      rerender(deps);

      pressKey({ key: "Delete" });

      expect(mockDispatch).toHaveBeenCalledWith(removeItem("line-1"));
    });

    it("Backspace without a selection does nothing and does not prevent default", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })]);
      const { rerender } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      rerender(deps);

      const event = pressKey({ key: "Backspace" });

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("Escape", () => {
    it("with a selection clears it and stops the event from bubbling", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const { rerender } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      rerender(deps);
      const bubble = listenForBubble();

      const event = pressKey({ key: "Escape" });

      expect(mockDispatch).toHaveBeenCalledWith(setSelectedLine(null));
      expect(event.defaultPrevented).toBe(true);
      expect(bubble.fired()).toBe(false);
    });

    it("without a selection does not prevent default and lets the event bubble", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })]);
      const { rerender } = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      rerender(deps);
      const bubble = listenForBubble();

      const event = pressKey({ key: "Escape" });

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(bubble.fired()).toBe(true);
    });

    it("during a quick edit cancels the edit", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const { result, rerender } = renderHook(
        (props) => useSalesKeyboard(props),
        { initialProps: deps },
      );
      rerender(deps);

      pressKey({ key: "5" });
      expect(result.current.quickEdit).not.toBeNull();

      pressKey({ key: "Escape" });

      expect(result.current.quickEdit).toBeNull();
    });
  });

  describe("starting quick edits", () => {
    it("a digit starts a quantity edit with that digit as draft", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const { result, rerender } = renderHook(
        (props) => useSalesKeyboard(props),
        { initialProps: deps },
      );
      rerender(deps);
      const bubble = listenForBubble();

      const event = pressKey({ key: "5" });

      expect(result.current.quickEdit).toEqual({
        lineId: "line-1",
        mode: "quantity",
        draft: "5",
        error: null,
      });
      expect(event.defaultPrevented).toBe(true);
      expect(bubble.fired()).toBe(false);
    });

    it("a digit without a selection does not start an edit and does not prevent default", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })]);
      const { result, rerender } = renderHook(
        (props) => useSalesKeyboard(props),
        { initialProps: deps },
      );
      rerender(deps);

      const event = pressKey({ key: "5" });

      expect(result.current.quickEdit).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    });

    it("% starts a discount edit", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const { result, rerender } = renderHook(
        (props) => useSalesKeyboard(props),
        { initialProps: deps },
      );
      rerender(deps);

      pressKey({ key: "%" });

      expect(result.current.quickEdit).toEqual({
        lineId: "line-1",
        mode: "discount",
        draft: "",
        error: null,
      });
    });

    it("= starts a price edit for an OWNER session", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const { result, rerender } = renderHook(
        (props) => useSalesKeyboard(props),
        { initialProps: deps },
      );
      rerender(deps);
      act(() =>
        useLocalSessionStore.setState({ session: makeSession("OWNER") }),
      );

      pressKey({ key: "=" });

      expect(result.current.quickEdit).toEqual({
        lineId: "line-1",
        mode: "price",
        draft: "",
        error: null,
      });
    });

    it("= does not start a price edit for a CASHIER session", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const { result, rerender } = renderHook(
        (props) => useSalesKeyboard(props),
        { initialProps: deps },
      );
      rerender(deps);
      act(() =>
        useLocalSessionStore.setState({ session: makeSession("CASHIER") }),
      );

      pressKey({ key: "=" });

      expect(result.current.quickEdit).toBeNull();
    });

    it("= does not start a price edit without a session", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const { result, rerender } = renderHook(
        (props) => useSalesKeyboard(props),
        { initialProps: deps },
      );
      rerender(deps);

      pressKey({ key: "=" });

      expect(result.current.quickEdit).toBeNull();
    });
  });

  describe("committing quick edits", () => {
    const startQuantityEdit = (
      result: { current: UseSalesKeyboardReturn },
      draft: string,
    ) => {
      act(() => result.current.setQuickEditDraft(draft));
      act(() => result.current.commitQuickEdit());
    };

    it("commits a parsed quantity", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1", quantity: 1 })], "line-1");
      const utils = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      utils.rerender(deps);

      pressKey({ key: "5" });
      startQuantityEdit(utils.result, "7");

      expect(mockDispatch).toHaveBeenCalledWith(
        updateQuantity({ id: "line-1", quantity: 7 }),
      );
    });

    it("commits quantity 0, which removes the line in the slice", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1", quantity: 3 })], "line-1");
      const utils = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      utils.rerender(deps);

      pressKey({ key: "5" });
      startQuantityEdit(utils.result, "0");

      expect(mockDispatch).toHaveBeenCalledWith(
        updateQuantity({ id: "line-1", quantity: 0 }),
      );
    });

    it("ignores a non-numeric quantity draft", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1", quantity: 1 })], "line-1");
      const utils = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      utils.rerender(deps);

      pressKey({ key: "5" });
      startQuantityEdit(utils.result, "abc");

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("an empty discount draft clears the discount", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const utils = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      utils.rerender(deps);

      pressKey({ key: "%" });
      act(() => utils.result.current.commitQuickEdit());

      expect(mockDispatch).toHaveBeenCalledWith(
        updateItemDiscount({ id: "line-1", discountPercentage: null }),
      );
    });

    it("commits a discount percentage in range", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const utils = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      utils.rerender(deps);

      pressKey({ key: "%" });
      act(() => utils.result.current.setQuickEditDraft("50"));
      act(() => utils.result.current.commitQuickEdit());

      expect(mockDispatch).toHaveBeenCalledWith(
        updateItemDiscount({ id: "line-1", discountPercentage: 50 }),
      );
    });

    it("ignores a discount draft outside the 0–100 range", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const utils = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      utils.rerender(deps);

      pressKey({ key: "%" });
      act(() => utils.result.current.setQuickEditDraft("150"));
      act(() => utils.result.current.commitQuickEdit());

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("commits a price in pesos as cents", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1", costCents: null })], "line-1");
      const utils = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      utils.rerender(deps);
      act(() =>
        useLocalSessionStore.setState({ session: makeSession("OWNER") }),
      );

      pressKey({ key: "=" });
      act(() => utils.result.current.setQuickEditDraft("2500"));
      act(() => utils.result.current.commitQuickEdit());

      expect(mockDispatch).toHaveBeenCalledWith(
        updateItemPrice({ id: "line-1", unitPriceCents: 250_000 }),
      );
    });

    it("accepts a comma as the decimal separator in a price", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1", costCents: null })], "line-1");
      const utils = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      utils.rerender(deps);
      act(() =>
        useLocalSessionStore.setState({ session: makeSession("OWNER") }),
      );

      pressKey({ key: "=" });
      act(() => utils.result.current.setQuickEditDraft("12,5"));
      act(() => utils.result.current.commitQuickEdit());

      expect(mockDispatch).toHaveBeenCalledWith(
        updateItemPrice({ id: "line-1", unitPriceCents: 1_250 }),
      );
    });

    it("keeps the buffer open with a localized error when the price is below cost", () => {
      const item = baseItem({ id: "line-1", costCents: 300_000 });
      const deps = makeDeps();
      setCart([item], "line-1");
      const utils = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      utils.rerender(deps);
      act(() =>
        useLocalSessionStore.setState({ session: makeSession("OWNER") }),
      );

      pressKey({ key: "=" });
      act(() => utils.result.current.setQuickEditDraft("2500"));
      act(() => utils.result.current.commitQuickEdit());

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(utils.result.current.quickEdit).not.toBeNull();
      expect(utils.result.current.quickEdit?.draft).toBe("2500");
      expect(utils.result.current.quickEdit?.error).toBe(
        i18n.t("sales.cart.error_price_below_cost", {
          name: item.name,
          price: formatCurrency(250_000),
          floor: formatCurrency(300_000),
        }),
      );
    });

    it("commits a price equal to the cost floor", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1", costCents: 300_000 })], "line-1");
      const utils = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      utils.rerender(deps);
      act(() =>
        useLocalSessionStore.setState({ session: makeSession("OWNER") }),
      );

      pressKey({ key: "=" });
      act(() => utils.result.current.setQuickEditDraft("3000"));
      act(() => utils.result.current.commitQuickEdit());

      expect(mockDispatch).toHaveBeenCalledWith(
        updateItemPrice({ id: "line-1", unitPriceCents: 300_000 }),
      );
    });

    it("drops the buffer for an unparseable price", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1", costCents: null })], "line-1");
      const utils = renderHook((props) => useSalesKeyboard(props), {
        initialProps: deps,
      });
      utils.rerender(deps);
      act(() =>
        useLocalSessionStore.setState({ session: makeSession("OWNER") }),
      );

      pressKey({ key: "=" });
      act(() => utils.result.current.setQuickEditDraft("abc"));
      act(() => utils.result.current.commitQuickEdit());

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(utils.result.current.quickEdit).toBeNull();
    });

    it("cancelQuickEdit clears the buffer without dispatching", () => {
      const deps = makeDeps();
      setCart([baseItem({ id: "line-1" })], "line-1");
      const { result, rerender } = renderHook(
        (props) => useSalesKeyboard(props),
        { initialProps: deps },
      );
      rerender(deps);

      pressKey({ key: "5" });
      act(() => result.current.cancelQuickEdit());

      expect(result.current.quickEdit).toBeNull();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe("gating", () => {
    it("does nothing when the active screen is not sales", () => {
      mockUiState = { activeScreen: "payment" };
      const deps = makeDeps();
      renderHook((props) => useSalesKeyboard(props), { initialProps: deps });

      pressKey({ key: "F9" });
      pressKey({ key: "z", ctrlKey: true });

      expect(deps.onCheckout).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("does nothing while the restricted-item dialog is open", () => {
      const deps = makeDeps({ isDialogOpen: true });
      renderHook((props) => useSalesKeyboard(props), { initialProps: deps });

      pressKey({ key: "F9" });
      pressKey({ key: "z", ctrlKey: true });

      expect(deps.onCheckout).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});
