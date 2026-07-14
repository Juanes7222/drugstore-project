/**
 * Component tests for OperationalDriftBanner.
 *
 * Covers: visibility toggle, banner variant, inline variant,
 * drift amount display, toggle button.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OperationalDriftBanner } from "./operational-drift-banner";
import "@/i18n";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("OperationalDriftBanner", () => {
  it("renders nothing when hasDrift is false", () => {
    const { container } = render(
      <OperationalDriftBanner hasDrift={false} adjustmentCount={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the banner variant with title", () => {
    render(
      <OperationalDriftBanner
        hasDrift
        adjustmentCount={3}
        variant="banner"
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText("Ajustes operativos aplicados"),
    ).toBeInTheDocument();
  });

  it("displays the adjustment count in the body text", () => {
    render(
      <OperationalDriftBanner
        hasDrift
        adjustmentCount={5}
        variant="banner"
      />,
    );

    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it("shows drift amount when provided", () => {
    render(
      <OperationalDriftBanner
        hasDrift
        adjustmentCount={2}
        driftAmount={15000}
        variant="banner"
      />,
    );

    expect(screen.getByText(/Diferencia/)).toBeInTheDocument();
  });

  it("renders toggle button when onToggleView provided", () => {
    const onToggleView = vi.fn();
    render(
      <OperationalDriftBanner
        hasDrift
        adjustmentCount={1}
        onToggleView={onToggleView}
        variant="banner"
      />,
    );

    const toggleButton = screen.getByRole("button", {
      name: "Ver totales fiscales",
    });
    expect(toggleButton).toBeInTheDocument();

    fireEvent.click(toggleButton);
    expect(onToggleView).toHaveBeenCalledTimes(1);
  });

  it("renders the inline variant with status role", () => {
    render(
      <OperationalDriftBanner
        hasDrift
        adjustmentCount={3}
        variant="inline"
      />,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Ajustes operativos")).toBeInTheDocument();
  });

  it("shows adjustment count in inline variant", () => {
    render(
      <OperationalDriftBanner
        hasDrift
        adjustmentCount={7}
        variant="inline"
      />,
    );

    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
