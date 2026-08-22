/**
 * Keyboard-first payment screen logic.
 *
 * Completes the hands-free sale flow: the cashier never touches the mouse
 * between scanning the last item (sales screen) and confirming the payment:
 *
 * - **F9 / Ctrl+Enter** confirms the payment (same muscle memory as the
 *   sales screen).
 * - **ArrowUp/ArrowDown** moves the active row; with cash change due, the
 *   "received" field is the last stop of the navigation.
 * - **Digits** start a money buffer on the active row (pesos, optional dot
 *   for decimals); **Enter** commits it, **Backspace** deletes the last
 *   digit, **Escape** cancels.
 * - **Enter** on an empty electronic row authorizes it (gateway call).
 * - **+** adds another payment method row.
 * - **Backspace** on an empty buffer removes the active row (when more than
 *   one exists).
 *
 * Like the sales keyboard, the listener runs in the capture phase and skips
 * everything when an input has focus — the existing CurrencyInputs keep
 * their native editing when the cashier clicks into them. The buffer is
 * transient hook state; the component renders the selection highlight and
 * the typed digits.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { type PaymentMethodEntry } from "@/store/slices/payment-types";
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

export interface PaymentBuffer {
  /** The row the money goes to. "received" targets the cash-received field. */
  target: PaymentTarget;
  /** Typed digits in pesos ("50000" or "50.5"); empty when just started. */
  digits: string;
}

export interface UsePaymentKeyboardDeps {
  isCompleting: boolean;
  canConfirm: boolean;
  /** Confirm the payment (already gated by canConfirm/isCompleting/credit). */
  onConfirm: () => void;
  /** Add a new payment method row. */
  onAddMethod: () => void;
  /** Remove a payment row. */
  onRemoveMethod: (id: string) => void;
  /** Commit an amount to a payment row (cents; caller applies non-cash cap). */
  onAmountChange: (id: string, amountCents: number) => void;
  /** Commit the cash-received amount (cents). */
  onCashReceivedChange: (amountCents: number) => void;
  /** Authorize an electronic payment row. */
  onAuthorize: (method: PaymentMethodEntry) => Promise<void>;
}

export interface UsePaymentKeyboardReturn {
  /** The row or field the keyboard currently acts on. */
  selection: PaymentTarget | null;
  /** In-progress money entry, or null. */
  buffer: PaymentBuffer | null;
  /** Whether the cash "received" field is part of the navigation. */
  showCashReceived: boolean;
  /** Move the selection up/down; starting fresh selects the first row. */
  moveSelection: (delta: 1 | -1) => void;
  /** Commit the current buffer (Enter). */
  commitBuffer: () => void;
  /** Discard the current buffer (Escape). */
  cancelBuffer: () => void;
  /** Remove the selected row when more than one exists. */
  removeSelectedRow: () => void;
}

/**
 * Parse typed pesos into whole cents, tolerant of Colombian number formats:
 * `.` is the thousands separator and `,` the decimal separator (1.200,50),
 * but cashiers also type bare decimals (50.5) and plain integers (50000).
 *
 * Rule: strip every separator except the last one; the last separator is a
 * decimal point only when 1–2 digits follow it, otherwise it is thousands
 * grouping and is removed too.
 *
 * Examples: "50000" → 5_000_000 · "1.200" → 120_000 · "50.5" → 5_050 ·
 * "1.200,50" → 120_050 · "1,200" → 120_000
 */
