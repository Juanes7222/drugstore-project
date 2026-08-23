/**
 * Keyboard-first payment screen logic — focus-driven navigation.
 *
 * The amount inputs on the payment screen are the real currency inputs the
 * cashier types into; this hook only decides WHICH input is active and moves
 * focus there. Typed digits land natively in the focused input, exactly
 * where the cashier expects to see them:
 *
 * - **ArrowUp/ArrowDown** move the active row (and with cash change due,
 *   the "received" field is the last stop). The component focuses the
 *   selected row's amount input, so typing starts immediately.
 * - **F9 / Ctrl+Enter** confirms the payment (same muscle memory as the
 *   sales screen).
 * - **+** adds another payment method row.
 * - **Escape** clears the selection (and blur).
 *
 * Enter-per-input semantics live in the component (it knows which row its
 * input belongs to): Enter on an electronic amount authorizes it, Enter on
 * cash moves to "received" when change is due.
 *
 * The listener runs in the capture phase and intercepts arrows/Escape/+
 * even while an input is focused — arrows are never typed into a money
 * field, so stealing them is safe.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  selectCashOwedCents,
  selectPaymentMethods,
} from "@/store/slices/payment-slice";
import { selectActiveScreen } from "@/store/slices/ui-slice";
import { useAppSelector } from "@/store/hooks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the keyboard acts on: a payment row, or the cash "received" field. */
export type PaymentTarget =
  | { kind: "row"; rowId: string }
  | { kind: "received" };

export interface UsePaymentKeyboardDeps {
  isCompleting: boolean;
  canConfirm: boolean;
  /** Confirm the payment (already gated by canConfirm/isCompleting/credit). */
  onConfirm: () => void;
  /** Add a new payment method row. */
  onAddMethod: () => void;
}

export interface UsePaymentKeyboardReturn {
  /** The row or field the keyboard currently acts on. */
  selection: PaymentTarget | null;
  /** Whether the cash "received" field is part of the navigation. */
  showCashReceived: boolean;
  /** Move the selection up/down; starting fresh selects the first row. */
  moveSelection: (delta: 1 | -1) => void;
  /** Clear the selection (Escape). */
  clearSelection: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePaymentKeyboard({
  isCompleting,
  canConfirm,
  onConfirm,
  onAddMethod,
}: UsePaymentKeyboardDeps): UsePaymentKeyboardReturn {
  const activeScreen = useAppSelector(selectActiveScreen);
  const methods = useAppSelector(selectPaymentMethods);
  const cashOwed = useAppSelector(selectCashOwedCents);
  const showCashReceived = cashOwed > 0;

  const [selection, setSelection] = useState<PaymentTarget | null>(null);

  // Auto-select the first row when the screen mounts so the cashier can
  // start typing an amount immediately.
  useEffect(() => {
    if (selection === null && methods.length > 0) {
      setSelection({ kind: "row", rowId: methods[0].id });
    }
  }, [selection, methods]);

  const moveSelection = useCallback(
    (delta: 1 | -1) => {
      const rowTargets: PaymentTarget[] = methods.map((method) => ({
        kind: "row" as const,
        rowId: method.id,
      }));
      if (showCashReceived) {
        rowTargets.push({ kind: "received" as const });
      }
      if (rowTargets.length === 0) {
        setSelection(null);
        return;
      }

      if (selection === null) {
        setSelection(rowTargets[0]);
        return;
      }

      const index = rowTargets.findIndex((target) => {
        if (target.kind !== selection.kind) return false;
        return target.kind === "row"
          ? target.rowId === (selection as { kind: "row"; rowId: string }).rowId
          : true;
      });
      const current = index >= 0 ? index : 0;
      const next = Math.min(Math.max(current + delta, 0), rowTargets.length - 1);
      setSelection(rowTargets[next]);
    },
    [methods, showCashReceived, selection],
  );

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  // -- Global keydown (capture phase) -------------------------------------

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.defaultPrevented) return;
      if (activeScreen !== "payment") return;
      if (isCompleting) return;

      const meta = event.metaKey || event.ctrlKey;

      // Confirm — same muscle memory as the sales screen; works in inputs.
      if (event.key === "F9" || (meta && event.key === "Enter")) {
        if (!canConfirm) return;
        event.preventDefault();
        event.stopPropagation();
        onConfirm();
        return;
      }

      // Arrows move the selection even while an input is focused — arrows
      // are never typed into a money field.
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveSelection(event.key === "ArrowDown" ? 1 : -1);
        return;
      }

      // Escape clears the selection everywhere on the payment screen.
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        clearSelection();
        return;
      }

      // "+" (or Shift+=) adds a payment method row.
      if (event.key === "+" || (event.shiftKey && event.key === "=")) {
        event.preventDefault();
        event.stopPropagation();
        onAddMethod();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    activeScreen,
    isCompleting,
    canConfirm,
    moveSelection,
    clearSelection,
    onConfirm,
    onAddMethod,
  ]);

  return useMemo(
    () => ({
      selection,
      showCashReceived,
      moveSelection,
      clearSelection,
    }),
    [selection, showCashReceived, moveSelection, clearSelection],
  );
}