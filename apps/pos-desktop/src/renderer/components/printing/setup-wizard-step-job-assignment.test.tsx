/**
 * Component tests for SetupWizardStepJobAssignment.
 *
 * Covers: job type options, assignment checkboxes, suggested badges.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupWizardStepJobAssignment } from "./setup-wizard-step-job-assignment";
import type { WizardState } from "./setup-wizard.page";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const baseDiscovered = [
  {
    systemName: "EPSON-TM-T20",
    friendlyName: "Epson TM-T20",
    connection: "USB",
    isDefault: true,
    printerType: "THERMAL_RECEIPT",
    supportsColor: false,
    detectedPaperSize: "RECEIPT_80MM",
    detectionConfidence: "high",
  },
];

const baseState = (
  overrides: Partial<WizardState> = {},
): WizardState => ({
  step: "job-assignment",
  discovered: baseDiscovered,
  selected: baseDiscovered,
  friendlyNames: {},
  paperSizes: {},
  jobAssignments: {},
  fallbackConfig: {},
  testResults: {},
  isDiscovering: false,
  networkScanEnabled: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SetupWizardStepJobAssignment", () => {
  it("renders the title", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepJobAssignment
        state={state}
        setState={setState}
      />,
    );

    expect(
      screen.getByText("Asignación de trabajos"),
    ).toBeInTheDocument();
  });

  it("renders the subtitle", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepJobAssignment
        state={state}
        setState={setState}
      />,
    );

    expect(
      screen.getByText(/Indique qué tipo de trabajos debe imprimir/),
    ).toBeInTheDocument();
  });

  it("renders job type labels as checkboxes", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepJobAssignment
        state={state}
        setState={setState}
      />,
    );

    expect(screen.getByText("Recibos de venta")).toBeInTheDocument();
    expect(
      screen.getByText("Facturas electrónicas"),
    ).toBeInTheDocument();
    expect(screen.getByText("Notas crédito")).toBeInTheDocument();
    expect(
      screen.getByText("Recibos de contingencia"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Reportes de inventario"),
    ).toBeInTheDocument();
    expect(screen.getByText("Cierres de turno")).toBeInTheDocument();
  });

  it("shows suggested badge for default assignments", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepJobAssignment
        state={state}
        setState={setState}
      />,
    );

    const suggested = screen.getAllByText("Sugerido");
    // THERMAL_RECEIPT has defaults: SALE_RECEIPT, CONTINGENCY_RECEIPT
    expect(suggested.length).toBe(2);
  });

  it("calls setState when a checkbox is toggled", async () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepJobAssignment
        state={state}
        setState={setState}
      />,
    );

    const checkbox = screen.getByLabelText("Facturas electrónicas");
    await userEvent.click(checkbox);

    expect(setState).toHaveBeenCalled();
  });

  it("shows printer name header", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepJobAssignment
        state={state}
        setState={setState}
      />,
    );

    expect(screen.getByText("Epson TM-T20")).toBeInTheDocument();
  });

  it("shows 'No hay impresoras seleccionadas' when no printers selected", () => {
    const state = baseState({ selected: [] });
    const setState = vi.fn();

    render(
      <SetupWizardStepJobAssignment
        state={state}
        setState={setState}
      />,
    );

    expect(
      screen.getByText(
        "No hay impresoras seleccionadas. Vuelva atrás y seleccione al menos una.",
      ),
    ).toBeInTheDocument();
  });

  it("shows paper size selector", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepJobAssignment
        state={state}
        setState={setState}
      />,
    );

    expect(
      screen.getByLabelText("Tamaño de papel"),
    ).toBeInTheDocument();
  });
});
