/**
 * Component tests for LicenseBanner.
 *
 * Covers every banner variant: upcoming-renewal (ACTIVE + near expiry + online),
 * GRACE_PERIOD (yellow), LOCKED (red), REVOKED (red), and the null/no-banner
 * cases for UNACTIVATED and ACTIVE + far-from-expiry or offline.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LicenseStatus } from "@pharmacy/shared-types";
import { useLicenseStore } from "../../domain/licensing/license.store";
import { LicenseBanner } from "./license-banner";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockUseOnlineStatus = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: mockUseOnlineStatus,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setBannerState(params: {
  status: LicenseStatus;
  daysUntilExpiry?: number | null;
  daysUntilGracePeriodEnd?: number | null;
  tokenExpiresAt?: string | null;
}): void {
  const {
    status,
    daysUntilExpiry = null,
    daysUntilGracePeriodEnd = null,
    tokenExpiresAt = "2027-01-01T00:00:00.000Z",
  } = params;

  useLicenseStore.setState({
    status,
    activationToken: status !== LicenseStatus.UNACTIVATED ? "token" : null,
    tokenExpiresAt,
    daysUntilExpiry,
    daysUntilGracePeriodEnd,
    subscriptionStatus:
      status === LicenseStatus.GRACE_PERIOD
        ? "PAST_DUE"
        : status === LicenseStatus.REVOKED
          ? "REVOKED"
          : "ACTIVE",
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("LicenseBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.getState().reset();
    mockUseOnlineStatus.mockReturnValue(true);
  });

  // -----------------------------------------------------------------------
  // UNACTIVATED
  // -----------------------------------------------------------------------

  describe("when UNACTIVATED", () => {
    it("renders nothing", () => {
      render(<LicenseBanner />);

      expect(
        screen.queryByRole("alert"),
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // LOCKED
  // -----------------------------------------------------------------------

  describe("when LOCKED", () => {
    it("renders a visible alert banner", () => {
      setBannerState({ status: LicenseStatus.LOCKED });
      render(<LicenseBanner />);

      const alert = screen.getByRole("alert");
      expect(alert).toBeVisible();
      expect(alert).toHaveTextContent(/Suscripción vencida/i);
      expect(alert).toHaveTextContent(/Contactá a tu proveedor/i);
    });
  });

  // -----------------------------------------------------------------------
  // REVOKED
  // -----------------------------------------------------------------------

  describe("when REVOKED", () => {
    it("renders a visible alert banner", () => {
      setBannerState({ status: LicenseStatus.REVOKED });
      render(<LicenseBanner />);

      const alert = screen.getByRole("alert");
      expect(alert).toBeVisible();
      expect(alert).toHaveTextContent(/licencia fue revocada/i);
      expect(alert).toHaveTextContent(/Contactá a tu proveedor/i);
    });
  });

  // -----------------------------------------------------------------------
  // GRACE_PERIOD
  // -----------------------------------------------------------------------

  describe("when GRACE_PERIOD", () => {
    it("renders a visible alert banner with grace period message", () => {
      setBannerState({
        status: LicenseStatus.GRACE_PERIOD,
        daysUntilGracePeriodEnd: 5,
        tokenExpiresAt: "2026-12-15T00:00:00.000Z",
      });
      render(<LicenseBanner />);

      const alert = screen.getByRole("alert");
      expect(alert).toBeVisible();
      expect(alert).toHaveTextContent(/Suscripción pendiente de pago/i);
      expect(alert).toHaveTextContent(/sigue funcionando/i);
      expect(alert).toHaveTextContent(/diciembre de 2026/i);
    });

    it("shows grace_expired message when daysUntilGracePeriodEnd <= 0", () => {
      setBannerState({
        status: LicenseStatus.GRACE_PERIOD,
        daysUntilGracePeriodEnd: 0,
      });
      render(<LicenseBanner />);

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(/Suscripción pendiente de pago/i);
      expect(alert).toHaveTextContent(/Contactá a tu proveedor/i);
    });
  });

  // -----------------------------------------------------------------------
  // ACTIVE — upcoming renewal
  // -----------------------------------------------------------------------

  describe("when ACTIVE and within 7 days of expiry", () => {
    it("shows an upcoming renewal banner when online", () => {
      mockUseOnlineStatus.mockReturnValue(true);
      setBannerState({
        status: LicenseStatus.ACTIVE,
        daysUntilExpiry: 3,
        tokenExpiresAt: "2026-07-13T00:00:00.000Z",
      });
      render(<LicenseBanner />);

      const alert = screen.getByRole("alert");
      expect(alert).toBeVisible();
      expect(alert).toHaveTextContent(/suscripción se renueva/i);
      expect(alert).toHaveTextContent(/julio de 2026/i);
    });

    it("does not show a banner when offline even if near expiry", () => {
      mockUseOnlineStatus.mockReturnValue(false);
      setBannerState({
        status: LicenseStatus.ACTIVE,
        daysUntilExpiry: 3,
      });
      render(<LicenseBanner />);

      expect(
        screen.queryByRole("alert"),
      ).not.toBeInTheDocument();
    });

    it("does not show a banner when daysUntilExpiry is null", () => {
      mockUseOnlineStatus.mockReturnValue(true);
      setBannerState({
        status: LicenseStatus.ACTIVE,
        daysUntilExpiry: null,
      });
      render(<LicenseBanner />);

      expect(
        screen.queryByRole("alert"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when ACTIVE and far from expiry", () => {
    it("does not render a banner", () => {
      setBannerState({
        status: LicenseStatus.ACTIVE,
        daysUntilExpiry: 30,
      });
      render(<LicenseBanner />);

      expect(
        screen.queryByRole("alert"),
      ).not.toBeInTheDocument();
    });
  });
});
