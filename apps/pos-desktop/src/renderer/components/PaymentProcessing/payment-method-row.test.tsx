/**
 * Component tests for PaymentMethodRow.
 *
 * Covers the Enter-per-input semantics the payment keyboard hook delegates
 * to the row: Enter on an electronic row's amount authorizes it (when an
 * amount is typed), Enter on a cash row moves the keyboard selection to the
 * "received" field (when change is due).
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PaymentMethodRow } from "./payment-method-row";
import {
  AuthorizationStatus,
  type PaymentMethodEntry,
  type PaymentMethodOption,
} from "@/store/slices/payment-types";

// The shared picker reads the active methods from its own hook even when
// the parent passes a preloaded list — stub it to a fixed option set.
const options: PaymentMethodOption[] = [
  { id: "pm-cash", category: "CASH", name: "Efectivo", isCash: true },
  {
    id: "pm-debit",
    category: "DEBIT_CARD",
    name: "Tarjeta Débito",
    isCash: false,
  },
];

vi.mock("@/hooks/use-active-payment-methods", () => ({
  useActivePaymentMethods: () => ({
    methods: options,
    loading: false,
    error: null,
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeMethod = (
  overrides: Partial<PaymentMethodEntry> = {},
): PaymentMethodEntry => ({
  id: "pm-1",
  paymentMethodId: "pm-debit",
  category: "DEBIT_CARD",
  name: "Tarjeta Débito",
  isCash: false,
  amountCents: 0,
  authorizationStatus: AuthorizationStatus.IDLE,
  ...overrides,
});

interface RowCallbacks {
  onMethodChange?: (id: string, method: PaymentMethodOption) => void;
  onAmountChange?: (id: string, amountCents: number) => void;
  onRemove?: (id: string) => void;
  onAuthorize?: (method: PaymentMethodEntry) => void;
  onMoveToReceived?: () => void;
}

const renderRow = (
  method: PaymentMethodEntry,
  callbacks: RowCallbacks = {},
  props: { showCashReceived?: boolean } = {},
) => {
  render(
    <PaymentMethodRow
      index={0}
      method={method}
      methods={options}
      isOnlyMethod
      disabled={false}
      showCashReceived={props.showCashReceived}
      onMethodChange={callbacks.onMethodChange ?? vi.fn()}
      onAmountChange={callbacks.onAmountChange ?? vi.fn()}
      onRemove={callbacks.onRemove ?? vi.fn()}
      onAuthorize={callbacks.onAuthorize ?? vi.fn()}
      onMoveToReceived={callbacks.onMoveToReceived ?? vi.fn()}
    />,
  );
  return screen.getByLabelText(/Valor|Amount/) as HTMLInputElement;
};

/** Dispatch a real keydown on the amount input so preventDefault is observable. */
const pressEnterOn = (input: HTMLInputElement): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  act(() => input.dispatchEvent(event));
  return event;
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("PaymentMethodRow", () => {
  it("authorizes an electronic row with an amount on Enter and prevents default", () => {
    const method = makeMethod({ amountCents: 100_000 });
    const onAuthorize = vi.fn();
    const input = renderRow(method, { onAuthorize });

    const event = pressEnterOn(input);

    expect(onAuthorize).toHaveBeenCalledWith(method);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not authorize an electronic row without an amount on Enter", () => {
    const method = makeMethod({ amountCents: 0 });
    const onAuthorize = vi.fn();
    const input = renderRow(method, { onAuthorize });

    const event = pressEnterOn(input);

    expect(onAuthorize).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("moves to the received field on a cash row with change due on Enter", () => {
    const method = makeMethod({
      paymentMethodId: "pm-cash",
      category: "CASH",
      name: "Efectivo",
      isCash: true,
      amountCents: 100_000,
    });
    const onMoveToReceived = vi.fn();
    const input = renderRow(
      method,
      { onMoveToReceived },
      { showCashReceived: true },
    );

    const event = pressEnterOn(input);

    expect(onMoveToReceived).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("does nothing on a cash row when no change is due on Enter", () => {
    const method = makeMethod({
      paymentMethodId: "pm-cash",
      category: "CASH",
      name: "Efectivo",
      isCash: true,
      amountCents: 100_000,
    });
    const onMoveToReceived = vi.fn();
    const onAuthorize = vi.fn();
    const input = renderRow(method, { onMoveToReceived, onAuthorize });

    const event = pressEnterOn(input);

    expect(onMoveToReceived).not.toHaveBeenCalled();
    expect(onAuthorize).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores non-Enter keys on the amount input", () => {
    const method = makeMethod({ amountCents: 100_000 });
    const onAuthorize = vi.fn();
    const input = renderRow(method, { onAuthorize });

    const event = new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
    });
    act(() => input.dispatchEvent(event));

    expect(onAuthorize).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});