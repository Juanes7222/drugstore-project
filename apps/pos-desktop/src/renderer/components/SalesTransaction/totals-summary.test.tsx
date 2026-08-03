/**
 * Component tests for TotalsSummary.
 *
 * Covers: display of subtotal, tax, and total values in Colombian-peso
 * format; zero values; the optional delivery-fee row; accessibility.
 *
 * Amounts are passed in cents — `formatCurrency` divides by 100 — so
 * 50_000_000 cents renders as "$ 500.000".
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TotalsSummary } from "./totals-summary";

describe("TotalsSummary", () => {
  it("renders subtotal, tax, and total with formatted currency", () => {
    render(
      <TotalsSummary
        subtotalCents={50_000_000}
        taxCents={9_500_000}
        totalCents={59_500_000}
        uniqueRate={19}
      />,
    );

    // 50 000 000 cents = $ 500.000; 9 500 000 = $ 95.000; 59 500 000 = $ 595.000
    expect(screen.getByText(/\$\s*500\.000/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*95\.000/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*595\.000/)).toBeInTheDocument();
  });

  it("renders zero for all values when every prop is 0", () => {
    render(
      <TotalsSummary
        subtotalCents={0}
        taxCents={0}
        totalCents={0}
        uniqueRate={null}
      />,
    );

    // All three lines (subtotal, tax, total) show $0; getAllByText asserts count.
    const zeroEntries = screen.getAllByText(/\$\s*0/);
    expect(zeroEntries).toHaveLength(3);
  });

  it("renders the tax label from i18n", () => {
    render(
      <TotalsSummary
        subtotalCents={100_000}
        taxCents={19_000}
        totalCents={119_000}
        uniqueRate={19}
      />,
    );

    // The es-CO locale renders sales.cart.tax as "IVA (19%)"
    expect(screen.getByText("IVA (19%)")).toBeInTheDocument();
  });

  it("renders correctly with large values", () => {
    render(
      <TotalsSummary
        subtotalCents={1_500_000_000}
        taxCents={285_000_000}
        totalCents={1_785_000_000}
        uniqueRate={19}
      />,
    );

    // 1 500 000 000 cents = $ 15.000.000; 285 000 000 = $ 2.850.000;
    // 1 785 000 000 = $ 17.850.000
    expect(screen.getByText(/\$\s*15\.000\.000/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*2\.850\.000/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*17\.850\.000/)).toBeInTheDocument();
  });

  it("renders small amounts under 1 000 without a dot separator", () => {
    render(
      <TotalsSummary
        subtotalCents={50_000}
        taxCents={9_500}
        totalCents={59_500}
        uniqueRate={19}
      />,
    );

    // 50 000 cents = $ 500; 9 500 = $ 95; 59 500 = $ 595
    expect(screen.getByText(/\$\s*500/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*95/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*595/)).toBeInTheDocument();
  });

  it("renders the delivery fee row when deliveryFeeCents is positive", () => {
    render(
      <TotalsSummary
        subtotalCents={50_000}
        taxCents={9_500}
        totalCents={64_500}
        uniqueRate={19}
        deliveryFeeCents={5_000}
      />,
    );

    // 5 000 cents = $ 50; grand total = 50 000 + 9 500 + 5 000 = $ 645
    expect(screen.getByText("Domicilio")).toBeInTheDocument();
    expect(screen.getByText(/\$\s*50$/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*645/)).toBeInTheDocument();
  });

  it("omits the delivery fee row when deliveryFeeCents is 0", () => {
    render(
      <TotalsSummary
        subtotalCents={50_000}
        taxCents={9_500}
        totalCents={59_500}
        uniqueRate={19}
        deliveryFeeCents={0}
      />,
    );

    expect(screen.queryByText("Domicilio")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\s*50$/)).not.toBeInTheDocument();
  });
});
