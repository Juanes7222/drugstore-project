/**
 * Unit tests for SummaryStep — the credit-payments (abonos) badge.
 *
 * The close wizard must make abonos visible per payment method so the
 * cashier understands why the expected drawer amount includes cash received
 * from debt payments.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryStep } from "./summary-step";
import type { ShiftSummary } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSummary(overrides?: Partial<ShiftSummary>): ShiftSummary {
  return {
    transactionCount: 3,
    totalSalesAmount: "500000",
    openingBalance: "200000",
    totalsByPaymentMethod: [
      {
        paymentMethodId: "pm-cash",
        methodName: "Efectivo",
        isCash: true,
        expectedAmount: "600000",
        creditPaymentAmount: "100000",
      },
      {
        paymentMethodId: "pm-card",
        methodName: "Tarjeta",
        isCash: false,
        expectedAmount: "200000",
        creditPaymentAmount: "0",
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SummaryStep credit payments badge", () => {
  it("shows the abono share for methods that collected credit payments", () => {
    render(
      <SummaryStep
        summary={makeSummary()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Cash: expected $600.000 of which $100.000 came from abonos. The COP
    // formatter renders "$ 100.000" (space after the peso symbol).
    expect(screen.getByText(/Abonos: \$\s*100\.000/)).toBeInTheDocument();
    // The expected column still shows the full drawer amount.
    expect(screen.getByText("$ 600.000")).toBeInTheDocument();
  });

  it("does not render the badge for methods without credit payments", () => {
    render(
      <SummaryStep
        summary={makeSummary()}
        onNext={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Only one badge rendered (the cash method) — the card method has none.
    expect(screen.getAllByText(/Abonos:/)).toHaveLength(1);
  });
});
