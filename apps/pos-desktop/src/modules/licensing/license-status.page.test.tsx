/**
 * Component tests for LicenseStatusPage.
 *
 * Covers: status badge rendering for each license status, plan details,
 * location/workstation info, check-in history panels, grace period
 * visibility, and action buttons (renew + export).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LicenseStatus } from "@pharmacy/shared-types";
import { useLicenseStore } from "../../domain/licensing/license.store";
import { LicenseStatusPage } from "./license-status.page";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockCheckIn = vi.hoisted(() => vi.fn());

vi.mock("../../domain/licensing/license.service", () => ({
  createLicenseService: vi.fn(() => ({
    activate: vi.fn(),
    checkIn: mockCheckIn,
    getStatus: vi.fn(),
    getSummary: vi.fn(),
    refreshStatus: vi.fn(),
    requireValidLicense: vi.fn(),
    validateTokenLocally: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface ActivatedStoreParams {
  status?: LicenseStatus;
  daysUntilExpiry?: number;
  daysUntilGracePeriodEnd?: number | null;
  checkInsLast30Days?: number;
}

function setActivatedStore(params: ActivatedStoreParams = {}): void {
  const {
    status = LicenseStatus.ACTIVE,
    daysUntilExpiry,
    daysUntilGracePeriodEnd,
    checkInsLast30Days = 12,
  } = params;

  useLicenseStore.getState().setActivated({
    activationToken: "token",
    expiresAt: "2027-01-01T00:00:00.000Z",
    subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
    plan: {
      id: "p-1",
      code: "PREMIUM",
      name: "Premium",
      features: ["MULTI_LOCATION", "ADVANCED_REPORTS"],
      maxLocations: 5,
      maxWorkstationsPerLocation: 3,
    },
    location: {
      id: "loc-1",
      name: "Farmacia Central",
      address: "Av. Siempre Viva 123",
      city: "Buenos Aires",
      region: "CABA",
    },
    workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-15T10:00:00.000Z" },
    hardwareFingerprint: "fp-001",
  });

  // Override check-in count
  useLicenseStore.getState().updateCheckInCount(checkInsLast30Days);

  // Override specific fields — write them after activation so they take effect
  useLicenseStore.setState({
    daysUntilExpiry,
    daysUntilGracePeriodEnd,
  });

  // Transition to the requested status if not ACTIVE
  if (status === LicenseStatus.GRACE_PERIOD) {
    useLicenseStore.getState().setGracePeriod(daysUntilGracePeriodEnd ?? 5);
  } else if (status === LicenseStatus.LOCKED) {
    useLicenseStore.getState().setLocked();
  } else if (status === LicenseStatus.REVOKED) {
    useLicenseStore.getState().setRevoked();
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("LicenseStatusPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.getState().reset();
    mockCheckIn.mockReset();
  });

  // -----------------------------------------------------------------------
  // Structure
  // -----------------------------------------------------------------------

  describe("structure", () => {
    it("renders the page title", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByRole("heading", { name: "Estado de Licencia" }),
      ).toBeInTheDocument();
    });

    it("renders the plan section panel", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText("Plan contratado"),
      ).toBeInTheDocument();
    });

    it("renders the location and workstation panel", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText("Asignación"),
      ).toBeInTheDocument();
    });

    it("renders the check-in history panel", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText("Historial de check-in"),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Status badge
  // -----------------------------------------------------------------------

  describe("status badge", () => {
    it("shows 'Activa hasta' for ACTIVE status", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText(/Activa hasta/i),
      ).toBeInTheDocument();
    });

    it("shows 'En período de gracia' for GRACE_PERIOD status", () => {
      setActivatedStore({ status: LicenseStatus.GRACE_PERIOD, daysUntilGracePeriodEnd: 3 });
      render(<LicenseStatusPage />);

      // Both the status badge and the grace section label contain "período de gracia"
      const matches = screen.getAllByText(/período de gracia/i);
      expect(matches.length).toBeGreaterThanOrEqual(2);
      expect(matches[0]).toBeVisible();
    });

    it("shows 'Bloqueada' for LOCKED status", () => {
      setActivatedStore({ status: LicenseStatus.LOCKED });
      render(<LicenseStatusPage />);

      expect(
        screen.getByText(/Bloqueada/i),
      ).toBeInTheDocument();
    });

    it("shows 'Revocada' for REVOKED status", () => {
      setActivatedStore({ status: LicenseStatus.REVOKED });
      render(<LicenseStatusPage />);

      expect(
        screen.getByText(/Revocada/i),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Plan details
  // -----------------------------------------------------------------------

  describe("plan details", () => {
    it("displays the plan name", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText("Premium"),
      ).toBeInTheDocument();
    });

    it("displays plan capacity info", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText(/5 local.*3 puesto/i),
      ).toBeInTheDocument();
    });

    it("renders feature checkmarks", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText("Múltiples locales"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Reportes avanzados"),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Location and workstation
  // -----------------------------------------------------------------------

  describe("location and workstation info", () => {
    it("displays the location name and address", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText(/Farmacia Central.*Av. Siempre Viva 123.*Buenos Aires.*CABA/),
      ).toBeInTheDocument();
    });

    it("displays the workstation name and activation date", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText(/Caja-01/),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Check-in history
  // -----------------------------------------------------------------------

  describe("check-in history", () => {
    it("shows the number of check-ins in the last 30 days", () => {
      setActivatedStore({ checkInsLast30Days: 12 });
      render(<LicenseStatusPage />);

      expect(
        screen.getByText("12"),
      ).toBeInTheDocument();
    });

    it("shows an em dash when daysUntilExpiry is null", () => {
      setActivatedStore({ daysUntilExpiry: undefined as unknown as number });
      render(<LicenseStatusPage />);

      // The value should show "—" which is the em dash rendered by formatDate
      const emDash = screen.queryByText("—");
      expect(emDash).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Grace period section
  // -----------------------------------------------------------------------

  describe("grace period details", () => {
    it("shows grace period details only when status is GRACE_PERIOD", () => {
      setActivatedStore({ status: LicenseStatus.GRACE_PERIOD, daysUntilGracePeriodEnd: 3 });
      render(<LicenseStatusPage />);

      expect(
        screen.getByText(/Fin del período de gracia/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/3 días restantes/i),
      ).toBeInTheDocument();
    });

    it("does not show grace period details when status is ACTIVE", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.queryByText(/Fin del período de gracia/i),
      ).not.toBeInTheDocument();
    });

    it("shows 'Período de gracia vencido' when days are zero or negative", () => {
      setActivatedStore({ status: LicenseStatus.GRACE_PERIOD, daysUntilGracePeriodEnd: 0 });
      render(<LicenseStatusPage />);

      expect(
        screen.getByText(/Período de gracia vencido/i),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Action buttons
  // -----------------------------------------------------------------------

  describe("renew button", () => {
    it("renders the 'Renovar ahora' button when activation token exists", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByRole("button", { name: /Renovar ahora/i }),
      ).toBeInTheDocument();
    });

    it("renders the renew button as disabled when there is no token", () => {
      // Store is UNACTIVATED — no token
      useLicenseStore.getState().reset();
      render(<LicenseStatusPage />);

      expect(
        screen.getByRole("button", { name: /Renovar ahora/i }),
      ).toBeDisabled();
    });

    it("calls checkIn on the license service when clicked", async () => {
      mockCheckIn.mockResolvedValue({
        activationToken: "new-token",
        expiresAt: "2027-06-01T00:00:00.000Z",
        licenseStatus: "ACTIVE",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-06-01T00:00:00.000Z", gracePeriodDays: 7 },
        daysUntilGracePeriodEnd: null,
      });

      setActivatedStore();
      render(<LicenseStatusPage />);

      const renewButton = screen.getByRole("button", { name: /Renovar ahora/i });
      fireEvent.click(renewButton);

      await waitFor(() => {
        expect(mockCheckIn).toHaveBeenCalledOnce();
      });
    });

    it("shows success message after a successful check-in", async () => {
      mockCheckIn.mockResolvedValue({
        activationToken: "new-token",
        expiresAt: "2027-06-01T00:00:00.000Z",
        licenseStatus: "ACTIVE",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-06-01T00:00:00.000Z", gracePeriodDays: 7 },
        daysUntilGracePeriodEnd: null,
      });

      setActivatedStore();
      render(<LicenseStatusPage />);

      const renewButton = screen.getByRole("button", { name: /Renovar ahora/i });
      fireEvent.click(renewButton);

      await waitFor(() => {
        expect(
          screen.getByText("Check-in realizado correctamente."),
        ).toBeInTheDocument();
      });
    });

    it("shows error message after a failed check-in", async () => {
      mockCheckIn.mockRejectedValue(new Error("Network error"));

      setActivatedStore();
      render(<LicenseStatusPage />);

      const renewButton = screen.getByRole("button", { name: /Renovar ahora/i });
      fireEvent.click(renewButton);

      await waitFor(() => {
        expect(
          screen.getByText(/No se pudo realizar el check-in/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("export button", () => {
    it("renders the 'Exportar datos' button", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByRole("button", { name: /Exportar datos/i }),
      ).toBeInTheDocument();
    });

    it("shows export triggered message on click", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      const exportButton = screen.getByRole("button", { name: /Exportar datos/i });
      fireEvent.click(exportButton);

      expect(
        screen.getByText(/Exportación iniciada/i),
      ).toBeInTheDocument();
    });
  });
});
