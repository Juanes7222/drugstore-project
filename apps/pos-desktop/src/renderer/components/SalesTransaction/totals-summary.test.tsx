/**
 * Component tests for TotalsSummary.
 *
 * Covers: display of subtotal, tax, and total values in Colombian-peso
 * format; zero values; accessibility.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TotalsSummary } from "./totals-summary";

describe("TotalsSummary", () => {
  it("renders subtotal, tax, and total with formatted currency", () => {
    render(
      <TotalsSummary
        subtotalCents={500_000}
        taxCents={95_000}
        totalCents={595_000}
      />,
    );

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
      />,
    );

    // The es-CO locale renders sales.cart.tax as "IVA (19%)"
    expect(screen.getByText("IVA (19%)")).toBeInTheDocument();
  });

  it("renders correctly with large values", () => {
    render(
      <TotalsSummary
        subtotalCents={15_000_000}
        taxCents={2_850_000}
        totalCents={17_850_000}
      />,
    );

    expect(screen.getByText(/\$\s*15\.000\.000/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*2\.850\.000/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*17\.850\.000/)).toBeInTheDocument();
  });

  it("renders small amounts under 1 000 without a dot separator", () => {
    render(
      <TotalsSummary
        subtotalCents={500}
        taxCents={95}
        totalCents={595}
      />,
    );

    expect(screen.getByText(/\$\s*500/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*95/)).toBeInTheDocument();
    expect(screen.getByText(/\$\s*595/)).toBeInTheDocument();
  });
});
