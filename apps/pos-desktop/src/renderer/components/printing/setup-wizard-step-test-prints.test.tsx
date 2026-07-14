/**
 * Component tests for SetupWizardStepTestPrints.
 *
 * Covers: test button per printer, test results display, loading state.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupWizardStepTestPrints } from "./setup-wizard-step-test-prints";
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
  step: "test-prints",
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

describe("SetupWizardStepTestPrints", () => {
  it("renders the title", () => {
    const state = baseState();
    const setState = vi.fn();
    const onTestPrint = vi.fn();

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    expect(
      screen.getByText("Prueba de impresión"),
    ).toBeInTheDocument();
  });

  it("renders the subtitle", () => {
    const state = baseState();
    const setState = vi.fn();
    const onTestPrint = vi.fn();

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    expect(
      screen.getByText(/Verifique que cada impresora configurada funcione/),
    ).toBeInTheDocument();
  });

  it("renders a test button per printer", () => {
    const state = baseState();
    const setState = vi.fn();
    const onTestPrint = vi.fn();

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    const testButtons = screen.getAllByText("Probar");
    expect(testButtons.length).toBe(2);
  });

  it("shows no status text for untested printers when result is undefined", () => {
    const state = baseState();
    const setState = vi.fn();
    const onTestPrint = vi.fn();

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    // When testResults is empty, result is undefined (not null) so no status
    // text renders. The legend still shows "No probada: 2".
    expect(screen.getByText(/No probada.*:\s*2/)).toBeInTheDocument();
  });

  it("shows success status when test passes", () => {
    const state = baseState({
      testResults: { "EPSON-TM-T20": true },
    });
    const setState = vi.fn();
    const onTestPrint = vi.fn();

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    expect(
      screen.getByText("✓ Funciona correctamente"),
    ).toBeInTheDocument();
  });

  it("shows failure status when test fails", () => {
    const state = baseState({
      testResults: { "EPSON-TM-T20": false },
    });
    const setState = vi.fn();
    const onTestPrint = vi.fn();

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    expect(
      screen.getByText("✗ Error en la impresión"),
    ).toBeInTheDocument();
  });

  it("calls onTestPrint when test button is clicked", async () => {
    const state = baseState();
    const setState = vi.fn();
    const onTestPrint = vi
      .fn()
      .mockResolvedValue({ success: true });

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    const testButton = screen.getAllByText("Probar")[0];
    await userEvent.click(testButton);

    expect(onTestPrint).toHaveBeenCalledWith(
      "EPSON-TM-T20",
      "THERMAL_RECEIPT",
    );
  });

  it("shows 'Probando...' while testing", async () => {
    const state = baseState();
    const setState = vi.fn();
    const onTestPrint = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) =>
            setTimeout(() => resolve({ success: true }), 500),
          ),
      );

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    const testButton = screen.getAllByText("Probar")[0];
    fireEvent.click(testButton);

    expect(screen.getByText("Probando...")).toBeInTheDocument();
  });

  it("shows 'Probar de nuevo' after successful test", async () => {
    const state = baseState({
      testResults: { "EPSON-TM-T20": true },
    });
    const setState = vi.fn();
    const onTestPrint = vi.fn().mockResolvedValue({ success: true });

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    expect(screen.getByText("Probar de nuevo")).toBeInTheDocument();
  });

  it("shows retry hint for failed test", () => {
    const state = baseState({
      testResults: { "EPSON-TM-T20": false },
    });
    const setState = vi.fn();
    const onTestPrint = vi.fn();

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    expect(
      screen.getByText(
        /Verifique que la impresora esté encendida/,
      ),
    ).toBeInTheDocument();
  });

  it("shows all-passed summary when all tests pass", () => {
    const state = baseState({
      testResults: {
        "EPSON-TM-T20": true,
        "EPSON-TM-T88": true,
      },
    });
    const setState = vi.fn();
    const onTestPrint = vi.fn();

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    expect(
      screen.getByText("Todas las impresoras funcionan correctamente."),
    ).toBeInTheDocument();
  });

  it("shows some-failed summary when some tests fail", () => {
    const state = baseState({
      testResults: {
        "EPSON-TM-T20": true,
        "EPSON-TM-T88": false,
      },
    });
    const setState = vi.fn();
    const onTestPrint = vi.fn();

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    expect(
      screen.getByText(/1 de 2 impresora\(s\) funcionan/),
    ).toBeInTheDocument();
  });

  it("renders printer header names", () => {
    const state = baseState();
    const setState = vi.fn();
    const onTestPrint = vi.fn();

    render(
      <SetupWizardStepTestPrints
        state={state}
        setState={setState}
        onTestPrint={onTestPrint}
      />,
    );

    expect(screen.getByText("Epson TM-T20")).toBeInTheDocument();
    expect(screen.getByText("Epson TM-T88")).toBeInTheDocument();
  });
});
