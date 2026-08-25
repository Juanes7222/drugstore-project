/**
 * Component tests for BillingPeriodSelector — the monthly/quarterly/annual
 * radiogroup shared by the plan catalog and the switch-plan panel.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillingPeriod } from "@pharmacy/shared-types";
import {
  BillingPeriodSelector,
  type BillingPeriodSelectorProps,
} from "./billing-period-selector";

const makeProps = (
  overrides: Partial<BillingPeriodSelectorProps> = {},
): BillingPeriodSelectorProps => ({
  period: BillingPeriod.MONTHLY,
  onChange: vi.fn(),
  ...overrides,
});

describe("BillingPeriodSelector", () => {
  it("renders a radiogroup with an accessible label", () => {
    render(<BillingPeriodSelector {...makeProps()} />);

    expect(
      screen.getByRole("radiogroup", { name: "Período de facturación" }),
    ).toBeInTheDocument();
  });

  it("offers the three billing periods as radios", () => {
    render(<BillingPeriodSelector {...makeProps()} />);

    expect(screen.getByRole("radio", { name: /Mensual/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Trimestral/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Anual/ })).toBeInTheDocument();
  });

  it("marks only the selected period as checked", () => {
    render(<BillingPeriodSelector {...makeProps({ period: BillingPeriod.ANNUAL })} />);

    expect(screen.getByRole("radio", { name: /Anual/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Mensual/ })).not.toBeChecked();
  });

  it("reports the chosen period through onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BillingPeriodSelector {...makeProps({ onChange })} />);

    await user.click(screen.getByRole("radio", { name: /Trimestral/ }));

    expect(onChange).toHaveBeenCalledWith(BillingPeriod.QUARTERLY);
  });

  it("shows the discount badge on quarterly and annual but not monthly", () => {
    render(<BillingPeriodSelector {...makeProps({ period: BillingPeriod.MONTHLY })} />);

    // All three radios stay mounted; badges are scoped per option.
    expect(
      within(screen.getByRole("radio", { name: /Mensual/ })).queryByText("10% OFF"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("radio", { name: /Trimestral/ })).getByText("10% OFF"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("radio", { name: /Anual/ })).getByText("20% OFF"),
    ).toBeInTheDocument();
  });

  it("keeps the annual discount badge when annual is selected", () => {
    render(<BillingPeriodSelector {...makeProps({ period: BillingPeriod.ANNUAL })} />);

    expect(
      within(screen.getByRole("radio", { name: /Anual/ })).getByText("20% OFF"),
    ).toBeInTheDocument();
  });
});
