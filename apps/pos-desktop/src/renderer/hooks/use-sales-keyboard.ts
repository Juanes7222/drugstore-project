/**
 * Keyboard-first sales screen logic.
 *
 * Owns every keyboard interaction that lets the cashier run a sale without
 * touching the mouse:
 *
 * - **Search submit** (`submitSearch`): Enter on the search input resolves
 *   the query — exact barcode match first, otherwise the first complete
 *   result — and supports the `code xN` quantity syntax.
 * - **Cart line selection**: ArrowUp/ArrowDown move the selected line,
 *   Backspace/Delete remove it, Escape clears the selection.
 * - **Quick line edit**: with a line selected, typing a digit starts a
 *   quantity edit, `%` a discount edit, `=` a price edit. The edit buffer
 *   lives here; the component renders it as a small inline input.
 * - **Checkout**: F9 or Ctrl+Enter on the sales screen.
 * - **Undo**: Ctrl+Z restores the cart to its previous state.
 *
 * The keydown listener runs in the capture phase on `window` so it fires
 * before the search input's type-to-focus capture and before the global
 * shortcut hub — digits typed for a quick edit must never leak into the
 * search query.
 *
 * All cart reads go through Redux selectors; the only external bridges are
 * the catalog service and the add-to-cart/checkout callbacks owned by
 * `useSalesTransaction`.
 */
import { useCallback, useEffect, useState } from "react";
import i18n from "@/i18n";
import { formatCurrency } from "@/utils/format-currency";
import {
  removeItem,
  selectCartItems,
  selectSelectedLineId,
  setSelectedLine,
  undoLastChange,
  updateItemDiscount,
  updateItemPrice,
  updateQuantity,
} from "@/store/slices/sales-slice";
import { selectActiveScreen } from "@/store/slices/ui-slice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useLocalSessionStore } from "../../domain/auth/local-session.store";
import {
  type CatalogItem,
  type CatalogService,
  isCatalogItemRestricted,
} from "@/services/catalog-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LineQuickEditMode = "quantity" | "discount" | "price";

export interface LineQuickEdit {
  lineId: string;
  mode: LineQuickEditMode;
  /** Raw buffer the inline input displays. */
  draft: string;
  /** Localized validation error, or null when the draft is valid. */
  error: string | null;
}

export type SearchSubmitStatus =
  | "added"
  | "restricted"
  | "not-found"
  | "incomplete"
  | "empty";

export interface SearchSubmitResult {
  status: SearchSubmitStatus;
  /** The resolved catalog item when one was found. */
  item?: CatalogItem;
}

export interface UseSalesKeyboardDeps {
  catalogService: CatalogService;
  /** True while the restricted-item confirmation dialog is open. */
  isDialogOpen: boolean;
  /** True while the sale is being persisted at checkout. */
  isCreating: boolean;
  /** Add a catalog item to the cart; opens the restricted dialog when needed. */
  onAddCatalogItem: (item: CatalogItem, quantity?: number) => void;
  /** Persist the cart and navigate to the payment screen. */
  onCheckout: () => void;
}

export interface UseSalesKeyboardReturn {
  /** Active line edit buffer, or null when no edit is in progress. */
  quickEdit: LineQuickEdit | null;
  /** Replace the current draft (inline input onChange). */
  setQuickEditDraft: (draft: string) => void;
  /** Commit the current edit; leaves the buffer when valid. */
  commitQuickEdit: () => void;
  /** Abort the current edit without applying it. */
  cancelQuickEdit: () => void;
  /**
   * Resolve a search query and add the product to the cart.
   * Exact barcode match wins; `code xN` sets the quantity.
   * Returns the outcome so the component can clear the input or show
   * not-found feedback.
   */
  submitSearch: (query: string) => Promise<SearchSubmitResult>;
}

/** Roles allowed to override a line price (mirrors cart-line-item). */
const PRICE_OVERRIDE_ROLES = new Set([
  "OWNER",
  "MANAGER",
  "ADMIN",
  "SAAS_ADMIN",
]);

