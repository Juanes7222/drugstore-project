/**
 * Component tests for SetupWizardStepSummary.
 *
 * Covers: configuration summary display, per-printer details.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupWizardStepSummary } from "./setup-wizard-step-summary";
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
  step: "summary",
  discovered: baseDiscovered,
  selected: baseDiscovered,
  friendlyNames: {},
  paperSizes: {},
  jobAssignments: {
    "EPSON-TM-T20": ["SALE_RECEIPT", "CONTINGENCY_RECEIPT"],
  },
  fallbackConfig: {},
  testResults: { "EPSON-TM-T20": true },
  isDiscovering: false,
  networkScanEnabled: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SetupWizardStepSummary", () => {
  it("renders the summary title", () => {
    const state = baseState();
    render(
      <SetupWizardStepSummary state={state} onComplete={vi.fn()} />,
    );

    expect(
      screen.getByText("Resumen de configuración"),
    ).toBeInTheDocument();
  });

  it("renders the subtitle", () => {
    const state = baseState();
    render(
      <SetupWizardStepSummary state={state} onComplete={vi.fn()} />,
    );

    expect(
      screen.getByText(/Revise la configuración antes de guardar/),
    ).toBeInTheDocument();
  });

  it("renders overall stats", () => {
    const state = baseState();
    render(
      <SetupWizardStepSummary state={state} onComplete={vi.fn()} />,
    );

    expect(
      screen.getByText("Impresora(s) configurada(s)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Con trabajos asignados"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Con respaldo configurado"),
    ).toBeInTheDocument();
  });

  it("renders the total printer count", () => {
    const state = baseState();
    render(
      <SetupWizardStepSummary state={state} onComplete={vi.fn()} />,
    );

    // Two stats show "1": the printer count and the jobs count
    const ones = screen.getAllByText("1");
    expect(ones.length).toBeGreaterThanOrEqual(1);
  });

  it("renders per-printer detail with name and system name", () => {
    const state = baseState();
    render(
      <SetupWizardStepSummary state={state} onComplete={vi.fn()} />,
    );

    expect(screen.getByText("Epson TM-T20")).toBeInTheDocument();
    expect(screen.getByText("EPSON-TM-T20")).toBeInTheDocument();
  });

  it("renders job labels for assigned jobs", () => {
    const state = baseState();
    render(
      <SetupWizardStepSummary state={state} onComplete={vi.fn()} />,
    );

    expect(screen.getByText("Recibos de venta")).toBeInTheDocument();
    expect(
      screen.getByText("Recibos de contingencia"),
    ).toBeInTheDocument();
  });

  it("shows 'Sin trabajos asignados' when no jobs assigned", () => {
    const state = baseState({
      jobAssignments: { "EPSON-TM-T20": [] },
    });
    render(
      <SetupWizardStepSummary state={state} onComplete={vi.fn()} />,
    );

    expect(
      screen.getByText("Sin trabajos asignados"),
    ).toBeInTheDocument();
  });

  it("shows tested_ok badge when test passed", () => {
    const state = baseState();
    render(
      <SetupWizardStepSummary state={state} onComplete={vi.fn()} />,
    );

    expect(screen.getByText("Verificada")).toBeInTheDocument();
  });

  it("shows tested_fail badge when test failed", () => {
    const state = baseState({
      testResults: { "EPSON-TM-T20": false },
    });
    render(
      <SetupWizardStepSummary state={state} onComplete={vi.fn()} />,
    );

    expect(screen.getByText("Error en prueba")).toBeInTheDocument();
  });

  it("shows 'Sin respaldo' when no fallback configured", () => {
    const state = baseState();
    render(
      <SetupWizardStepSummary state={state} onComplete={vi.fn()} />,
    );

    expect(
      screen.getByText(/Respaldo: Sin respaldo/),
    ).toBeInTheDocument();
  });

  it("shows 'Servidor central' as fallback when serverFallback is true", () => {
    const state = baseState({
      fallbackConfig: {
        "EPSON-TM-T20": {
          fallbackPrinterId: null,
          serverFallback: true,
        },
      },
    });
    render(
      <SetupWizardStepSummary state={state} onComplete={vi.fn()} />,
    );

    expect(
      screen.getByText(/Respaldo: Servidor central/),
    ).toBeInTheDocument();
  });

  it("renders the save button", () => {
    const state = baseState();
    render(
      <SetupWizardStepSummary state={state} onComplete={vi.fn()} />,
    );

    expect(
      screen.getByText("Guardar configuración"),
    ).toBeInTheDocument();
  });

  it("calls onComplete when save button is clicked", async () => {
    const onComplete = vi.fn();
    const state = baseState();

    render(
      <SetupWizardStepSummary state={state} onComplete={onComplete} />,
    );

    const saveButton = screen.getByRole("button", {
      name: "Guardar configuración",
    });
    await userEvent.click(saveButton);

    expect(onComplete).toHaveBeenCalledOnce();
  });
});
