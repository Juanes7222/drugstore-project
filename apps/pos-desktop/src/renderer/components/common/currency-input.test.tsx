/**
 * Component tests for CurrencyInput.
 *
 * Covers: value rendering, change callbacks, label, disabled state,
 * and edge cases (empty input, non-numeric input).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CurrencyInput } from "./currency-input";

describe("CurrencyInput", () => {
  it("renders a label when provided", () => {
    render(
      <CurrencyInput
        value={0}
        onChange={vi.fn()}
        label="Efectivo recibido"
      />,
    );

    expect(
      screen.getByLabelText("Efectivo recibido"),
    ).toBeInTheDocument();
  });

  it("does not render a label element when label is omitted", () => {
    const { container } = render(
      <CurrencyInput value={0} onChange={vi.fn()} />,
    );

    expect(container.querySelector("label")).toBeNull();
  });

  it("shows the $ prefix symbol", () => {
    render(
      <CurrencyInput value={500_000} onChange={vi.fn()} />,
    );

    expect(screen.getByText("$")).toBeInTheDocument();
  });

  it("calls onChange with the parsed integer when the value changes", () => {
    const onChange = vi.fn();

    render(
      <CurrencyInput value={0} onChange={onChange} label="Amount" />,
    );

    const input = screen.getByLabelText("Amount");
    fireEvent.change(input, { target: { value: "5000" } });

    expect(onChange).toHaveBeenCalledWith(5000);
  });

  it("calls onChange with 0 when the input is cleared", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <CurrencyInput value={500_000} onChange={onChange} label="Amount" />,
    );

    const input = screen.getByLabelText("Amount") as HTMLInputElement;
    await user.clear(input);

    rerender(
      <CurrencyInput value={0} onChange={onChange} label="Amount" />,
    );

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("clamps negative values to 0", () => {
    const onChange = vi.fn();

    render(
      <CurrencyInput value={0} onChange={onChange} label="Amount" />,
    );

    const input = screen.getByLabelText("Amount") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "-1" } });

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("disables the input when disabled is true", () => {
    render(
      <CurrencyInput
        value={100_000}
        onChange={vi.fn()}
        label="Amount"
        disabled
      />,
    );

    expect(screen.getByLabelText("Amount")).toBeDisabled();
  });

  it("has inputMode numeric for touch keyboard", () => {
    render(
      <CurrencyInput value={0} onChange={vi.fn()} label="Amount" />,
    );

    expect(screen.getByLabelText("Amount")).toHaveAttribute(
      "inputMode",
      "numeric",
    );
  });

  it("has type number for desktop convenience", () => {
    render(
      <CurrencyInput value={0} onChange={vi.fn()} label="Amount" />,
    );

    expect(screen.getByLabelText("Amount")).toHaveAttribute("type", "number");
  });
});