export const parsePesosToCents = (raw: string): number => {
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  const lastSeparator = Math.max(lastDot, lastComma);

  let normalized: string;
  if (lastSeparator === -1) {
    normalized = raw.replace(/[.,]/g, "");
  } else {
    const after = raw.slice(lastSeparator + 1);
    const isDecimal = after.length >= 1 && after.length <= 2;
    const body = raw.slice(0, lastSeparator).replace(/[.,]/g, "");
    normalized = isDecimal ? `${body}.${after}` : `${body}${after}`;
  }

  const parsed = Number.parseFloat(normalized);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePaymentKeyboard({
  isCompleting,
  canConfirm,
  onConfirm,
  onAddMethod,
  onRemoveMethod,
  onAmountChange,
  onCashReceivedChange,
  onAuthorize,
}: UsePaymentKeyboardDeps): UsePaymentKeyboardReturn {
  const activeScreen = useAppSelector(selectActiveScreen);
  const methods = useAppSelector(selectPaymentMethods);
  const cashOwed = useAppSelector(selectCashOwedCents);
  const showCashReceived = cashOwed > 0;

  const [selection, setSelection] = useState<PaymentTarget | null>(null);
  const [buffer, setBuffer] = useState<PaymentBuffer | null>(null);

  // Auto-select the first row when the screen mounts so the cashier can
  // start typing an amount immediately.
  useEffect(() => {
    if (selection === null && methods.length > 0) {
      setSelection({ kind: "row", rowId: methods[0].id });
    }
  }, [selection, methods]);

  const moveSelection = useCallback(
    (delta: 1 | -1) => {
      // An in-progress buffer belongs to the row it started on; moving the
      // selection discards it so digits never land on the wrong row.
      setBuffer(null);

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

  const startBuffer = useCallback(
    (firstDigit: string) => {
      if (selection === null) {
        // Typing with no selection starts on the first row.
        if (methods.length === 0) return;
        const first: PaymentTarget = { kind: "row", rowId: methods[0].id };
        setSelection(first);
        setBuffer({ target: first, digits: firstDigit });
        return;
      }
      setBuffer({ target: selection, digits: firstDigit });
    },
    [selection, methods],
  );

  const appendDigit = useCallback(
    (digit: string) => {
      if (!buffer) {
        startBuffer(digit);
        return;
      }
      // A fresh digit sequence replaces the buffer entirely — typing a
      // new amount after committing a previous one must not append.
      setBuffer({ ...buffer, digits: buffer.digits + digit });
    },
    [buffer, startBuffer],
  );

  const commitBuffer = useCallback(() => {
    if (!buffer) return;
    const cents = parsePesosToCents(buffer.digits);
    if (buffer.target.kind === "row") {
      onAmountChange(buffer.target.rowId, cents);
    } else {
      onCashReceivedChange(cents);
    }
    setBuffer(null);
  }, [buffer, onAmountChange, onCashReceivedChange]);

  const cancelBuffer = useCallback(() => {
    setBuffer(null);
  }, []);

  const removeSelectedRow = useCallback(() => {
    if (selection?.kind !== "row") return;
    onRemoveMethod(selection.rowId);
    setSelection(null);
  }, [selection, onRemoveMethod]);

  // -- Global keydown (capture phase) -------------------------------------

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.defaultPrevented) return;
      if (activeScreen !== "payment") return;
      if (isCompleting) return;

      const meta = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase() ?? "";
      const isInInput =
        tagName === "input" ||
        tagName === "textarea" ||
        target?.isContentEditable === true;

      // Confirm — same muscle memory as the sales screen; works in inputs.
      if (event.key === "F9" || (meta && event.key === "Enter")) {
        if (!canConfirm) return;
        event.preventDefault();
        event.stopPropagation();
        onConfirm();
        return;
      }

      if (isInInput) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveSelection(event.key === "ArrowDown" ? 1 : -1);
        return;
      }

      if (event.key === "Escape") {
        if (buffer) {
          event.preventDefault();
          event.stopPropagation();
          cancelBuffer();
        }
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        if (buffer) {
          setBuffer({ ...buffer, digits: buffer.digits.slice(0, -1) });
        } else {
          removeSelectedRow();
        }
        return;
      }

      // "+" (or Shift+=) adds a payment method row.
      if (event.key === "+" || (event.shiftKey && event.key === "=")) {
        event.preventDefault();
        event.stopPropagation();
        onAddMethod();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (buffer) {
          commitBuffer();
        } else if (selection?.kind === "row") {
          const row = methods.find((m) => m.id === selection.rowId);
          // Enter on an empty electronic row authorizes it.
          if (row && !row.isCash && row.category !== "CREDIT") {
            void onAuthorize(row);
          }
        }
        return;
      }

      // Money entry: digits plus dot/comma separators (both may appear —
      // "1.200,50" is valid Colombian format; the parser resolves them).
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        appendDigit(event.key);
        return;
      }
      if (event.key === "." || event.key === ",") {
        const hasDot = buffer?.digits.includes(".") ?? false;
        const hasComma = buffer?.digits.includes(",") ?? false;
        if (buffer && !(hasDot && hasComma)) {
          event.preventDefault();
          event.stopPropagation();
          appendDigit(event.key);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    activeScreen,
    isCompleting,
    canConfirm,
    buffer,
    selection,
    methods,
    moveSelection,
    cancelBuffer,
    commitBuffer,
    removeSelectedRow,
    appendDigit,
    onConfirm,
    onAddMethod,
    onAuthorize,
  ]);

  return useMemo(
    () => ({
      selection,
      buffer,
      showCashReceived,
      moveSelection,
      commitBuffer,
      cancelBuffer,
      removeSelectedRow,
    }),
    [selection, buffer, showCashReceived, moveSelection, commitBuffer, cancelBuffer, removeSelectedRow],
  );
}