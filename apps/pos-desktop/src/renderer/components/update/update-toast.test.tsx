/**
 * Component tests for UpdateToast.
 *
 * Covers: notification display, auto-dismiss, action buttons,
 * OPTIONAL vs HOTFIX variants.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { UpdateToast } from "./update-toast";
import "@/i18n";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("UpdateToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const defaultProps = {
    version: "2.0.0",
    updateType: "OPTIONAL" as const,
    onViewDetails: vi.fn(),
    onDismiss: vi.fn(),
    autoDismissMs: 8000,
  };

  it("shows the notification with status role", () => {
    render(<UpdateToast {...defaultProps} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the optional-available translation key", () => {
    render(<UpdateToast {...defaultProps} />);

    expect(
      screen.getByText("update.toast.optional_available"),
    ).toBeInTheDocument();
  });

  it("shows the install-on-close description", () => {
    render(<UpdateToast {...defaultProps} />);

    expect(
      screen.getByText("update.toast.install_on_close"),
    ).toBeInTheDocument();
  });

  it("calls onViewDetails when view details button clicked", () => {
    const onViewDetails = vi.fn();
    render(
      <UpdateToast {...defaultProps} onViewDetails={onViewDetails} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "update.toast.view_details" }),
    );
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss after 300ms when dismiss button clicked", () => {
    const onDismiss = vi.fn();
    render(<UpdateToast {...defaultProps} onDismiss={onDismiss} />);

    fireEvent.click(
      screen.getByRole("button", { name: "update.toast.dismiss" }),
    );

    // The dismiss handler has a 300ms setTimeout before calling onDismiss
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss after 300ms when close button clicked", () => {
    const onDismiss = vi.fn();
    render(<UpdateToast {...defaultProps} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: /Cerrar/ }));

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("auto-dismisses after autoDismissMs + 300ms", () => {
    const onDismiss = vi.fn();
    render(
      <UpdateToast
        {...defaultProps}
        onDismiss={onDismiss}
        autoDismissMs={5000}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(5300);
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders hotfix update text", () => {
    render(<UpdateToast {...defaultProps} updateType="HOTFIX" />);

    expect(
      screen.getByText("update.toast.hotfix_available"),
    ).toBeInTheDocument();
  });
});
