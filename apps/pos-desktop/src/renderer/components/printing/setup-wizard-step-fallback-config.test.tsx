/**
 * Component tests for SetupWizardStepFallbackConfig.
 *
 * Covers: form fields for manual config, onChange calls.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupWizardStepFallbackConfig } from "./setup-wizard-step-fallback-config";
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
  {
    systemName: "EPSON-TM-T88",
    friendlyName: "Epson TM-T88",
    connection: "NETWORK",
    isDefault: false,
    printerType: "THERMAL_RECEIPT",
    supportsColor: false,
    detectedPaperSize: "RECEIPT_80MM",
    detectionConfidence: "medium",
  },
];

const baseState = (
  overrides: Partial<WizardState> = {},
): WizardState => ({
  step: "fallback-config",
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

describe("SetupWizardStepFallbackConfig", () => {
  it("renders the title", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFallbackConfig state={state} setState={setState} />,
    );

    expect(
      screen.getByText("Configuración de respaldo"),
    ).toBeInTheDocument();
  });

  it("renders the subtitle", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFallbackConfig state={state} setState={setState} />,
    );

    expect(
      screen.getByText(/Configure una impresora de respaldo/),
    ).toBeInTheDocument();
  });

  it("renders printer headers with names", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFallbackConfig state={state} setState={setState} />,
    );

    // Names appear as both headings and radio labels
    const t20Elements = screen.getAllByText("Epson TM-T20");
    expect(t20Elements.length).toBeGreaterThanOrEqual(1);
    const t88Elements = screen.getAllByText("Epson TM-T88");
    expect(t88Elements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows radio options for fallback", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFallbackConfig state={state} setState={setState} />,
    );

    // First printer has "second printer" option, server, and none
    const fieldset = screen.getAllByText(/Si esta impresora falla/);
    expect(fieldset.length).toBe(2);
  });

  it("shows local printer, server, and none options", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFallbackConfig state={state} setState={setState} />,
    );

    // Printer names appear as headings AND as radio labels — use getAllByText
    const t20Elements = screen.getAllByText("Epson TM-T20");
    expect(t20Elements.length).toBeGreaterThanOrEqual(1);
    const t88Elements = screen.getAllByText("Epson TM-T88");
    expect(t88Elements.length).toBeGreaterThanOrEqual(1);

    // These appear once per printer (total 2)
    const centralOptions = screen.getAllByText("Servidor central");
    expect(centralOptions.length).toBe(2);
    const noBackupOptions = screen.getAllByText("Sin respaldo");
    expect(noBackupOptions.length).toBe(2);
  });

  it("shows 'Sin respaldo configurado' when none selected", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFallbackConfig state={state} setState={setState} />,
    );

    const summaries = screen.getAllByText("Sin respaldo configurado");
    expect(summaries.length).toBe(2);
  });

  it("calls setState when a radio option is selected", async () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFallbackConfig state={state} setState={setState} />,
    );

    const serverRadio = screen.getAllByText("Servidor central")[0]
      .closest("label")
      ?.querySelector('input[type="radio"]');
    expect(serverRadio).toBeInTheDocument();

    if (serverRadio) await userEvent.click(serverRadio);

    expect(setState).toHaveBeenCalled();
  });

  it("shows 'No hay impresoras seleccionadas' when no printers selected", () => {
    const state = baseState({ selected: [] });
    const setState = vi.fn();

    render(
      <SetupWizardStepFallbackConfig state={state} setState={setState} />,
    );

    expect(
      screen.getByText("No hay impresoras seleccionadas."),
    ).toBeInTheDocument();
  });

  it("shows 'Respaldo: Servidor central' when server is selected", () => {
    const state = baseState({
      fallbackConfig: {
        "EPSON-TM-T20": {
          fallbackPrinterId: null,
          serverFallback: true,
        },
      },
    });
    const setState = vi.fn();

    render(
      <SetupWizardStepFallbackConfig state={state} setState={setState} />,
    );

    expect(
      screen.getByText("Respaldo: Servidor central"),
    ).toBeInTheDocument();
  });
});
