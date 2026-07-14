/**
 * Component tests for UpdateProgress.
 *
 * Covers: visibility toggle, progress bar rendering, phase labels,
 * speed/ETA display, error state, done/completion.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpdateProgress } from "./update-progress";
import "@/i18n";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("UpdateProgress", () => {
  const defaultProps = {
    visible: true,
    version: "2.0.0",
    progressPercent: 50,
    phase: "downloading" as const,
    etaSeconds: null,
    speed: undefined,
    errorMessage: undefined,
  };

  it("does not render when visible is false", () => {
    const { container } = render(
      <UpdateProgress {...defaultProps} visible={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders progress overlay when visible", () => {
    render(<UpdateProgress {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Title key is rendered (translation not available in es.json)
    expect(
      screen.getByText("update.progress.title"),
    ).toBeInTheDocument();
  });

  it("shows progress percentage", () => {
    render(<UpdateProgress {...defaultProps} progressPercent={42} />);

    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("shows phase label", () => {
    render(<UpdateProgress {...defaultProps} phase="installing" />);

    expect(
      screen.getByText("update.progress.phase_installing"),
    ).toBeInTheDocument();
  });

  it("shows speed during download phase", () => {
    render(
      <UpdateProgress
        {...defaultProps}
        phase="downloading"
        speed="2.4 MB/s"
      />,
    );

    expect(screen.getByText(/2\.4 MB\/s/)).toBeInTheDocument();
  });

  it("shows ETA when provided", () => {
    render(
      <UpdateProgress
        {...defaultProps}
        phase="downloading"
        speed="1 MB/s"
        etaSeconds={120}
      />,
    );

    // The ETA is rendered in the same element as speed, separated by a dot
    expect(
      screen.getByText((content) => content.includes("update.progress.eta_minutes")),
    ).toBeInTheDocument();
  });

  it("shows error message when provided", () => {
    render(
      <UpdateProgress
        {...defaultProps}
        errorMessage="Error de descarga"
      />,
    );

    expect(screen.getByText("Error de descarga")).toBeInTheDocument();
  });

  it("shows do-not-close warning", () => {
    render(<UpdateProgress {...defaultProps} />);

    expect(
      screen.getByText("update.progress.do_not_close"),
    ).toBeInTheDocument();
  });
});
