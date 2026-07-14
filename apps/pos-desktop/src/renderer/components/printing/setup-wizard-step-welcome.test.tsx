/**
 * Component tests for SetupWizardStepWelcome.
 *
 * Covers: welcome message, instructions, feature list, start button.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupWizardStepWelcome } from "./setup-wizard-step-welcome";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SetupWizardStepWelcome", () => {
  it("renders the welcome title", () => {
    render(<SetupWizardStepWelcome onStart={vi.fn()} />);

    expect(
      screen.getByText("Configure sus impresoras"),
    ).toBeInTheDocument();
  });

  it("renders the subtitle with instructions", () => {
    render(<SetupWizardStepWelcome onStart={vi.fn()} />);

    expect(
      screen.getByText(
        /En unos pocos pasos configure las impresoras/,
      ),
    ).toBeInTheDocument();
  });

  it("renders the feature list items", () => {
    render(<SetupWizardStepWelcome onStart={vi.fn()} />);

    expect(
      screen.getByText("Detección automática de impresoras conectadas"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Asignación de tipos de trabajo a cada impresora"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Configuración de impresora de respaldo"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Prueba de impresión para verificar funcionamiento"),
    ).toBeInTheDocument();
  });

  it("renders the start button", () => {
    render(<SetupWizardStepWelcome onStart={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Empezar" }),
    ).toBeInTheDocument();
  });

  it("calls onStart when the start button is clicked", async () => {
    const onStart = vi.fn();
    render(<SetupWizardStepWelcome onStart={onStart} />);

    const startButton = screen.getByRole("button", { name: "Empezar" });
    await userEvent.click(startButton);

    expect(onStart).toHaveBeenCalledOnce();
  });

  it("renders the later hint text", () => {
    render(<SetupWizardStepWelcome onStart={vi.fn()} />);

    expect(
      screen.getByText(
        /Puede configurar las impresoras más tarde/,
      ),
    ).toBeInTheDocument();
  });
});