/** `code xN` quantity syntax: "77012345 x3", "acetaminofen x2". */
const QUANTITY_SUFFIX_RE = /^\s*(.+?)\s+x\s*(\d+)\s*$/i;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSalesKeyboard({
  catalogService,
  isDialogOpen,
  isCreating,
  onAddCatalogItem,
  onCheckout,
}: UseSalesKeyboardDeps): UseSalesKeyboardReturn {
  const dispatch = useAppDispatch();
  const activeScreen = useAppSelector(selectActiveScreen);
  const cartItems = useAppSelector(selectCartItems);
  const selectedLineId = useAppSelector(selectSelectedLineId);
  const session = useLocalSessionStore((s) => s.session);
  const canOverridePrice = PRICE_OVERRIDE_ROLES.has(session?.role ?? "");

  const [quickEdit, setQuickEdit] = useState<LineQuickEdit | null>(null);

  // -- Selection ----------------------------------------------------------

  const moveSelection = useCallback(
    (delta: 1 | -1) => {
      const ids = cartItems.map((item) => item.id);
      if (ids.length === 0) {
        dispatch(setSelectedLine(null));
        return;
      }
      if (selectedLineId === null || !ids.includes(selectedLineId)) {
        dispatch(setSelectedLine(ids[0]));
        return;
      }
      const index = ids.indexOf(selectedLineId);
      const next = Math.min(Math.max(index + delta, 0), ids.length - 1);
      dispatch(setSelectedLine(ids[next]));
    },
    [cartItems, selectedLineId, dispatch],
  );

  const removeSelectedLine = useCallback(() => {
    if (selectedLineId !== null) {
      dispatch(removeItem(selectedLineId));
    }
  }, [selectedLineId, dispatch]);

  // -- Quick edit ---------------------------------------------------------

  const startQuickEdit = useCallback(
    (mode: LineQuickEditMode, initialDraft = "") => {
      if (selectedLineId === null) return;
      if (mode === "price" && !canOverridePrice) return;
      setQuickEdit({ lineId: selectedLineId, mode, draft: initialDraft, error: null });
    },
    [selectedLineId, canOverridePrice],
  );

  const setQuickEditDraft = useCallback((draft: string) => {
    setQuickEdit((current) =>
      current ? { ...current, draft, error: null } : current,
    );
  }, []);

  const cancelQuickEdit = useCallback(() => {
    setQuickEdit(null);
  }, []);

  const commitQuickEdit = useCallback(() => {
    setQuickEdit((current) => {
      if (!current) return current;

      const { lineId, mode, draft } = current;
      const item = cartItems.find((cartItem) => cartItem.id === lineId);
      if (!item) return null;

      const trimmed = draft.trim();

      if (mode === "quantity") {
        const quantity = parseInt(trimmed, 10);
        if (!Number.isNaN(quantity) && quantity >= 0) {
          // updateQuantity removes the line when quantity is 0.
          dispatch(updateQuantity({ id: lineId, quantity }));
        }
        return null;
      }

      if (mode === "discount") {
        if (trimmed === "") {
          dispatch(updateItemDiscount({ id: lineId, discountPercentage: null }));
          return null;
        }
        const percentage = parseFloat(trimmed);
        if (!Number.isNaN(percentage) && percentage >= 0 && percentage <= 100) {
          dispatch(updateItemDiscount({ id: lineId, discountPercentage: percentage }));
        }
        return null;
      }

      // mode === "price"
      const parsed = parseFloat(trimmed.replace(",", "."));
      if (Number.isNaN(parsed) || parsed < 0) return null;

      const newCents = Math.round(parsed * 100);
      if (item.costCents !== null && newCents < item.costCents) {
        return {
          ...current,
          error: i18n.t("sales.cart.error_price_below_cost", {
            name: item.name,
            price: formatCurrency(newCents),
            floor: formatCurrency(item.costCents),
          }),
        };
      }
      dispatch(updateItemPrice({ id: lineId, unitPriceCents: newCents }));
      return null;
    });
  }, [cartItems, dispatch]);

  // -- Search submit ------------------------------------------------------

  const submitSearch = useCallback(
    async (rawQuery: string): Promise<SearchSubmitResult> => {
      const query = rawQuery.trim();
      if (!query) return { status: "empty" };

      const quantityMatch = QUANTITY_SUFFIX_RE.exec(query);
      const code = quantityMatch ? quantityMatch[1].trim() : query;
      const quantity = quantityMatch
        ? Math.max(1, parseInt(quantityMatch[2], 10))
        : 1;

      const items = await catalogService.search(code);
      if (items.length === 0) return { status: "not-found" };

      const exactBarcode = items.find(
        (item) => item.barcode.trim() === code,
      );
      const target = exactBarcode ?? items[0];

      if (!target.hasCompleteData || target.unitPriceCents === null) {
        return { status: "incomplete", item: target };
      }

      if (isCatalogItemRestricted(target)) {
        onAddCatalogItem(target, quantity);
        return { status: "restricted", item: target };
      }

      onAddCatalogItem(target, quantity);
      return { status: "added", item: target };
    },
    [catalogService, onAddCatalogItem],
  );

  // -- Global keydown (capture phase) -------------------------------------

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.defaultPrevented) return;
      if (activeScreen !== "sales") return;
      if (isDialogOpen) return;

      const meta = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase() ?? "";
      const isInInput =
        tagName === "input" ||
        tagName === "textarea" ||
        target?.isContentEditable === true;

      // Checkout — always active on the sales screen, even while typing.
      // The parent checkout callback also guards on empty cart / in-flight.
      if (event.key === "F9" || (meta && event.key === "Enter")) {
        if (isCreating) return;
        event.preventDefault();
        event.stopPropagation();
        onCheckout();
        return;
      }

      // Undo — skipped in inputs so native text undo keeps working.
      if (meta && event.key === "z") {
        if (isInInput) return;
        event.preventDefault();
        event.stopPropagation();
        dispatch(undoLastChange());
        return;
      }

      // Quick edit in progress: Escape cancels it, anything else goes to
      // the inline input (which has focus and handles its own keys).
      if (quickEdit) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setQuickEdit(null);
        }
        return;
      }

      if (isInInput) return;
      if (cartItems.length === 0) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveSelection(event.key === "ArrowDown" ? 1 : -1);
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        if (selectedLineId === null) return;
        event.preventDefault();
        event.stopPropagation();
        removeSelectedLine();
        return;
      }

      if (event.key === "Escape") {
        if (selectedLineId === null) return;
        event.preventDefault();
        event.stopPropagation();
        dispatch(setSelectedLine(null));
        return;
      }

      // Start a quick edit on the selected line. Digits begin a quantity
      // edit so "5 ↵" sets the quantity without opening a dialog.
      if (selectedLineId === null) return;

      if (event.key === "=") {
        event.preventDefault();
        event.stopPropagation();
        startQuickEdit("price");
        return;
      }
      if (event.key === "%") {
        event.preventDefault();
        event.stopPropagation();
        startQuickEdit("discount");
        return;
      }
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        startQuickEdit("quantity", event.key);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    activeScreen,
    isDialogOpen,
    isCreating,
    quickEdit,
    cartItems,
    selectedLineId,
    moveSelection,
    removeSelectedLine,
    startQuickEdit,
    dispatch,
    onCheckout,
  ]);

  return {
    quickEdit,
    setQuickEditDraft,
    commitQuickEdit,
    cancelQuickEdit,
    submitSearch,
  };
}