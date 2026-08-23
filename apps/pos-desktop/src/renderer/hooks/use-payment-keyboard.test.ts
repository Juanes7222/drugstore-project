/**
 * Unit tests for usePaymentKeyboard.
 *
 * The hook's payment-method/cash/screen reads go through Redux selectors,
 * so the Redux hooks are mocked against a mutable state object while the
 * real selectors run against it. Keydown events are dispatched on window
 * (or on a real input element for the "while typing" cases).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  AuthorizationStatus,
  type PaymentMethodEntry,
  type PaymentState,
} from "@/store/slices/payment-types";
import type { PosScreen } from "@/store/slices/ui-types";
import {
  usePaymentKeyboard,
  type UsePaymentKeyboardDeps,
} from "./use-payment-keyboard";

// ---------------------------------------------------------------------------
// Hoisted mocks for Redux hooks
// ---------------------------------------------------------------------------

let mockPaymentState: PaymentState = {
  methods: [],
  cashReceivedCents: 0,
};
let mockUiState: { activeScreen: PosScreen } = { activeScreen: "payment" };

interface MockRoot {
  payment: PaymentState;
  ui: { activeScreen: PosScreen };
}

vi.mock("@/store/hooks", () => ({
  // Invoke the real selectors against a mutable state so each selector
  // returns its own slice of state.
  useAppSelector: (selector: unknown) =>
    (selector as (state: MockRoot) => unknown)({
      payment: mockPaymentState,
      ui: mockUiState,
    }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeMethod = (
  overrides: Partial<PaymentMethodEntry> = {},
): PaymentMethodEntry => ({
  id: "pm-1",
  paymentMethodId: "pm-cash",
  category: "CASH",
  name: "Efectivo",
  isCash: true,
  amountCents: 0,
  authorizationStatus: AuthorizationStatus.IDLE,
  ...overrides,
});

const makeDeps = (
  overrides: Partial<UsePaymentKeyboardDeps> = {},
): UsePaymentKeyboardDeps => ({
  isCompleting: false,
  canConfirm: true,
  onConfirm: vi.fn(),
  onAddMethod: vi.fn(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const setPaymentState = (state: PaymentState): void => {
  // Fresh object per call so the memoized selectors re-evaluate.
  mockPaymentState = {
    methods: state.methods.map((method) => ({ ...method })),
    cashReceivedCents: state.cashReceivedCents,
  };
};

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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("usePaymentKeyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPaymentState({ methods: [], cashReceivedCents: 0 });
    mockUiState = { activeScreen: "payment" };
  });

  afterEach(() => {
    mockUiState = { activeScreen: "payment" };
  });

  describe("mount", () => {
    it("auto-selects the first row when methods exist", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));

      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });
    });

    it("keeps the selection null when no methods exist", () => {
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));

      expect(result.current.selection).toBeNull();
    });

    it("exposes showCashReceived when a cash method carries an amount", () => {
      setPaymentState({
        methods: [makeMethod({ amountCents: 10_000 })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));

      expect(result.current.showCashReceived).toBe(true);
    });

    it("hides the received field when no cash amount is owed", () => {
      setPaymentState({
        methods: [makeMethod({ amountCents: 0 })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));

      expect(result.current.showCashReceived).toBe(false);
    });
  });

  describe("selection movement (arrows)", () => {
    it("a first press from a cleared selection lands on the first row", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));

      // Move away from the auto-selected row, then clear via Escape. The
      // auto-select effect restores the first row, so the next press moves
      // down from there as if the navigation restarted.
      pressKey({ key: "ArrowDown" });
      pressKey({ key: "Escape" });
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });

      pressKey({ key: "ArrowDown" });
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-2",
      });
    });

    it("ArrowDown moves to the next row and clamps at the last one", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));

      pressKey({ key: "ArrowDown" });
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-2",
      });

      pressKey({ key: "ArrowDown" });
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-2",
      });
    });

    it("ArrowUp moves to the previous row and clamps at the first one", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));

      pressKey({ key: "ArrowDown" });
      pressKey({ key: "ArrowUp" });
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });

      pressKey({ key: "ArrowUp" });
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });
    });

    it("reaches the received field as the last stop when cash is owed", () => {
      setPaymentState({
        methods: [
          makeMethod({ id: "pm-1", amountCents: 6_616_400 }),
          makeMethod({
            id: "pm-2",
            paymentMethodId: "pm-debit",
            category: "DEBIT_CARD",
            name: "Tarjeta",
            isCash: false,
          }),
        ],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));

      pressKey({ key: "ArrowDown" });
      pressKey({ key: "ArrowDown" });
      expect(result.current.selection).toEqual({ kind: "received" });

      // Clamped: ArrowDown on the received field stays there.
      pressKey({ key: "ArrowDown" });
      expect(result.current.selection).toEqual({ kind: "received" });
    });

    it("never stops at the received field when no cash is owed", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));

      pressKey({ key: "ArrowDown" });
      pressKey({ key: "ArrowDown" });
      pressKey({ key: "ArrowDown" });

      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-2",
      });
    });

    it("ArrowUp from the received field returns to the last row", () => {
      setPaymentState({
        methods: [
          makeMethod({ id: "pm-1", amountCents: 6_616_400 }),
          makeMethod({
            id: "pm-2",
            paymentMethodId: "pm-debit",
            category: "DEBIT_CARD",
            name: "Tarjeta",
            isCash: false,
          }),
        ],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));

      pressKey({ key: "ArrowDown" });
      pressKey({ key: "ArrowDown" });
      pressKey({ key: "ArrowUp" });

      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-2",
      });
    });

    it("a stale selection snaps back into range when methods shrink", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const { result, rerender } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      pressKey({ key: "ArrowDown" });
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-2",
      });

      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      rerender();

      pressKey({ key: "ArrowUp" });
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });
    });

    it("arrows are intercepted while an input is focused and still move the selection", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));
      const bubble = listenForBubble();

      const event = pressKeyInInput({ key: "ArrowDown" });

      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-2",
      });
      expect(event.defaultPrevented).toBe(true);
      expect(bubble.fired()).toBe(false);
    });

    it("leaves the selection null and still stops the event when there are no methods", () => {
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));

      const event = pressKey({ key: "ArrowDown" });

      expect(result.current.selection).toBeNull();
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe("Escape", () => {
    it("clears the selection, prevents default, and stops the bubble", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));
      const bubble = listenForBubble();

      pressKey({ key: "ArrowDown" });
      const event = pressKey({ key: "Escape" });

      // The auto-select effect immediately restores the first row, so the
      // observable outcome is a restart of the navigation at row 0.
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });
      expect(event.defaultPrevented).toBe(true);
      expect(bubble.fired()).toBe(false);
    });

    it("is intercepted even while an input is focused", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() => usePaymentKeyboard(makeDeps()));

      pressKey({ key: "ArrowDown" });
      const event = pressKeyInInput({ key: "Escape" });

      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe("confirm keys (F9, Ctrl+Enter)", () => {
    it("F9 calls onConfirm and prevents default", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      const event = pressKey({ key: "F9" });

      expect(deps.onConfirm).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });

    it("Ctrl+Enter calls onConfirm", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "Enter", ctrlKey: true });

      expect(deps.onConfirm).toHaveBeenCalledOnce();
    });

    it("F9 fires while the focus is inside an input", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKeyInInput({ key: "F9" });

      expect(deps.onConfirm).toHaveBeenCalledOnce();
    });

    it("F9 is skipped when the payment cannot be confirmed", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps({ canConfirm: false });
      renderHook(() => usePaymentKeyboard(deps));

      const event = pressKey({ key: "F9" });

      expect(deps.onConfirm).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it("Ctrl+Enter is skipped when the payment cannot be confirmed", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps({ canConfirm: false });
      renderHook(() => usePaymentKeyboard(deps));

      const event = pressKey({ key: "Enter", ctrlKey: true });

      expect(deps.onConfirm).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it("F9 is skipped while the payment is completing", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps({ isCompleting: true });
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "F9" });

      expect(deps.onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("adding methods", () => {
    it("+ calls onAddMethod and prevents default", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      const event = pressKey({ key: "+" });

      expect(deps.onAddMethod).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });

    it("Shift+= calls onAddMethod", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "=", shiftKey: true });

      expect(deps.onAddMethod).toHaveBeenCalledOnce();
    });

    it("+ fires while the focus is inside an input", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      const event = pressKeyInInput({ key: "+" });

      expect(deps.onAddMethod).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe("non-intercepted keys", () => {
    it("digits are not intercepted", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      const { result } = renderHook(() => usePaymentKeyboard(deps));

      const event = pressKey({ key: "5" });

      expect(event.defaultPrevented).toBe(false);
      expect(deps.onConfirm).not.toHaveBeenCalled();
      expect(deps.onAddMethod).not.toHaveBeenCalled();
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });
    });

    it("Enter is not intercepted", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      const event = pressKey({ key: "Enter" });

      expect(event.defaultPrevented).toBe(false);
      expect(deps.onConfirm).not.toHaveBeenCalled();
      expect(deps.onAddMethod).not.toHaveBeenCalled();
    });

    it("Backspace is not intercepted", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      const event = pressKey({ key: "Backspace" });

      expect(event.defaultPrevented).toBe(false);
      expect(deps.onConfirm).not.toHaveBeenCalled();
      expect(deps.onAddMethod).not.toHaveBeenCalled();
    });

    it("Enter reaches an input untouched", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      const event = pressKeyInInput({ key: "Enter" });

      expect(event.defaultPrevented).toBe(false);
      expect(deps.onConfirm).not.toHaveBeenCalled();
      expect(deps.onAddMethod).not.toHaveBeenCalled();
    });
  });

  describe("gating", () => {
    it("does nothing when the active screen is not payment", () => {
      mockUiState = { activeScreen: "sales" };
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      const { result } = renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "F9" });
      pressKey({ key: "ArrowDown" });
      pressKey({ key: "Escape" });
      pressKey({ key: "+" });
      pressKey({ key: "5" });

      expect(deps.onConfirm).not.toHaveBeenCalled();
      expect(deps.onAddMethod).not.toHaveBeenCalled();
      // The mount auto-select is not screen-gated; only the keydown
      // listener is, so the selection stays on the first row untouched.
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });
    });

    it("ignores every key while the payment is completing", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps({ isCompleting: true });
      const { result } = renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "ArrowDown" });
      pressKey({ key: "Escape" });
      pressKey({ key: "+" });
      pressKey({ key: "F9" });

      expect(deps.onConfirm).not.toHaveBeenCalled();
      expect(deps.onAddMethod).not.toHaveBeenCalled();
      // The auto-select still ran on mount — the listener is what is gated.
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });
    });

    it("does nothing when the event was already prevented", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));
      const event = new KeyboardEvent("keydown", {
        key: "F9",
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();

      act(() => window.dispatchEvent(event));

      expect(deps.onConfirm).not.toHaveBeenCalled();
    });

    it("does nothing while an IME composition is in progress", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "F9", isComposing: true });

      expect(deps.onConfirm).not.toHaveBeenCalled();
    });
  });
});