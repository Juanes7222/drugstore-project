/**
 * Component tests for LicenseAssignmentPanel.
 *
 * Covers: location string construction (full, partial, null),
 * workstation name display, activation date display, and
 * null-value fallbacks.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LicenseAssignmentPanel } from "./license-assignment-panel";

// i18n singleton initialized via vitest.setup.ts

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function defaultProps() {
  return {
    locationName: "Farmacia Central",
    locationAddress: "Av. Siempre Viva 123",
    locationCity: "Buenos Aires",
    locationRegion: "CABA",
    workstationName: "Caja-01",
    activatedAt: "2026-01-15T10:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("LicenseAssignmentPanel", () => {
  // -----------------------------------------------------------------------
  // Panel header
  // -----------------------------------------------------------------------

  describe("panel header", () => {
    it("renders the section title with Store icon", () => {
      render(<LicenseAssignmentPanel {...defaultProps()} />);

      expect(screen.getByText("Asignación")).toBeInTheDocument();

      const headerIcon = document.querySelector("svg.lucide-store");
      expect(headerIcon).toBeInTheDocument();
      expect(headerIcon).toHaveAttribute("aria-hidden", "true");
    });
  });

  // -----------------------------------------------------------------------
  // Location display
  // -----------------------------------------------------------------------

  describe("location display", () => {
    it("renders full location string with all fields", () => {
      render(<LicenseAssignmentPanel {...defaultProps()} />);

      expect(screen.getByText("Local:")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Farmacia Central, Av. Siempre Viva 123, Buenos Aires, CABA",
        ),
      ).toBeInTheDocument();
    });

    it("renders partial location when some fields are null", () => {
      render(
        <LicenseAssignmentPanel
          {...defaultProps()}
          locationAddress={null}
          locationRegion={null}
        />,
      );

      expect(
        screen.getByText("Farmacia Central, Buenos Aires"),
      ).toBeInTheDocument();
    });

    it("renders a single field when only one is provided", () => {
      render(
        <LicenseAssignmentPanel
          {...defaultProps()}
          locationName={null}
          locationAddress={null}
          locationCity={null}
          locationRegion="CABA"
        />,
      );

      expect(screen.getByText("CABA")).toBeInTheDocument();
    });

    it("renders a dash when no location fields are provided", () => {
      render(
        <LicenseAssignmentPanel
          {...defaultProps()}
          locationName={null}
          locationAddress={null}
          locationCity={null}
          locationRegion={null}
        />,
      );

      // The "—" dash is rendered when locationDisplay is null
      const dashes = screen.getAllByText("—");
      // Among other potential dashes, one belongs to the location
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Workstation display
  // -----------------------------------------------------------------------

  describe("workstation display", () => {
    it("renders the workstation name", () => {
      render(<LicenseAssignmentPanel {...defaultProps()} workstationName="Caja-01" />);

      expect(screen.getByText("Puesto:")).toBeInTheDocument();
      expect(screen.getByText("Caja-01")).toBeInTheDocument();
    });

    it("renders a dash when workstation name is null", () => {
      render(
        <LicenseAssignmentPanel {...defaultProps()} workstationName={null} />,
      );

      // The "—" next to the workstation label
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Activation date
  // -----------------------------------------------------------------------

  describe("activation date", () => {
    it("renders the activated date", () => {
      render(<LicenseAssignmentPanel {...defaultProps()} />);

      expect(screen.getByText("Activado el")).toBeInTheDocument();
      // formatDate renders in es-ES: "15 de enero de 2026"
      expect(screen.getByText(/enero de 2026/)).toBeInTheDocument();
    });

    it("does not show activated date when activatedAt is null", () => {
      render(
        <LicenseAssignmentPanel {...defaultProps()} activatedAt={null} />,
      );

      expect(screen.queryByText("Activado el")).not.toBeInTheDocument();
    });

    it("does not show activated date when activatedAt is an empty string", () => {
      render(
        <LicenseAssignmentPanel {...defaultProps()} activatedAt="" />,
      );

      // activatedAt is falsy (empty string), so the block is not rendered
      expect(screen.queryByText("Activado el")).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Icon usage
  // -----------------------------------------------------------------------

  describe("icons", () => {
    it("renders Monitor icon for workstation", () => {
      render(<LicenseAssignmentPanel {...defaultProps()} />);

      const monitorIcon = document.querySelector("svg.lucide-monitor");
      expect(monitorIcon).toBeInTheDocument();
      expect(monitorIcon).toHaveAttribute("aria-hidden", "true");
    });

    it("renders Calendar icon when activatedAt is present", () => {
      render(<LicenseAssignmentPanel {...defaultProps()} />);

      const calendarIcon = document.querySelector("svg.lucide-calendar");
      expect(calendarIcon).toBeInTheDocument();
      expect(calendarIcon).toHaveAttribute("aria-hidden", "true");
    });
  });
});
