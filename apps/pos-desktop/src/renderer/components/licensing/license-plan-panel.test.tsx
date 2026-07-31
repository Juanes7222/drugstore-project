/**
 * Component tests for LicensePlanPanel.
 *
 * Covers: plan name fallback chain, max locations/workstations display,
 * feature list rendering with CheckCircle2 icons and translated labels,
 * and empty/null states.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LicensePlanPanel } from "./license-plan-panel";

// i18n singleton initialized via vitest.setup.ts

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function defaultProps() {
  return {
    planName: "Premium",
    planCode: "PREMIUM",
    planFeatures: ["MULTI_LOCATION", "ADVANCED_REPORTS"],
    maxLocations: 5,
    maxWorkstationsPerLocation: 3,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("LicensePlanPanel", () => {
  // -----------------------------------------------------------------------
  // Panel header
  // -----------------------------------------------------------------------

  describe("panel header", () => {
    it("renders the section title with CheckCircle2 icon", () => {
      render(<LicensePlanPanel {...defaultProps()} />);

      expect(screen.getByText("Plan contratado")).toBeInTheDocument();

      const headerIcon = document.querySelector("svg[data-icon=\"check-circle\"]");
      expect(headerIcon).toBeInTheDocument();
      expect(headerIcon).toHaveAttribute("aria-hidden", "true");
    });
  });

  // -----------------------------------------------------------------------
  // Plan name display
  // -----------------------------------------------------------------------

  describe("plan name", () => {
    it("renders planName when available", () => {
      render(<LicensePlanPanel {...defaultProps()} planName="Premium" />);

      expect(screen.getByText("Plan:")).toBeInTheDocument();
      expect(screen.getByText("Premium")).toBeInTheDocument();
    });

    it("falls back to planCode when planName is null", () => {
      render(
        <LicensePlanPanel
          {...defaultProps()}
          planName={null}
          planCode="PREMIUM"
        />,
      );

      expect(screen.getByText("PREMIUM")).toBeInTheDocument();
    });

    it("renders a dash when both planName and planCode are null", () => {
      render(
        <LicensePlanPanel
          {...defaultProps()}
          planName={null}
          planCode={null}
        />,
      );

      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("renders planName in font-data class for numerical tabular style", () => {
      render(<LicensePlanPanel {...defaultProps()} />);

      const planNameEl = screen.getByText("Premium");
      expect(planNameEl.classList.contains("font-data")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Capacity — max locations and workstations
  // -----------------------------------------------------------------------

  describe("capacity", () => {
    it("shows max locations count", () => {
      render(<LicensePlanPanel {...defaultProps()} maxLocations={5} />);

      expect(screen.getByText(/Hasta 5 local/)).toBeInTheDocument();
    });

    it("shows max workstations count", () => {
      render(
        <LicensePlanPanel {...defaultProps()} maxWorkstationsPerLocation={3} />,
      );

      expect(screen.getByText(/Hasta 3 puesto por local/)).toBeInTheDocument();
    });

    it("shows zero when maxLocations is null", () => {
      render(
        <LicensePlanPanel {...defaultProps()} maxLocations={null} />,
      );

      expect(screen.getByText(/Hasta 0 local/)).toBeInTheDocument();
    });

    it("shows zero when maxWorkstationsPerLocation is null", () => {
      render(
        <LicensePlanPanel
          {...defaultProps()}
          maxWorkstationsPerLocation={null}
        />,
      );

      expect(screen.getByText(/Hasta 0 puesto por local/)).toBeInTheDocument();
    });

    it("renders Building2 icon in capacity section", () => {
      render(<LicensePlanPanel {...defaultProps()} />);

      const buildingIcon = document.querySelector("svg[data-icon=\"building-2\"]");
      expect(buildingIcon).toBeInTheDocument();
      expect(buildingIcon).toHaveAttribute("aria-hidden", "true");
    });

    it("renders Monitor icon in capacity section", () => {
      render(<LicensePlanPanel {...defaultProps()} />);

      const monitorIcon = document.querySelector("svg[data-icon=\"monitor\"]");
      expect(monitorIcon).toBeInTheDocument();
      expect(monitorIcon).toHaveAttribute("aria-hidden", "true");
    });
  });

  // -----------------------------------------------------------------------
  // Feature list
  // -----------------------------------------------------------------------

  describe("feature list", () => {
    it("renders each feature with CheckCircle2 icon and translated label", () => {
      render(
        <LicensePlanPanel
          {...defaultProps()}
          planFeatures={["MULTI_LOCATION", "ADVANCED_REPORTS"]}
        />,
      );

      expect(
        screen.getByText("Características incluidas"),
      ).toBeInTheDocument();
      expect(screen.getByText("Múltiples locales")).toBeInTheDocument();
      expect(screen.getByText("Reportes avanzados")).toBeInTheDocument();

      // Each feature should have a CheckCircle2 icon
      const checkIcons = document.querySelectorAll("svg[data-icon=\"check-circle\"]");
      // One for the header, plus one per feature = 3
      expect(checkIcons.length).toBe(3);
    });

    it("each feature icon has aria-hidden", () => {
      render(
        <LicensePlanPanel
          {...defaultProps()}
          planFeatures={["MULTI_LOCATION"]}
        />,
      );

      const featureIcons = document.querySelectorAll("svg[data-icon=\"check-circle\"]");
      featureIcons.forEach((icon) => {
        expect(icon).toHaveAttribute("aria-hidden", "true");
      });
    });

    it("renders raw feature key when translation is missing", () => {
      render(
        <LicensePlanPanel
          {...defaultProps()}
          planFeatures={["UNKNOWN_FEATURE_KEY"]}
        />,
      );

      // Falls back to the raw key when FEATURE_LABELS has no mapping
      expect(screen.getByText("UNKNOWN_FEATURE_KEY")).toBeInTheDocument();
    });

    it("does not render the features section when features array is empty", () => {
      render(<LicensePlanPanel {...defaultProps()} planFeatures={[]} />);

      expect(
        screen.queryByText("Características incluidas"),
      ).not.toBeInTheDocument();
    });

    it("renders multiple features with individual list items", () => {
      render(
        <LicensePlanPanel
          {...defaultProps()}
          planFeatures={["MULTI_LOCATION", "MULTI_TERMINAL_SYNC"]}
        />,
      );

      const featureListItems = document.querySelectorAll("li");
      expect(featureListItems.length).toBe(2);

      expect(
        screen.getByText("Múltiples locales"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Sincronización multi-terminal"),
      ).toBeInTheDocument();
    });
  });
});
