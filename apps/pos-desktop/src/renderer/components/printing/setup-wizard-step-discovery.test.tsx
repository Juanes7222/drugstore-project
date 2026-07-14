/**
 * Component tests for SetupWizardStepDiscovery.
 *
 * Covers: scanning state, discovered printer list, network scan toggle.
 */
import { describe, expect, it, vi, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupWizardStepDiscovery } from "./setup-wizard-step-discovery";
import type { WizardState } from "./setup-wizard.page";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const baseState = (
  overrides: Partial<WizardState> = {},
): WizardState => ({
  step: "discovery",
  discovered: [],
  selected: [],
  friendlyNames: {},
  paperSizes: {},
  jobAssignments: {},
  fallbackConfig: {},
  testResults: {},
  isDiscovering: true,
  networkScanEnabled: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SetupWizardStepDiscovery", () => {
  it("shows searching message while discovering", () => {
    const state = baseState({ isDiscovering: true });
    const setState = vi.fn();

    render(
      <SetupWizardStepDiscovery state={state} setState={setState} />,
    );

    expect(
      screen.getByText("Buscando impresoras conectadas..."),
    ).toBeInTheDocument();
  });

  it("shows found message when discovery is complete", () => {
    const state = baseState({
      isDiscovering: false,
      discovered: [
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
      ],
    });
    const setState = vi.fn();

    render(
      <SetupWizardStepDiscovery state={state} setState={setState} />,
    );

    expect(
      screen.getByText(/1 impresora\(s\) encontrada/),
    ).toBeInTheDocument();
  });

  it("lists discovered printers with their names", () => {
    const state = baseState({
      isDiscovering: false,
      discovered: [
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
      ],
    });
    const setState = vi.fn();

    render(
      <SetupWizardStepDiscovery state={state} setState={setState} />,
    );

    expect(screen.getByText("Epson TM-T20")).toBeInTheDocument();
    expect(screen.getByText("Epson TM-T88")).toBeInTheDocument();
    expect(screen.getByText("EPSON-TM-T20")).toBeInTheDocument();
    expect(screen.getByText("EPSON-TM-T88")).toBeInTheDocument();
  });

  it("shows connection type badges on discovered printers", () => {
    const state = baseState({
      isDiscovering: false,
      discovered: [
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
      ],
    });
    const setState = vi.fn();

    render(
      <SetupWizardStepDiscovery state={state} setState={setState} />,
    );

    expect(screen.getByText("USB")).toBeInTheDocument();
  });

  it("shows 'Predet.' badge for default printer", () => {
    const state = baseState({
      isDiscovering: false,
      discovered: [
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
      ],
    });
    const setState = vi.fn();

    render(
      <SetupWizardStepDiscovery state={state} setState={setState} />,
    );

    expect(screen.getByText("Predet.")).toBeInTheDocument();
  });

  it("shows empty state when no printers found", () => {
    const state = baseState({
      isDiscovering: false,
      discovered: [],
    });
    const setState = vi.fn();

    render(
      <SetupWizardStepDiscovery state={state} setState={setState} />,
    );

    expect(
      screen.getByText("No se encontraron impresoras"),
    ).toBeInTheDocument();
  });

  it("toggles network scan when clicked", async () => {
    const state = baseState({
      isDiscovering: false,
      discovered: [],
      networkScanEnabled: false,
    });
    const setState = vi.fn();

    render(
      <SetupWizardStepDiscovery state={state} setState={setState} />,
    );

    const toggle = screen.getByText("Buscar también en la red local");
    await userEvent.click(toggle);

    expect(setState).toHaveBeenCalledOnce();
    const updater = setState.mock.calls[0][0] as (
      prev: WizardState,
    ) => WizardState;
    const result = updater(state);
    expect(result.networkScanEnabled).toBe(true);
  });

  it("shows the network scan toggle with correct aria-pressed", () => {
    const state = baseState({
      isDiscovering: false,
      discovered: [],
      networkScanEnabled: true,
    });
    const setState = vi.fn();

    render(
      <SetupWizardStepDiscovery state={state} setState={setState} />,
    );

    const toggle = screen.getByText("Buscar también en la red local");
    expect(toggle.closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
