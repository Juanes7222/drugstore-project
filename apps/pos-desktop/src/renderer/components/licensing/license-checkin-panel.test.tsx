/**
 * Component tests for LicenseCheckinPanel.
 *
 * Covers: last check-in date/time, days until expiry, 30-day check-in
 * count, grace period warning with AlertTriangle, grace-expired state,
 * healthy checkmark for ACTIVE, and null-value fallbacks.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LicenseStatus } from "@pharmacy/shared-types";
import { LicenseCheckinPanel } from "./license-checkin-panel";

// i18n singleton initialized via vitest.setup.ts

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function defaultProps() {
  return {
    status: LicenseStatus.ACTIVE,
    lastCheckInAt: "2026-07-25T14:30:00.000Z",
    daysUntilExpiry: 90,
    daysUntilGracePeriodEnd: null,
    checkInsLast30Days: 12,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("LicenseCheckinPanel", () => {
  // -----------------------------------------------------------------------
  // Last check-in display
  // -----------------------------------------------------------------------

  describe("last check-in", () => {
    it("renders the last check-in date and time", () => {
      render(<LicenseCheckinPanel {...defaultProps()} />);

      expect(screen.getByText("Último check-in:")).toBeInTheDocument();
      // formatDateTime renders in es-ES: DD/MM/YYYY, HH:mm
      expect(screen.getByText(/25\/07\/2026/)).toBeInTheDocument();
    });

    it("renders a dash when lastCheckInAt is null", () => {
      render(
        <LicenseCheckinPanel {...defaultProps()} lastCheckInAt={null} />,
      );

      // formatDateTime(null) returns "—"
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Days until expiry
  // -----------------------------------------------------------------------

  describe("days until expiry", () => {
    it("renders days until expiry as a number", () => {
      render(<LicenseCheckinPanel {...defaultProps()} daysUntilExpiry={90} />);

      expect(screen.getByText("Días hasta vencimiento:")).toBeInTheDocument();
      expect(screen.getByText("90")).toBeInTheDocument();
    });

    it("renders a dash when daysUntilExpiry is null", () => {
      render(
        <LicenseCheckinPanel {...defaultProps()} daysUntilExpiry={null} />,
      );

      const dashes = screen.getAllByText("—");
      // At least the days-until-expiry value is a dash
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });

    it("renders a dash when daysUntilExpiry is undefined", () => {
      render(
        <LicenseCheckinPanel
          {...defaultProps()}
          daysUntilExpiry={undefined as unknown as number}
        />,
      );

      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Check-in count (last 30 days)
  // -----------------------------------------------------------------------

  describe("check-in count", () => {
    it("renders check-in count for the last 30 days", () => {
      render(
        <LicenseCheckinPanel {...defaultProps()} checkInsLast30Days={12} />,
      );

      expect(
        screen.getByText("Check-ins últimos 30 días:"),
      ).toBeInTheDocument();
      expect(screen.getByText("12")).toBeInTheDocument();
    });

    it("renders zero when no check-ins in the last 30 days", () => {
      render(
        <LicenseCheckinPanel {...defaultProps()} checkInsLast30Days={0} />,
      );

      expect(screen.getByText("0")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Grace period warning
  // -----------------------------------------------------------------------

  describe("grace period section", () => {
    it("shows grace period warning with AlertTriangle icon when in GRACE_PERIOD", () => {
      render(
        <LicenseCheckinPanel
          {...defaultProps()}
          status={LicenseStatus.GRACE_PERIOD}
          daysUntilGracePeriodEnd={5}
        />,
      );

      expect(screen.getByText("Fin del período de gracia:")).toBeInTheDocument();
      expect(screen.getByText("5 días restantes")).toBeInTheDocument();

      const triangleIcon = document.querySelector("svg.lucide-triangle-alert");
      expect(triangleIcon).toBeInTheDocument();
      expect(triangleIcon).toHaveAttribute("aria-hidden", "true");
    });

    it("shows grace expired text when grace days <= 0", () => {
      render(
        <LicenseCheckinPanel
          {...defaultProps()}
          status={LicenseStatus.GRACE_PERIOD}
          daysUntilGracePeriodEnd={0}
        />,
      );

      expect(
        screen.getByText("Período de gracia vencido"),
      ).toBeInTheDocument();
    });

    it("does NOT show grace period section when status is ACTIVE", () => {
      render(<LicenseCheckinPanel {...defaultProps()} />);

      expect(
        screen.queryByText("Fin del período de gracia:"),
      ).not.toBeInTheDocument();
    });

    it("does NOT show grace period section when daysUntilGracePeriodEnd is null even in GRACE_PERIOD", () => {
      render(
        <LicenseCheckinPanel
          {...defaultProps()}
          status={LicenseStatus.GRACE_PERIOD}
          daysUntilGracePeriodEnd={null}
        />,
      );

      expect(
        screen.queryByText("Fin del período de gracia:"),
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Healthy status indicator (ACTIVE only)
  // -----------------------------------------------------------------------

  describe("healthy indicator", () => {
    it("shows healthy checkmark text when status is ACTIVE", () => {
      render(<LicenseCheckinPanel {...defaultProps()} />);

      expect(
        screen.getByText(/Todo al día/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/check-in funciona correctamente/),
      ).toBeInTheDocument();
    });

    it("shows CheckCircle2 icon for active healthy status", () => {
      render(<LicenseCheckinPanel {...defaultProps()} />);

      const checkIcon = document.querySelector("svg.lucide-circle-check");
      expect(checkIcon).toBeInTheDocument();
    });

    it("does NOT show healthy indicator when status is GRACE_PERIOD", () => {
      render(
        <LicenseCheckinPanel
          {...defaultProps()}
          status={LicenseStatus.GRACE_PERIOD}
          daysUntilGracePeriodEnd={5}
        />,
      );

      expect(
        screen.queryByText(/Todo al día/),
      ).not.toBeInTheDocument();
    });

    it("does NOT show healthy indicator when status is LOCKED", () => {
      render(
        <LicenseCheckinPanel
          {...defaultProps()}
          status={LicenseStatus.LOCKED}
          daysUntilExpiry={null}
        />,
      );

      expect(
        screen.queryByText(/Todo al día/),
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Panel header
  // -----------------------------------------------------------------------

  describe("panel header", () => {
    it("renders the section title with History icon", () => {
      render(<LicenseCheckinPanel {...defaultProps()} />);

      expect(
        screen.getByText("Historial de check-in"),
      ).toBeInTheDocument();

      const headerIcon = document.querySelector("svg.lucide-history");
      expect(headerIcon).toBeInTheDocument();
      expect(headerIcon).toHaveAttribute("aria-hidden", "true");
    });
  });
});
