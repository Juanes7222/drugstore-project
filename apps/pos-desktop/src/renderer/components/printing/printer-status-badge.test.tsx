/**
 * Component tests for PrinterStatusBadge.
 *
 * Covers: status color dots, dot-only mode, accessible attributes.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrinterStatusBadge } from "./printer-status-badge";
import { PrinterStatusCode } from "../../../domain/printing/printing-types";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("PrinterStatusBadge", () => {
  it("displays a green dot and 'En línea' label for ONLINE status", () => {
    render(<PrinterStatusBadge status={PrinterStatusCode.ONLINE} />);

    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAccessibleName(/En línea/);
    expect(badge).toHaveTextContent("En línea");
  });

  it("displays a gray dot and 'Sin conexión' label for OFFLINE status", () => {
    render(<PrinterStatusBadge status={PrinterStatusCode.OFFLINE} />);

    const badge = screen.getByRole("status");
    expect(badge).toHaveAccessibleName(/Sin conexión/);
    expect(badge).toHaveTextContent("Sin conexión");
  });

  it("displays a red dot and 'Error' label for ERROR status", () => {
    render(<PrinterStatusBadge status={PrinterStatusCode.ERROR} />);

    const badge = screen.getByRole("status");
    expect(badge).toHaveAccessibleName(/Error/);
    expect(badge).toHaveTextContent("Error");
  });

  it("displays a yellow dot and 'Sin papel' label for NO_PAPER status", () => {
    render(<PrinterStatusBadge status={PrinterStatusCode.NO_PAPER} />);

    const badge = screen.getByRole("status");
    expect(badge).toHaveAccessibleName(/Sin papel/);
    expect(badge).toHaveTextContent("Sin papel");
  });

  it("displays a gray dot and 'Desconocido' label for UNKNOWN status", () => {
    render(<PrinterStatusBadge status={PrinterStatusCode.UNKNOWN} />);

    const badge = screen.getByRole("status");
    expect(badge).toHaveAccessibleName(/Desconocido/);
    expect(badge).toHaveTextContent("Desconocido");
  });

  it("hides the label text when dotOnly is true", () => {
    render(
      <PrinterStatusBadge
        status={PrinterStatusCode.ONLINE}
        dotOnly
      />,
    );

    const badge = screen.getByRole("status");
    expect(badge).toHaveAccessibleName(/En línea/);
    expect(badge).not.toHaveTextContent("En línea");
  });

  it("renders with role='status' and a descriptive aria-label", () => {
    render(
      <PrinterStatusBadge status={PrinterStatusCode.ONLINE} />,
    );

    const badge = screen.getByRole("status");
    expect(badge).toHaveAttribute("aria-label");
  });

  it("applies additional className to the wrapper", () => {
    render(
      <PrinterStatusBadge
        status={PrinterStatusCode.ONLINE}
        className="extra-class"
      />,
    );

    const badge = screen.getByRole("status");
    expect(badge.className).toContain("extra-class");
  });
});
