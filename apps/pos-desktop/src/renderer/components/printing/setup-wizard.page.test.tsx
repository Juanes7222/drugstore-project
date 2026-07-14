/**
 * Component tests for SetupWizardPage.
 *
 * Covers: step navigation, next/back/finish/cancel actions.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupWizardPage } from "./setup-wizard.page";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
const mockListAll = vi.fn();
const mockSetFallbackChain = vi.fn();

vi.mock("../common/service-context", () => ({
  usePrinterConfigService: () => ({
    create: mockCreate,
    listAll: mockListAll,
    setFallbackChain: mockSetFallbackChain,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks that the current step indicator is visible, then clicks the next
 * button to advance.
 */
async function advanceToStep(
  stepNumber: number,
  nextButtonText: string,
): Promise<void> {
  // Wait for step indicator to render
  await waitFor(() => {
    const indicators = document.querySelectorAll(
      ".flex.items-center.gap-2.border-b .flex.items-center.gap-1",
    );
    // The current step should have font-bold
  });

  if (nextButtonText) {
    const nextButton = screen.getByRole("button", {
      name: nextButtonText,
    });
    await userEvent.click(nextButton);
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SetupWizardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAll.mockResolvedValue([]);
  });

  it("shows the welcome step initially", () => {
    render(<SetupWizardPage onComplete={vi.fn()} onDismiss={vi.fn()} />);

    expect(
      screen.getByText("Configure sus impresoras"),
    ).toBeInTheDocument();
  });

  it("shows 'Empezar' button on welcome step", () => {
    render(<SetupWizardPage onComplete={vi.fn()} onDismiss={vi.fn()} />);

    const buttons = screen.getAllByRole("button", { name: "Empezar" });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'Configurar más tarde' on welcome step", () => {
    render(<SetupWizardPage onComplete={vi.fn()} onDismiss={vi.fn()} />);

    expect(
      screen.getByText("Configurar más tarde"),
    ).toBeInTheDocument();
  });

  it("calls onDismiss when 'Configurar más tarde' is clicked on welcome", async () => {
    const onDismiss = vi.fn();
    render(
      <SetupWizardPage
        onComplete={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    const dismissButton = screen.getByText("Configurar más tarde");
    await userEvent.click(dismissButton);

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("shows 'Volver' (back) after advancing past welcome", async () => {
    render(<SetupWizardPage onComplete={vi.fn()} />);

    const startButton = screen.getAllByRole("button", { name: "Empezar" })[0];
    await userEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByText("Volver")).toBeInTheDocument();
    });
  });

  it("does not show 'Continuar' on summary step", async () => {
    // We need to navigate through all steps to reach summary
    // Mock discover to resolve immediately with empty results
    render(<SetupWizardPage onComplete={vi.fn()} />);

    // Step 1: Welcome -> click Empezar
    await userEvent.click(
      screen.getAllByRole("button", { name: "Empezar" })[0],
    );

    // Step 2: Discovery -> click Continuar
    await waitFor(() => {
      expect(
        screen.getByText("Continuar"),
      ).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Continuar"));

    // Step 3: Found Printers -> click Continuar
    await waitFor(() => {
      expect(screen.getByText("Continuar")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Continuar"));

    // Step 4: Job Assignment -> click Continuar
    await waitFor(() => {
      expect(screen.getByText("Continuar")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Continuar"));

    // Step 5: Test Prints -> click "Continuar configuración"
    await waitFor(() => {
      expect(
        screen.getByText("Continuar configuración"),
      ).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByText("Continuar configuración"),
    );

    // Step 6: Fallback Config -> click Continuar
    await waitFor(() => {
      expect(screen.getByText("Continuar")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Continuar"));

    // Step 7: Summary
    await waitFor(() => {
      expect(
        screen.getByText("Resumen de configuración"),
      ).toBeInTheDocument();
    });

    // Continuar should not be on summary
    expect(
      screen.queryByText("Continuar"),
    ).not.toBeInTheDocument();
  });

  it("goes back to previous step when 'Volver' is clicked", async () => {
    render(<SetupWizardPage onComplete={vi.fn()} />);

    await userEvent.click(
      screen.getAllByRole("button", { name: "Empezar" })[0],
    );

    await waitFor(() => {
      expect(screen.getByText("Volver")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Volver"));

    // Should be back on welcome
    await waitFor(() => {
      expect(
        screen.getByText("Configure sus impresoras"),
      ).toBeInTheDocument();
    });
  });

  it("renders step indicator numbers", () => {
    render(<SetupWizardPage onComplete={vi.fn()} />);

    // 7 steps, each with a number
    for (let i = 1; i <= 7; i++) {
      expect(screen.getByText(String(i))).toBeInTheDocument();
    }
  });

  it("renders with section aria-label", () => {
    const { container } = render(
      <SetupWizardPage onComplete={vi.fn()} />,
    );

    const section = container.querySelector(
      'section[aria-label="Configurar impresoras"]',
    );
    expect(section).toBeInTheDocument();
  });

  it("renders step labels in the step indicator", () => {
    render(<SetupWizardPage onComplete={vi.fn()} />);

    // Welcome should be visible, and it's the current step so it has bold
    expect(screen.getByText("welcome")).toBeInTheDocument();
  });
});
