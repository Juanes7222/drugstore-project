/**
 * Component tests for SetupWizardStepFoundPrinters.
 *
 * Covers: discovered printer list, toggle selection, friendly name editing.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupWizardStepFoundPrinters } from "./setup-wizard-step-found-printers";
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
  step: "found-printers",
  discovered: baseDiscovered,
  selected: [],
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

describe("SetupWizardStepFoundPrinters", () => {
  it("renders the title", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFoundPrinters state={state} setState={setState} />,
    );

    expect(
      screen.getByText("Impresoras encontradas"),
    ).toBeInTheDocument();
  });

  it("renders the subtitle", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFoundPrinters state={state} setState={setState} />,
    );

    expect(
      screen.getByText(
        /Seleccione las impresoras que desea configurar/,
      ),
    ).toBeInTheDocument();
  });

  it("renders all discovered printers", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFoundPrinters state={state} setState={setState} />,
    );

    // Friendly names are rendered as input values
    expect(
      screen.getByDisplayValue("Epson TM-T20"),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Epson TM-T88"),
    ).toBeInTheDocument();
    // System names are rendered as text
    expect(screen.getByText("EPSON-TM-T20")).toBeInTheDocument();
    expect(screen.getByText("EPSON-TM-T88")).toBeInTheDocument();
  });

  it("renders connection badges", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFoundPrinters state={state} setState={setState} />,
    );

    expect(screen.getByText("USB")).toBeInTheDocument();
    expect(screen.getByText("Red")).toBeInTheDocument();
  });

  it("renders printer type badges", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFoundPrinters state={state} setState={setState} />,
    );

    const typeBadges = screen.getAllByText("Térmica (recibos)");
    expect(typeBadges.length).toBe(2);
  });

  it("shows selected count", () => {
    const state = baseState({
      selected: [baseDiscovered[0]],
    });
    const setState = vi.fn();

    render(
      <SetupWizardStepFoundPrinters state={state} setState={setState} />,
    );

    expect(
      screen.getByText("1 de 2 seleccionada(s)"),
    ).toBeInTheDocument();
  });

  it("calls setState when a printer is toggled", async () => {
    const state = baseState({ selected: [] });
    const setState = vi.fn();

    render(
      <SetupWizardStepFoundPrinters state={state} setState={setState} />,
    );

    // Click on the system name text inside the card
    const systemName = screen.getByText("EPSON-TM-T20");
    const card = systemName.closest('[role="option"]');
    expect(card).toBeInTheDocument();

    if (card) await userEvent.click(card);

    expect(setState).toHaveBeenCalledOnce();
  });

  it("shows empty state when discovered is empty", () => {
    const state = baseState({ discovered: [], selected: [] });
    const setState = vi.fn();

    render(
      <SetupWizardStepFoundPrinters state={state} setState={setState} />,
    );

    expect(
      screen.getByText("No se encontraron impresoras"),
    ).toBeInTheDocument();
  });

  it("shows paper size dropdowns", () => {
    const state = baseState();
    const setState = vi.fn();

    render(
      <SetupWizardStepFoundPrinters state={state} setState={setState} />,
    );

    const paperSelects = screen.getAllByLabelText("Tamaño de papel");
    expect(paperSelects.length).toBe(2);
  });

  it("marks selected printers with aria-selected", () => {
    const state = baseState({
      selected: [baseDiscovered[0]],
    });
    const setState = vi.fn();

    render(
      <SetupWizardStepFoundPrinters state={state} setState={setState} />,
    );

    // Query option elements via their role and check aria-selected
    const firstInput = screen.getByDisplayValue("Epson TM-T20");
    const firstOption = firstInput.closest('[role="option"]');
    const secondInput = screen.getByDisplayValue("Epson TM-T88");
    const secondOption = secondInput.closest('[role="option"]');

    expect(firstOption).toHaveAttribute("aria-selected", "true");
    expect(secondOption).toHaveAttribute("aria-selected", "false");
  });
});
