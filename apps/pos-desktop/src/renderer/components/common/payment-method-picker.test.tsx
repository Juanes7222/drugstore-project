/**
 * Component tests for the shared PaymentMethodPicker.
 *
 * The picker is the single payment-method selector used by sales, fiscal
 * adjustments, and returns. Its options come from the local DB (DIAN
 * categories) — either via the `methods` prop (parent already loaded them)
 * or by loading them itself through useActivePaymentMethods.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PaymentMethodPicker } from "./payment-method-picker";
import type { PaymentMethodOption } from "@/store/slices/payment-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// DB-backed active payment methods — mirror the local PaymentMethod rows.
// Both the data and the hook mock live in vi.hoisted because the vi.mock
// factory below runs before the module body initializes regular consts.
const { activePaymentMethods, mockUseActivePaymentMethods } = vi.hoisted(() => {
  const methods = [
    { id: "pm-cash", category: "CASH", name: "Efectivo", isCash: true },
    {
      id: "pm-debit",
      category: "DEBIT_CARD",
      name: "Tarjeta Débito",
      isCash: false,
    },
    {
      id: "pm-transfer",
      category: "BANK_TRANSFER",
      name: "Transferencia Bancaria",
      isCash: false,
    },
  ] as PaymentMethodOption[];

  return {
    activePaymentMethods: methods,
    mockUseActivePaymentMethods: vi.fn().mockReturnValue({
      methods,
      loading: false,
    }),
  };
});

vi.mock("@/hooks/use-active-payment-methods", () => ({
  useActivePaymentMethods: () => mockUseActivePaymentMethods(),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("PaymentMethodPicker", () => {
  it("renders the passed methods as select options with the DB id as value", () => {
    render(
      <PaymentMethodPicker
        value="pm-cash"
        methods={activePaymentMethods}
        onChange={vi.fn()}
        ariaLabel="Método de pago"
      />,
    );

    const select = screen.getByRole("combobox", {
      name: "Método de pago",
    }) as HTMLSelectElement;

    expect(select).toHaveValue("pm-cash");
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "pm-cash",
      "pm-debit",
      "pm-transfer",
    ]);
    expect(screen.getByRole("option", { name: "Efectivo" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Tarjeta Débito" }),
    ).toBeInTheDocument();
  });

  it("calls onChange with the full DB method when the selection changes", () => {
    const onChange = vi.fn();
    render(
      <PaymentMethodPicker
        value="pm-cash"
        methods={activePaymentMethods}
        onChange={onChange}
        ariaLabel="Método de pago"
      />,
    );

    const select = screen.getByRole("combobox", { name: "Método de pago" });
    fireEvent.change(select, { target: { value: "pm-debit" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "pm-debit",
        category: "DEBIT_CARD",
        name: "Tarjeta Débito",
        isCash: false,
      }),
    );
  });

  it("loads the methods itself via the hook when no methods prop is passed", () => {
    render(
      <PaymentMethodPicker
        value="pm-cash"
        onChange={vi.fn()}
        ariaLabel="Método de pago"
      />,
    );

    const select = screen.getByRole("combobox", {
      name: "Método de pago",
    }) as HTMLSelectElement;
    expect(select.options).toHaveLength(3);
    expect(mockUseActivePaymentMethods).toHaveBeenCalled();
  });

  it("renders an empty placeholder option when includePlaceholder is set", () => {
    render(
      <PaymentMethodPicker
        value=""
        methods={activePaymentMethods}
        onChange={vi.fn()}
        ariaLabel="Método de pago"
        includePlaceholder
      />,
    );

    const select = screen.getByRole("combobox", {
      name: "Método de pago",
    }) as HTMLSelectElement;

    // The placeholder lets the cashier unselect a method.
    expect(select.options[0]?.value).toBe("");
    expect(select).toHaveValue("");
  });

  it("renders an empty select when the method list is empty", () => {
    render(
      <PaymentMethodPicker
        value=""
        methods={[]}
        onChange={vi.fn()}
        ariaLabel="Método de pago"
      />,
    );

    const select = screen.getByRole("combobox", {
      name: "Método de pago",
    }) as HTMLSelectElement;
    expect(select.options).toHaveLength(0);
  });

  it("does not call onChange when the selection does not match a known method", () => {
    const onChange = vi.fn();
    render(
      <PaymentMethodPicker
        value="pm-cash"
        methods={activePaymentMethods}
        onChange={onChange}
        ariaLabel="Método de pago"
      />,
    );

    const select = screen.getByRole("combobox", { name: "Método de pago" });
    // An unknown value (no matching option) must not fire onChange.
    fireEvent.change(select, { target: { value: "unknown-method" } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables the select when disabled is set", () => {
    render(
      <PaymentMethodPicker
        value="pm-cash"
        methods={activePaymentMethods}
        onChange={vi.fn()}
        ariaLabel="Método de pago"
        disabled
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Método de pago" }),
    ).toBeDisabled();
  });

  it("uses the provided id on the select element", () => {
    render(
      <PaymentMethodPicker
        id="custom-picker"
        value="pm-cash"
        methods={activePaymentMethods}
        onChange={vi.fn()}
        ariaLabel="Método de pago"
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Método de pago" }),
    ).toHaveAttribute("id", "custom-picker");
  });
});
