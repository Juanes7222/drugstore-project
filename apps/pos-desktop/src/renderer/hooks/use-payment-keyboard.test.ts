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
  parsePesosToCents,
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
  onRemoveMethod: vi.fn(),
  onAmountChange: vi.fn(),
  onCashReceivedChange: vi.fn(),
  onAuthorize: vi.fn().mockResolvedValue(undefined),
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

  describe("parsePesosToCents", () => {
    it("converts whole pesos to cents", () => {
      expect(parsePesosToCents("50000")).toBe(5_000_000);
    });

    it("converts a dot decimal to cents", () => {
      expect(parsePesosToCents("50.5")).toBe(5_050);
    });

    it("treats a dot with three trailing digits as thousands grouping", () => {
      expect(parsePesosToCents("1.200")).toBe(120_000);
    });

    it("treats a comma with three trailing digits as thousands grouping", () => {
      expect(parsePesosToCents("1,200")).toBe(120_000);
    });

    it("parses Colombian format with both separators", () => {
      expect(parsePesosToCents("1.200,50")).toBe(120_050);
    });

    it("treats a comma with one trailing digit as the decimal separator", () => {
      expect(parsePesosToCents("50,5")).toBe(5_050);
    });

    it("returns 0 for a non-numeric string", () => {
      expect(parsePesosToCents("abc")).toBe(0);
    });

    it("returns 0 for an empty string", () => {
      expect(parsePesosToCents("")).toBe(0);
    });

    it("returns 0 for a negative amount", () => {
      expect(parsePesosToCents("-5")).toBe(0);
    });
  });

  describe("mount", () => {
    it("auto-selects the first row when methods exist", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });
    });

    it("keeps the selection null when no methods exist", () => {
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      expect(result.current.selection).toBeNull();
    });

    it("exposes showCashReceived only when a cash method has an amount", () => {
      setPaymentState({
        methods: [makeMethod({ amountCents: 10_000 })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      expect(result.current.showCashReceived).toBe(true);
    });

    it("hides the received field when no cash amount is owed", () => {
      setPaymentState({
        methods: [makeMethod({ amountCents: 0 })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      expect(result.current.showCashReceived).toBe(false);
    });
  });

  describe("selection movement (arrows)", () => {
    it("ArrowDown moves to the next row and clamps at the last one", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

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
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

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
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

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
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

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
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      pressKey({ key: "ArrowDown" });
      pressKey({ key: "ArrowDown" });
      pressKey({ key: "ArrowUp" });

      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-2",
      });
    });

    it("moving discards an in-progress buffer", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      pressKey({ key: "5" });
      expect(result.current.buffer).not.toBeNull();

      pressKey({ key: "ArrowDown" });

      expect(result.current.buffer).toBeNull();
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-2",
      });
    });

    it("leaves the selection null and still stops the event when there are no methods", () => {
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      const event = pressKey({ key: "ArrowDown" });

      expect(result.current.selection).toBeNull();
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe("digit entry", () => {
    it("a digit starts a buffer on the selected row", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      const event = pressKey({ key: "5" });

      expect(result.current.buffer).toEqual({
        target: { kind: "row", rowId: "pm-1" },
        digits: "5",
      });
      expect(event.defaultPrevented).toBe(true);
    });

    it("digits append to the current buffer", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      pressKey({ key: "5" });
      pressKey({ key: "0" });

      expect(result.current.buffer?.digits).toBe("50");
    });

    it("a digit after a commit starts a fresh buffer", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      const { result } = renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "5" });
      pressKey({ key: "Enter" });
      pressKey({ key: "7" });
      pressKey({ key: "0" });

      expect(result.current.buffer?.digits).toBe("70");
      expect(deps.onAmountChange).toHaveBeenCalledTimes(1);
    });

    it("a digit with no methods starts no buffer", () => {
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      const event = pressKey({ key: "5" });

      expect(result.current.buffer).toBeNull();
      expect(event.defaultPrevented).toBe(true);
    });

    it("starts a buffer targeting the received field when selected", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1", amountCents: 10_000 })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      pressKey({ key: "ArrowDown" });
      pressKey({ key: "1" });

      expect(result.current.buffer).toEqual({
        target: { kind: "received" },
        digits: "1",
      });
    });

    it("accepts a single dot decimal separator", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      pressKey({ key: "5" });
      pressKey({ key: "." });
      pressKey({ key: "0" });

      expect(result.current.buffer?.digits).toBe("5.0");
    });

    it("accepts a single comma separator", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      pressKey({ key: "5" });
      pressKey({ key: "," });

      expect(result.current.buffer?.digits).toBe("5,");
    });

    it("accepts both separators so Colombian format is typable", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      pressKey({ key: "1" });
      pressKey({ key: "." });
      pressKey({ key: "2" });
      pressKey({ key: "0" });
      pressKey({ key: "0" });
      pressKey({ key: "," });
      pressKey({ key: "5" });
      pressKey({ key: "0" });

      expect(result.current.buffer?.digits).toBe("1.200,50");
    });

    it("appends a repeated same-kind separator until both kinds are present", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      pressKey({ key: "5" });
      pressKey({ key: "." });
      const event = pressKey({ key: "." });

      expect(result.current.buffer?.digits).toBe("5..");
      expect(event.defaultPrevented).toBe(true);
    });

    it("rejects a separator once both dot and comma are in the buffer", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      pressKey({ key: "5" });
      pressKey({ key: "." });
      pressKey({ key: "," });
      const event = pressKey({ key: "." });

      expect(result.current.buffer?.digits).toBe("5.,");
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("Enter", () => {
    it("commits a row buffer via onAmountChange with the amount in cents", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      const { result } = renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "5" });
      pressKey({ key: "0" });
      const event = pressKey({ key: "Enter" });

      expect(deps.onAmountChange).toHaveBeenCalledWith("pm-1", 5_000);
      expect(result.current.buffer).toBeNull();
      expect(event.defaultPrevented).toBe(true);
    });

    it("commits a decimal amount to cents", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "5" });
      pressKey({ key: "." });
      pressKey({ key: "5" });
      pressKey({ key: "Enter" });

      expect(deps.onAmountChange).toHaveBeenCalledWith("pm-1", 550);
    });

    it("commits a comma-decimal amount to cents", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "5" });
      pressKey({ key: "," });
      pressKey({ key: "5" });
      pressKey({ key: "Enter" });

      expect(deps.onAmountChange).toHaveBeenCalledWith("pm-1", 550);
    });

    it("commits Colombian-format amounts to cents", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "1" });
      pressKey({ key: "." });
      pressKey({ key: "2" });
      pressKey({ key: "0" });
      pressKey({ key: "0" });
      pressKey({ key: "," });
      pressKey({ key: "5" });
      pressKey({ key: "0" });
      pressKey({ key: "Enter" });

      expect(deps.onAmountChange).toHaveBeenCalledWith("pm-1", 120_050);
    });

    it("commits the received buffer via onCashReceivedChange", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1", amountCents: 10_000 })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "ArrowDown" });
      pressKey({ key: "1" });
      pressKey({ key: "0" });
      pressKey({ key: "0" });
      pressKey({ key: "Enter" });

      expect(deps.onCashReceivedChange).toHaveBeenCalledWith(10_000);
    });

    it("authorizes an electronic row when the buffer is empty", () => {
      const debit = makeMethod({
        id: "pm-2",
        paymentMethodId: "pm-debit",
        category: "DEBIT_CARD",
        name: "Tarjeta Débito",
        isCash: false,
      });
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), debit],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "ArrowDown" });
      pressKey({ key: "Enter" });

      expect(deps.onAuthorize).toHaveBeenCalledWith(debit);
    });

    it("does not authorize a credit row", () => {
      setPaymentState({
        methods: [
          makeMethod({ id: "pm-1" }),
          makeMethod({
            id: "pm-2",
            paymentMethodId: "pm-credit",
            category: "CREDIT",
            name: "Crédito",
            isCash: false,
          }),
        ],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "ArrowDown" });
      pressKey({ key: "Enter" });

      expect(deps.onAuthorize).not.toHaveBeenCalled();
    });

    it("does nothing on a cash row with an empty buffer", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "Enter" });

      expect(deps.onAmountChange).not.toHaveBeenCalled();
      expect(deps.onAuthorize).not.toHaveBeenCalled();
    });

    it("does nothing with an empty buffer on the received field", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1", amountCents: 10_000 })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "ArrowDown" });
      pressKey({ key: "Enter" });

      expect(deps.onCashReceivedChange).not.toHaveBeenCalled();
    });
  });

  describe("Backspace", () => {
    it("deletes the last digit of the buffer", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      pressKey({ key: "5" });
      pressKey({ key: "3" });
      pressKey({ key: "Backspace" });

      expect(result.current.buffer?.digits).toBe("5");
    });

    it("deletes down to an empty buffer and keeps typing", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );

      pressKey({ key: "5" });
      pressKey({ key: "Backspace" });

      expect(result.current.buffer?.digits).toBe("");

      pressKey({ key: "0" });

      expect(result.current.buffer?.digits).toBe("0");
    });

    it("removes the selected row when there is no buffer", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      const { result } = renderHook(() => usePaymentKeyboard(deps));

      const event = pressKey({ key: "Backspace" });

      expect(deps.onRemoveMethod).toHaveBeenCalledWith("pm-1");
      // The selection clears and the auto-select effect re-selects row 0.
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });
      expect(event.defaultPrevented).toBe(true);
    });

    it("does nothing when the selection is the received field", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1", amountCents: 10_000 })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "ArrowDown" });
      const event = pressKey({ key: "Backspace" });

      expect(deps.onRemoveMethod).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe("Escape", () => {
    it("cancels the buffer and stops the event", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );
      const bubble = listenForBubble();

      pressKey({ key: "5" });
      const event = pressKey({ key: "Escape" });

      expect(result.current.buffer).toBeNull();
      expect(event.defaultPrevented).toBe(true);
      expect(bubble.fired()).toBe(false);
    });

    it("without a buffer does nothing and lets the event bubble", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const { result } = renderHook(() =>
        usePaymentKeyboard(makeDeps()),
      );
      const bubble = listenForBubble();

      const event = pressKey({ key: "Escape" });

      expect(result.current.buffer).toBeNull();
      expect(event.defaultPrevented).toBe(false);
      expect(bubble.fired()).toBe(true);
    });
  });

  describe("adding methods", () => {
    it("+ calls onAddMethod", () => {
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
  });

  describe("confirm keys (F9, Ctrl+Enter)", () => {
    it("F9 calls onConfirm", () => {
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
      pressKey({ key: "5" });
      pressKey({ key: "Enter" });
      pressKey({ key: "+" });

      expect(deps.onConfirm).not.toHaveBeenCalled();
      expect(deps.onAddMethod).not.toHaveBeenCalled();
      expect(deps.onAmountChange).not.toHaveBeenCalled();
      expect(result.current.buffer).toBeNull();
      // The mount auto-select is not screen-gated; only the keydown
      // listener is, so the selection stays on the first row untouched.
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });
    });

    it("ignores every key while the payment is completing", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps({ isCompleting: true });
      const { result } = renderHook(() => usePaymentKeyboard(deps));

      pressKey({ key: "5" });
      pressKey({ key: "Backspace" });

      expect(result.current.buffer).toBeNull();
      expect(deps.onRemoveMethod).not.toHaveBeenCalled();
    });

    it("skips non-confirm keys when the target is an input", () => {
      setPaymentState({
        methods: [makeMethod({ id: "pm-1" }), makeMethod({ id: "pm-2" })],
        cashReceivedCents: 0,
      });
      const deps = makeDeps();
      const { result } = renderHook(() => usePaymentKeyboard(deps));

      pressKeyInInput({ key: "5" });
      pressKeyInInput({ key: "ArrowDown" });
      pressKeyInInput({ key: "Backspace" });
      pressKeyInInput({ key: "+" });

      expect(result.current.buffer).toBeNull();
      expect(result.current.selection).toEqual({
        kind: "row",
        rowId: "pm-1",
      });
      expect(deps.onRemoveMethod).not.toHaveBeenCalled();
      expect(deps.onAddMethod).not.toHaveBeenCalled();
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