/**
 * Component tests for LicenseHeroCard.
 *
 * Covers: status styles per LicenseStatus, plan name fallback chain,
 * expiry countdown, grace period countdown, grace-expired badge,
 * renewal-in-progress badge, and null/undefined days handling.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LicenseStatus } from "@pharmacy/shared-types";
import { LicenseHeroCard } from "./license-hero-card";

// i18n singleton initialized via vitest.setup.ts

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function defaultProps() {
  return {
    status: LicenseStatus.ACTIVE,
    planName: "Premium",
    planCode: "PREMIUM",
    tokenExpiresAt: "2027-06-15T00:00:00.000Z",
    daysUntilExpiry: 90,
    daysUntilGracePeriodEnd: null,
    isRenewalInProgress: false,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("LicenseHeroCard", () => {
  // -----------------------------------------------------------------------
  // Structure and accessibility
  // -----------------------------------------------------------------------

  describe("structure", () => {
    it("renders a status region with polite live region", () => {
      render(<LicenseHeroCard {...defaultProps()} />);

      const card = screen.getByRole("status");
      expect(card).toBeInTheDocument();
      expect(card).toHaveAttribute("aria-live", "polite");
    });

    it("renders the shield icon with aria-hidden", () => {
      render(<LicenseHeroCard {...defaultProps()} />);

      const card = screen.getByRole("status");
      const icon = card.querySelector("svg[data-icon=\"shield\"]");
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveAttribute("aria-hidden", "true");
    });
  });

  // -----------------------------------------------------------------------
  // Status styles — border and icon per LicenseStatus
  // -----------------------------------------------------------------------

  describe("status styles", () => {
    it("renders active status with pharma teal left border and Shield icon", () => {
      render(<LicenseHeroCard {...defaultProps()} status={LicenseStatus.ACTIVE} />);

      const card = screen.getByRole("status");
      expect(card.classList.contains("border-l-pharma")).toBe(true);
      expect(card.querySelector("svg[data-icon=\"shield\"]")).toBeInTheDocument();
    });

    it("renders grace period with urgency amber border and ShieldAlert icon", () => {
      render(
        <LicenseHeroCard
          {...defaultProps()}
          status={LicenseStatus.GRACE_PERIOD}
          daysUntilGracePeriodEnd={5}
        />,
      );

      const card = screen.getByRole("status");
      expect(card.classList.contains("border-l-urgency")).toBe(true);
      expect(card.querySelector("svg[data-icon=\"shield-alert\"]")).toBeInTheDocument();
    });

    it("renders locked status with error red border and ShieldOff icon", () => {
      render(
        <LicenseHeroCard
          {...defaultProps()}
          status={LicenseStatus.LOCKED}
          daysUntilExpiry={null}
        />,
      );

      const card = screen.getByRole("status");
      expect(card.classList.contains("border-l-error")).toBe(true);
      expect(card.querySelector("svg[data-icon=\"shield-off\"]")).toBeInTheDocument();
    });

    it("renders revoked status with error red border and ShieldOff icon", () => {
      render(
        <LicenseHeroCard
          {...defaultProps()}
          status={LicenseStatus.REVOKED}
          daysUntilExpiry={null}
        />,
      );

      const card = screen.getByRole("status");
      expect(card.classList.contains("border-l-error")).toBe(true);
      expect(card.querySelector("svg[data-icon=\"shield-off\"]")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Plan name display
  // -----------------------------------------------------------------------

  describe("plan name", () => {
    it("shows planName when available", () => {
      render(<LicenseHeroCard {...defaultProps()} planName="Premium" />);

      expect(screen.getByText("Premium")).toBeInTheDocument();
    });

    it("falls back to planCode when planName is null", () => {
      render(
        <LicenseHeroCard
          {...defaultProps()}
          planName={null}
          planCode="PREMIUM"
        />,
      );

      expect(screen.getByText("PREMIUM")).toBeInTheDocument();
    });

    it("shows the i18n fallback when both planName and planCode are null", () => {
      render(
        <LicenseHeroCard
          {...defaultProps()}
          planName={null}
          planCode={null}
        />,
      );

      expect(screen.getByText("Sin plan")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Status label
  // -----------------------------------------------------------------------

  describe("status label", () => {
    it("shows active label with expiry date", () => {
      render(<LicenseHeroCard {...defaultProps()} />);

      expect(screen.getByText(/Activa hasta/i)).toBeInTheDocument();
    });

    it("shows grace period label", () => {
      render(
        <LicenseHeroCard
          {...defaultProps()}
          status={LicenseStatus.GRACE_PERIOD}
          daysUntilGracePeriodEnd={5}
        />,
      );

      expect(screen.getByText(/período de gracia/i)).toBeInTheDocument();
    });

    it("shows locked label", () => {
      render(
        <LicenseHeroCard
          {...defaultProps()}
          status={LicenseStatus.LOCKED}
          daysUntilExpiry={null}
        />,
      );

      expect(screen.getByText(/Bloqueada/i)).toBeInTheDocument();
    });

    it("shows revoked label", () => {
      render(
        <LicenseHeroCard
          {...defaultProps()}
          status={LicenseStatus.REVOKED}
          daysUntilExpiry={null}
        />,
      );

      expect(screen.getByText(/Revocada/i)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Expiry countdown
  // -----------------------------------------------------------------------

  describe("expiry countdown", () => {
    it("shows days until expiry in font-data for ACTIVE status", () => {
      render(<LicenseHeroCard {...defaultProps()} daysUntilExpiry={90} />);

      const daysEl = screen.getByText("90");
      expect(daysEl.classList.contains("font-data")).toBe(true);
      expect(screen.getByText("días restantes")).toBeInTheDocument();
    });

    it("shows grace period days countdown when in GRACE_PERIOD status", () => {
      render(
        <LicenseHeroCard
          {...defaultProps()}
          status={LicenseStatus.GRACE_PERIOD}
          daysUntilGracePeriodEnd={7}
        />,
      );

      const daysEl = screen.getByText("7");
      expect(daysEl.classList.contains("font-data")).toBe(true);
      expect(screen.getByText("días de gracia")).toBeInTheDocument();
    });

    it("shows grace expired badge when grace days <= 0", () => {
      render(
        <LicenseHeroCard
          {...defaultProps()}
          status={LicenseStatus.GRACE_PERIOD}
          daysUntilGracePeriodEnd={0}
        />,
      );

      expect(screen.getByText("Período de gracia vencido")).toBeInTheDocument();
    });

    it("does not render countdown for LOCKED status", () => {
      render(
        <LicenseHeroCard
          {...defaultProps()}
          status={LicenseStatus.LOCKED}
          daysUntilExpiry={null}
        />,
      );

      expect(screen.queryByText("días restantes")).not.toBeInTheDocument();
      expect(screen.queryByText("días de gracia")).not.toBeInTheDocument();
    });

    it("shows single dash when days is null", () => {
      render(
        <LicenseHeroCard {...defaultProps()} daysUntilExpiry={null} />,
      );

      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("shows single dash when days is undefined", () => {
      render(
        <LicenseHeroCard
          {...defaultProps()}
          daysUntilExpiry={undefined as unknown as number}
        />,
      );

      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Renewal in progress badge
  // -----------------------------------------------------------------------

  describe("renewal badge", () => {
    it("shows renewal in progress badge when isRenewalInProgress is true", () => {
      render(
        <LicenseHeroCard {...defaultProps()} isRenewalInProgress={true} />,
      );

      expect(screen.getByText("Renovación en curso")).toBeInTheDocument();
    });

    it("does not show renewal badge when isRenewalInProgress is false", () => {
      render(
        <LicenseHeroCard {...defaultProps()} isRenewalInProgress={false} />,
      );

      expect(
        screen.queryByText("Renovación en curso"),
      ).not.toBeInTheDocument();
    });
  });
});
