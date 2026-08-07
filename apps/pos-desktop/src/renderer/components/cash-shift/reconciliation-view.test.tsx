/**
 * Component tests for ReconciliationView.
 *
 * Covers: drift banner rendering, shift label, view mode indicator,
 * children rendering, default loading state.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("renders the fiscal vs operational comparison table when drift totals are provided", () => {
    render(
      <ReconciliationView
        drift={{
          hasDrift: true,
          adjustmentCount: 1,
          driftAmount: "50000",
          totals: [
            {
              paymentMethodId: "pm-card",
              methodName: "Tarjeta",
              isCash: false,
              fiscalAmount: "50000",
              operationalAmount: "0",
            },
            {
              paymentMethodId: "pm-cash",
              methodName: "Efectivo",
              isCash: true,
              fiscalAmount: "0",
              operationalAmount: "50000",
            },
          ],
        }}
        viewMode="operational"
        onToggleView={onToggleView}
        shiftLabel="Turno #001"
      />,
    );

    // Side-by-side columns
    expect(screen.getByText("Fiscal")).toBeInTheDocument();
    expect(screen.getByText("Operativo")).toBeInTheDocument();
    expect(screen.getByText("Diferencia")).toBeInTheDocument();

    // Method rows with amounts
    expect(screen.getByText("Tarjeta")).toBeInTheDocument();
    expect(screen.getByText("Efectivo")).toBeInTheDocument();
  });

  it("toggles the comparison table via the banner button", async () => {
    const user = userEvent.setup();
    render(
      <ReconciliationView
        drift={{
          hasDrift: true,
          adjustmentCount: 1,
          totals: [
            {
              paymentMethodId: "pm-cash",
              methodName: "Efectivo",
              isCash: true,
              fiscalAmount: "0",
              operationalAmount: "50000",
            },
          ],
        }}
        viewMode="operational"
        onToggleView={onToggleView}
        shiftLabel="Turno #001"
      />,
    );

    expect(screen.getByText("Efectivo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ocultar comparación" }));

    // Table hidden, banner button reverts to "show" label
    expect(screen.queryByText("Efectivo")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ver totales fiscales" }),
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
