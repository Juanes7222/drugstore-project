/**
 * Component tests for ReconciliationView.
 *
 * Covers: drift banner rendering, shift label, view mode indicator,
 * children rendering, default loading state.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReconciliationView } from "./reconciliation-view";
import "@/i18n";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ReconciliationView", () => {
  const onToggleView = vi.fn();

  it("renders the shift label", () => {
    render(
      <ReconciliationView
        drift={null}
        viewMode="operational"
        onToggleView={onToggleView}
        shiftLabel="Turno #POS-00427"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Turno #POS-00427" }),
    ).toBeInTheDocument();
  });

  it("shows the view mode indicator", () => {
    render(
      <ReconciliationView
        drift={null}
        viewMode="operational"
        onToggleView={onToggleView}
        shiftLabel="Turno #001"
      />,
    );

    expect(screen.getByText("Operativa")).toBeInTheDocument();
  });

  it("shows fiscal mode indicator when viewMode is fiscal", () => {
    render(
      <ReconciliationView
        drift={null}
        viewMode="fiscal"
        onToggleView={onToggleView}
        shiftLabel="Turno #001"
      />,
    );

    expect(screen.getByText("Fiscal")).toBeInTheDocument();
  });

  it("renders the drift banner when drift data is provided", () => {
    render(
      <ReconciliationView
        drift={{ hasDrift: true, adjustmentCount: 3 }}
        viewMode="operational"
        onToggleView={onToggleView}
        shiftLabel="Turno #001"
      />,
    );

    expect(
      screen.getByText("Ajustes operativos aplicados"),
    ).toBeInTheDocument();
  });

  it("does not render drift banner when drift is null", () => {
    render(
      <ReconciliationView
        drift={null}
        viewMode="operational"
        onToggleView={onToggleView}
        shiftLabel="Turno #001"
      />,
    );

    expect(
      screen.queryByText("Ajustes operativos aplicados"),
    ).not.toBeInTheDocument();
  });

  it("renders children as the main content", () => {
    render(
      <ReconciliationView
        drift={null}
        viewMode="operational"
        onToggleView={onToggleView}
        shiftLabel="Turno #001"
      >
        <div data-testid="recon-content">Contenido de reconciliación</div>
      </ReconciliationView>,
    );

    expect(screen.getByText("Contenido de reconciliación")).toBeInTheDocument();
  });

  it("shows loading state when no children provided", () => {
    render(
      <ReconciliationView
        drift={null}
        viewMode="operational"
        onToggleView={onToggleView}
        shiftLabel="Turno #001"
      />,
    );

    expect(screen.getByText("Cargando...")).toBeInTheDocument();
  });
});
