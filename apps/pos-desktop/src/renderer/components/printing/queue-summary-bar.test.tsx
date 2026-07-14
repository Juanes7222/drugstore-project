/**
 * Component tests for QueueSummaryBar.
 *
 * Covers: stat values rendering, translated labels, accessible attributes.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueueSummaryBar } from "./queue-summary-bar";
import type { PrintQueueSummary } from "../../../domain/printing";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const baseSummary: PrintQueueSummary = {
  pending: 3,
  printing: 1,
  failed: 2,
  discarded: 0,
  completed24h: 15,
  averageAttemptsBeforeSuccess: 1.2,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("QueueSummaryBar", () => {
  it("renders all stat values correctly", () => {
    render(<QueueSummaryBar summary={baseSummary} />);

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("1.2")).toBeInTheDocument();
  });

  it("renders translated labels for each stat", () => {
    render(<QueueSummaryBar summary={baseSummary} />);

    expect(screen.getByText("Pendientes")).toBeInTheDocument();
    expect(screen.getByText("Imprimiendo")).toBeInTheDocument();
    expect(screen.getByText("Fallidos")).toBeInTheDocument();
    expect(screen.getByText("Descartados")).toBeInTheDocument();
    expect(screen.getByText("Completados (24h)")).toBeInTheDocument();
    expect(screen.getByText("Intentos promedio")).toBeInTheDocument();
  });

  it("renders with role='group' and an aria-label", () => {
    render(<QueueSummaryBar summary={baseSummary} />);

    const group = screen.getByRole("group");
    expect(group).toBeInTheDocument();
    expect(group).toHaveAccessibleName("Resumen de la cola");
  });

  it("defaults to 0 for undefined summary values", () => {
    const partialSummary = {
      pending: undefined,
      printing: undefined,
      failed: undefined,
      discarded: undefined,
      completed24h: undefined,
      averageAttemptsBeforeSuccess: 0,
    } as unknown as PrintQueueSummary;

    render(<QueueSummaryBar summary={partialSummary} />);

    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(5);
  });

  it("renders zero values correctly", () => {
    const emptySummary: PrintQueueSummary = {
      pending: 0,
      printing: 0,
      failed: 0,
      discarded: 0,
      completed24h: 0,
      averageAttemptsBeforeSuccess: 0,
    };

    render(<QueueSummaryBar summary={emptySummary} />);

    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(5);
  });
});
