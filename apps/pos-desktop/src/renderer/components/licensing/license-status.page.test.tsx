/**
 * Component tests for LicenseStatusPage — the merged "Suscripción" screen.
 *
 * Covers: the subscription title, status hero per license state, current-plan
 * benefits, the switch-plan ledger wiring (catalog fetch, offline fallback,
 * candidate checkout hand-off), the collapsed technical-details block, and
 * the check-in/export actions.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LicenseStatus } from "@pharmacy/shared-types";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { LicenseStatusPage } from "./license-status.page";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockCheckIn = vi.hoisted(() => vi.fn());
const mockCheckoutService = vi.hoisted(() => ({
  fetchPlans: vi.fn(),
  createSession: vi.fn(),
  pollSession: vi.fn(),
  pollUntilTerminal: vi.fn(),
}));
const mockDispatch = vi.hoisted(() => vi.fn());

vi.mock("../../../domain/licensing/license.service", () => ({
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

vi.mock(
  "../../../domain/licensing/wompi-checkout.service",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../domain/licensing/wompi-checkout.service")
    >();
    return {
      ...actual,
      createWompiCheckoutService: vi.fn(() => mockCheckoutService),
    };
  },
);

vi.mock("react-redux", () => ({
  useDispatch: () => mockDispatch,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCatalogPlan(overrides?: {
  code?: string;
  name?: string;
  basePriceCents?: number;
  billingMethod?: string | null;
  features?: string[];
  maxLocations?: number;
  includedWorkstations?: number;
  displayOrder?: number;
}): {
  code: string;
  name: string;
  description: string;
  pricingModel: string;
  basePriceCents: number;
  currency: string;
  billingPeriod: string;
  maxLocations: number | null;
  includedWorkstations: number;
  extraWorkstationPriceCents: number | null;
  features: string[];
  displayOrder: number;
  billingMethod: string | null;
} {
  return {
    code: "PREMIUM",
    name: "Premium",
    description: "Plan intermedio",
    pricingModel: "SUBSCRIPTION",
    basePriceCents: 199_900,
    currency: "COP",
    billingPeriod: "MONTHLY",
    maxLocations: 5,
    includedWorkstations: 3,
    extraWorkstationPriceCents: null,
    features: ["MULTI_LOCATION", "ADVANCED_REPORTS"],
    displayOrder: 1,
    billingMethod: "PROVIDER",
    ...overrides,
  };
}

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
      billingMethod: "PROVIDER",
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

  useLicenseStore.setState({
    daysUntilExpiry,
    daysUntilGracePeriodEnd,
  });

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
    mockDispatch.mockClear();
    mockCheckoutService.fetchPlans.mockReset();
    mockCheckoutService.createSession.mockReset();
    mockCheckoutService.pollSession.mockReset();
    mockCheckoutService.pollUntilTerminal.mockReset();

    mockCheckoutService.fetchPlans.mockResolvedValue([
      makeCatalogPlan(),
      makeCatalogPlan({
        code: "ENTERPRISE",
        name: "Enterprise",
        basePriceCents: 299_900,
        displayOrder: 2,
        billingMethod: "CERTIFICATE",
        features: ["MULTI_LOCATION", "ADVANCED_REPORTS", "API_ACCESS"],
        maxLocations: 999,
        includedWorkstations: 10,
      }),
    ]);
  });

  // -----------------------------------------------------------------------
  // Structure
  // -----------------------------------------------------------------------

  describe("structure", () => {
    it("renders the merged screen under the Suscripción title", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByRole("heading", { name: "Suscripción" }),
      ).toBeInTheDocument();
    });

    it("renders the hero card with the plan name", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(screen.getByText("Premium")).toBeInTheDocument();
    });

    it("renders the current-plan benefits panel", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText("Características incluidas"),
      ).toBeInTheDocument();
      expect(screen.getByText(/Hasta 5 local/i)).toBeInTheDocument();
    });

    it("renders the switch-plan section", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByRole("region", { name: "Cambiar de plan" }),
      ).toBeInTheDocument();
    });

    it("keeps assignment and check-in panels inside the technical details block", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText("Detalles técnicos (asignación y check-ins)"),
      ).toBeInTheDocument();
      expect(screen.getByText("Asignación")).toBeInTheDocument();
      expect(screen.getByText("Historial de check-in")).toBeInTheDocument();
    });

    it("no longer renders the standalone plan panel", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      // "Plan contratado" belongs to the removed LicensePlanPanel.
      expect(screen.queryByText("Plan contratado")).not.toBeInTheDocument();
    });

    it("renders the not-activated view when the store has no license", () => {
      useLicenseStore.getState().reset();
      render(<LicenseStatusPage />);

      expect(
        screen.getByRole("heading", { name: "Suscripción" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Este equipo no tiene una licencia activa/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Renovar ahora/i }),
      ).not.toBeInTheDocument();
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
  // Current plan benefits
  // -----------------------------------------------------------------------

  describe("current plan benefits", () => {
    it("displays plan capacity info", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText(/5 local/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/3 puesto/i),
      ).toBeInTheDocument();
    });

    it("renders feature chips for the active plan's features", () => {
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
  // Switch-plan ledger
  // -----------------------------------------------------------------------

  describe("switch-plan ledger", () => {
    it("offers only the other catalog plans as candidates", async () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      await waitFor(() => {
        expect(mockCheckoutService.fetchPlans).toHaveBeenCalledOnce();
      });
      expect(
        await screen.findByRole("heading", { name: "Enterprise" }),
      ).toBeInTheDocument();
      // The current plan is only in the hero (h2), never offered as a
      // candidate card (h3).
      expect(
        screen.queryByRole("heading", { level: 3, name: "Premium" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getAllByRole("button", { name: "Cambiar a este plan" }),
      ).toHaveLength(1);
    });

    it("mounts the shared checkout customer step when a candidate is chosen", async () => {
      const user = userEvent.setup();
      setActivatedStore();
      render(<LicenseStatusPage />);

      await user.click(
        await screen.findByRole("button", { name: "Cambiar a este plan" }),
      );

      expect(
        await screen.findByRole("heading", { name: "Datos de facturación" }),
      ).toBeInTheDocument();
      // Enterprise monthly: 299_900 cents → $ 2.999.
      expect(await screen.findByText("$ 2.999")).toBeInTheDocument();
    });

    it("shows a calm status note and keeps benefits visible when the catalog fails", async () => {
      mockCheckoutService.fetchPlans.mockRejectedValue(new Error("offline"));

      setActivatedStore();
      render(<LicenseStatusPage />);

      const noteTitle = await screen.findByText("No pudimos cargar los planes");
      const status = noteTitle.closest('[role="status"]');
      expect(status).not.toBeNull();
      expect(status).toHaveTextContent(/Comparar planes necesita conexión/);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // Benefits stay usable without the catalog.
      expect(screen.getByText(/Hasta 5 local/i)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Location and workstation info
  // -----------------------------------------------------------------------

  describe("location and workstation info", () => {
    it("displays the location name and address", () => {
      setActivatedStore();
      render(<LicenseStatusPage />);

      expect(
        screen.getByText(/Farmacia Central.*Av\. Siempre Viva 123.*Buenos Aires.*CABA/),
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

      // The em dash appears in HeroCard (days countdown) and CheckinPanel
      // (days until expiry) — both render it when the value is null.
      const emDashes = screen.getAllByText("—");
      expect(emDashes.length).toBeGreaterThanOrEqual(2);
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

    it("shows 'Período de gracia vencido' when days are zero or negative", async () => {
      const user = userEvent.setup();
      setActivatedStore({ status: LicenseStatus.GRACE_PERIOD, daysUntilGracePeriodEnd: 0 });
      render(<LicenseStatusPage />);

      // The check-in copy lives inside the collapsed technical-details
      // block; open it so both occurrences are visible.
      await user.click(screen.getByText("Detalles técnicos (asignación y check-ins)"));

      const matches = screen.getAllByText(/Período de gracia vencido/i);
      expect(matches.length).toBeGreaterThanOrEqual(2);
      matches.forEach((el) => expect(el).toBeVisible());
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

    it("calls checkIn on the license service when clicked", async () => {
      const user = userEvent.setup();
      mockCheckIn.mockResolvedValue({
        activationToken: "new-token",
        expiresAt: "2027-06-01T00:00:00.000Z",
        licenseStatus: "ACTIVE",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-06-01T00:00:00.000Z", gracePeriodDays: 7 },
        daysUntilGracePeriodEnd: null,
      });

      setActivatedStore();
      render(<LicenseStatusPage />);

      await user.click(screen.getByRole("button", { name: /Renovar ahora/i }));

      await waitFor(() => {
        expect(mockCheckIn).toHaveBeenCalledOnce();
      });
    });

    it("shows success message after a successful check-in", async () => {
      const user = userEvent.setup();
      mockCheckIn.mockResolvedValue({
        activationToken: "new-token",
        expiresAt: "2027-06-01T00:00:00.000Z",
        licenseStatus: "ACTIVE",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-06-01T00:00:00.000Z", gracePeriodDays: 7 },
        daysUntilGracePeriodEnd: null,
      });

      setActivatedStore();
      render(<LicenseStatusPage />);

      await user.click(screen.getByRole("button", { name: /Renovar ahora/i }));

      await waitFor(() => {
        expect(
          screen.getByText("Check-in realizado correctamente."),
        ).toBeInTheDocument();
      });
    });

    it("shows error message after a failed check-in", async () => {
      const user = userEvent.setup();
      mockCheckIn.mockRejectedValue(new Error("Network error"));

      setActivatedStore();
      render(<LicenseStatusPage />);

      await user.click(screen.getByRole("button", { name: /Renovar ahora/i }));

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

    it("shows export triggered message on click", async () => {
      const user = userEvent.setup();
      setActivatedStore();
      render(<LicenseStatusPage />);

      await user.click(screen.getByRole("button", { name: /Exportar datos/i }));

      expect(
        screen.getByText(/Exportación iniciada/i),
      ).toBeInTheDocument();
    });
  });
});
