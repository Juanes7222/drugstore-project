/**
 * Component tests for UpdateModal.
 *
 * Covers: version display, CRITICAL/MANDATORY behavior, release notes,
 * blocking vs non-blocking, install/remind later buttons.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UpdateModal } from "./update-modal";
import "@/i18n";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("UpdateModal", () => {
  const defaultProps = {
    open: true,
    version: "2.0.0",
    updateType: "OPTIONAL" as const,
    onInstallNow: vi.fn(),
    onRemindLater: vi.fn(),
    onOpenChange: vi.fn(),
    releaseNotes: "<p>Novedades en la versión 2.0.0</p>",
    mandatoryFrom: undefined,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the version number", () => {
    render(<UpdateModal {...defaultProps} />);

    expect(screen.getByText(/2\.0\.0/)).toBeInTheDocument();
  });

  it("shows release notes HTML when provided", () => {
    render(<UpdateModal {...defaultProps} />);

    expect(
      screen.getByText("Novedades en la versión 2.0.0"),
    ).toBeInTheDocument();
  });

  it("calls onInstallNow when install button clicked", () => {
    const onInstallNow = vi.fn();
    render(<UpdateModal {...defaultProps} onInstallNow={onInstallNow} />);

    fireEvent.click(
      screen.getByRole("button", { name: /install_now/i }),
    );
    expect(onInstallNow).toHaveBeenCalledTimes(1);
  });

  it("shows remind later button for non-blocking MANDATORY updates", () => {
    render(
      <UpdateModal
        {...defaultProps}
        updateType="MANDATORY"
        onRemindLater={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /remind_later/i }),
    ).toBeInTheDocument();
  });

  it("hides remind later for CRITICAL blocking updates", () => {
    render(
      <UpdateModal
        {...defaultProps}
        updateType="CRITICAL"
        onRemindLater={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /remind_later/i }),
    ).not.toBeInTheDocument();
  });

  it("shows blocking notice for CRITICAL updates", () => {
    render(<UpdateModal {...defaultProps} updateType="CRITICAL" />);

    expect(
      screen.getByText(/blocking_notice/i),
    ).toBeInTheDocument();
  });

  it("hides close button for blocking CRITICAL updates", () => {
    render(<UpdateModal {...defaultProps} updateType="CRITICAL" />);

    expect(
      screen.queryByRole("button", { name: /Cerrar/ }),
    ).not.toBeInTheDocument();
  });

  it("shows close button for non-blocking updates", () => {
    render(
      <UpdateModal
        {...defaultProps}
        updateType="MANDATORY"
        mandatoryFrom="2099-12-31T00:00:00.000Z"
      />,
    );

    expect(
      screen.getByRole("button", { name: /Cerrar/ }),
    ).toBeInTheDocument();
  });

  it("shows critical badge for CRITICAL type", () => {
    render(<UpdateModal {...defaultProps} updateType="CRITICAL" />);

    expect(
      screen.getByText(/critical_badge/i),
    ).toBeInTheDocument();
  });

  it("calls onRemindLater when reminded later button clicked", () => {
    const onRemindLater = vi.fn();
    render(
      <UpdateModal
        {...defaultProps}
        updateType="MANDATORY"
        onRemindLater={onRemindLater}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /remind_later/i }),
    );
    expect(onRemindLater).toHaveBeenCalledTimes(1);
  });
});
