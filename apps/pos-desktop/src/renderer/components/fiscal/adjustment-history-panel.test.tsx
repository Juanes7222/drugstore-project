/**
 * Component tests for AdjustmentHistoryPanel.
 *
 * Covers: adjustment list rendering, empty state, loading state, CSV export.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdjustmentHistoryPanel } from "./adjustment-history-panel";
import type { AdjustmentHistoryEntry } from "../../../domain/fiscal/local-adjustment.types";
import "@/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createEntry = (
  overrides: Partial<AdjustmentHistoryEntry> = {},
): AdjustmentHistoryEntry => ({
  id: "adj-1",
  createdAt: "2026-07-13T10:30:00.000Z",
  actorName: "María López",
  actorId: "user-001",
  adjustmentType: "PAYMENT_METHOD_CHANGE",
  previousValue: "Efectivo",
  newValue: "Tarjeta",
  reason: "Cliente solicitó cambio",
  isReversed: false,
  reversalOfAdjustmentId: null,
  replacedByAdjustmentId: null,
  ...overrides,
});

const defaultProps = {
  adjustments: [
    createEntry(),
    createEntry({
      id: "adj-2",
      adjustmentType: "INTERNAL_NOTE",
      previousValue: null,
      newValue: "Nota de prueba",
      reason: "Registro interno",
    }),
  ],
  isLoading: false,
  onExportCsv: vi.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AdjustmentHistoryPanel", () => {
  it("renders adjustment entries in a list", () => {
    render(<AdjustmentHistoryPanel {...defaultProps} />);

    expect(screen.getByRole("list")).toBeInTheDocument();
    // Author name appears in multiple entries
    expect(screen.getAllByText("María López").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Cambio método de pago")).toBeInTheDocument();
    expect(screen.getByText("Nota interna")).toBeInTheDocument();
  });

  it("shows previous and new values for value changes", () => {
    render(<AdjustmentHistoryPanel {...defaultProps} />);

    // The component shows previousValue with line-through and newValue
    expect(screen.getByText("Efectivo")).toBeInTheDocument();
    expect(screen.getByText("Tarjeta")).toBeInTheDocument();
  });

  it("shows empty state when there are no adjustments", () => {
    render(<AdjustmentHistoryPanel adjustments={[]} />);

    expect(
      screen.getByText("No hay ajustes registrados."),
    ).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<AdjustmentHistoryPanel adjustments={[]} isLoading />);

    expect(screen.getByText("Cargando...")).toBeInTheDocument();
  });

  it("shows export CSV button when onExportCsv is provided and adjustments exist", () => {
    render(<AdjustmentHistoryPanel {...defaultProps} />);

    expect(
      screen.getByRole("button", { name: /Exportar CSV/ }),
    ).toBeInTheDocument();
  });

  it("calls onExportCsv when export button clicked", () => {
    const onExportCsv = vi.fn();
    render(
      <AdjustmentHistoryPanel {...defaultProps} onExportCsv={onExportCsv} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/ }));
    expect(onExportCsv).toHaveBeenCalledTimes(1);
  });

  it("shows reversed badge for reversed entries", () => {
    render(
      <AdjustmentHistoryPanel
        adjustments={[createEntry({ isReversed: true })]}
      />,
    );

    expect(screen.getByText("REVERTIDO")).toBeInTheDocument();
  });
});
