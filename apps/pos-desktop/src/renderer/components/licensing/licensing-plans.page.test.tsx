/**
 * Component tests for LicensingPlansPage.
 *
 * Covers: catalog rendering after the plans fetch, plan + period selection,
 * the customer form submit flow (createSession → open URL → poll), approved
 * with/without activation code, declined, timeout, and error banners.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillingPeriod } from "@pharmacy/shared-types";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { LicensingPlansPage } from "./licensing-plans.page";
import {
  CheckoutError,
  CheckoutTimeoutError,
  type CheckoutPlan,
  type CheckoutSession,
  type SessionStatus,
} from "../../../domain/licensing/wompi-checkout.service";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockDispatch = vi.hoisted(() => vi.fn());
const mockOpenExternalUrl = vi.hoisted(() => vi.fn());
const mockCheckoutService = vi.hoisted(() => ({
  fetchPlans: vi.fn(),
  createSession: vi.fn(),
  pollSession: vi.fn(),
  pollUntilTerminal: vi.fn(),
}));

vi.mock("react-redux", () => ({
  useDispatch: () => mockDispatch,
}));

vi.mock("../../../domain/licensing/wompi-checkout.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../domain/licensing/wompi-checkout.service")>();
  return {
    ...actual,
    createWompiCheckoutService: vi.fn(() => mockCheckoutService),
  };
});

vi.mock("../../../infrastructure/open-external", () => ({
  openExternalUrl: mockOpenExternalUrl,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePlan(overrides?: Partial<CheckoutPlan>): CheckoutPlan {
  return {
    code: "PREMIUM",
    name: "Premium",
    description: "All features included",
    pricingModel: "PER_WORKSTATION",
    basePriceCents: 50_000,
    currency: "COP",
    billingPeriod: "MONTHLY",
    maxLocations: 5,
    includedWorkstations: 3,
    extraWorkstationPriceCents: 10_000,
    features: ["MULTI_LOCATION"],
    displayOrder: 1,
    ...overrides,
  };
}

function makeSession(overrides?: Partial<CheckoutSession>): CheckoutSession {
  return {
    sessionId: "sess-abc123",
    paymentLinkId: "plink-xyz789",
    checkoutUrl: "https://checkout.wompi.co/pay/abc",
    reference: "wompi-ref-001",
    amountCents: 50_000,
    currency: "COP",
    ...overrides,
  };
}

function makeStatus(overrides?: Partial<SessionStatus>): SessionStatus {
  return {
    sessionId: "sess-abc123",
    status: "PENDING",
    statusMessage: null,
    wompiTransactionId: "txn-001",
    reference: "wompi-ref-001",
    subscriptionId: null,
    activationCode: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderAndSubmitCustomerForm(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  render(<LicensingPlansPage />);
  await user.click(await screen.findByRole("button", { name: "Elegir plan" }));
  await user.type(screen.getByLabelText("Nombre completo"), "Ana García");
  await user.type(screen.getByLabelText("NIT o cédula"), "900123456");
  await user.type(
    screen.getByLabelText("Correo electrónico"),
    "ana@farmacia.com",
  );
  await user.click(screen.getByRole("button", { name: "Pagar" }));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("LicensingPlansPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.getState().reset();
    mockDispatch.mockClear();
    mockOpenExternalUrl.mockReset();
    mockCheckoutService.fetchPlans.mockReset();
    mockCheckoutService.createSession.mockReset();
    mockCheckoutService.pollSession.mockReset();
    mockCheckoutService.pollUntilTerminal.mockReset();

    mockCheckoutService.fetchPlans.mockResolvedValue([makePlan()]);
    mockCheckoutService.createSession.mockResolvedValue(makeSession());
    mockOpenExternalUrl.mockResolvedValue(true);
  });

  // -----------------------------------------------------------------------
  // Catalog
  // -----------------------------------------------------------------------

  describe("plan catalog", () => {
    it("renders the fetched plans with their monthly prices", async () => {
      mockCheckoutService.fetchPlans.mockResolvedValue([
        makePlan(),
        makePlan({
          code: "BASIC",
          name: "Basic",
          basePriceCents: 25_000,
          displayOrder: 2,
        }),
      ]);

      render(<LicensingPlansPage />);

      expect(
        await screen.findByRole("heading", { name: "Premium" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Basic" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Elegir plan" })).toHaveLength(2);
      expect(screen.getByText("$ 25.000")).toBeInTheDocument();
    });

    it("shows the plans error banner when the catalog fetch fails", async () => {
      mockCheckoutService.fetchPlans.mockRejectedValue(new Error("offline"));

      render(<LicensingPlansPage />);

      expect(
        await screen.findByText("No se pudieron cargar los planes."),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Plan selection
  // -----------------------------------------------------------------------

  describe("plan and period selection", () => {
    it("moves to the customer form with the selected period and discounted amount", async () => {
      const user = userEvent.setup();
      render(<LicensingPlansPage />);

      await user.click(await screen.findByRole("radio", { name: /Anual/ }));
      await user.click(screen.getByRole("button", { name: "Elegir plan" }));

      expect(
        screen.getByRole("heading", { name: "Datos de facturación" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Premium")).toBeInTheDocument();
      expect(screen.getByText("Anual")).toBeInTheDocument();
      expect(screen.getByText("$ 480.000")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Checkout flow
  // -----------------------------------------------------------------------

  describe("checkout flow", () => {
    it("calls createSession with the customer draft, opens the URL and polls", async () => {
      const user = userEvent.setup();
      mockCheckoutService.pollUntilTerminal.mockResolvedValue(
        makeStatus({ status: "APPROVED", activationCode: "ABCDEFGHIJKL" }),
      );

      await renderAndSubmitCustomerForm(user);

      await waitFor(() => {
        expect(mockCheckoutService.createSession).toHaveBeenCalledWith({
          planCode: "PREMIUM",
          billingPeriod: BillingPeriod.MONTHLY,
          customerName: "Ana García",
          customerTaxId: "900123456",
          customerEmail: "ana@farmacia.com",
          customerPhone: "",
        });
      });
      expect(mockOpenExternalUrl).toHaveBeenCalledWith(
        "https://checkout.wompi.co/pay/abc",
      );
      await waitFor(() => {
        expect(mockCheckoutService.pollUntilTerminal).toHaveBeenCalledWith(
          "wompi-ref-001",
          expect.objectContaining({
            intervalMs: 5_000,
            timeoutMs: 10 * 60_000,
          }),
        );
      });
    });

    it("shows the approved result with the activation code", async () => {
      const user = userEvent.setup();
      mockCheckoutService.pollUntilTerminal.mockResolvedValue(
        makeStatus({ status: "APPROVED", activationCode: "ABCDEFGHIJKL" }),
      );

      await renderAndSubmitCustomerForm(user);

      expect(await screen.findByText("¡Pago aprobado!")).toBeInTheDocument();
      expect(screen.getByText("ABCD")).toBeInTheDocument();
      expect(screen.getByText("EFGH")).toBeInTheDocument();
      expect(screen.getByText("IJKL")).toBeInTheDocument();
    });

    it("persists the activation code to the license store", async () => {
      const user = userEvent.setup();
      mockCheckoutService.pollUntilTerminal.mockResolvedValue(
        makeStatus({ status: "APPROVED", activationCode: "ABCDEFGHIJKL" }),
      );

      await renderAndSubmitCustomerForm(user);

      await screen.findByText("¡Pago aprobado!");
      expect(useLicenseStore.getState().pendingActivationCode).toBe(
        "ABCDEFGHIJKL",
      );
    });

    it("shows the no-code message when APPROVED has no activation code", async () => {
      const user = userEvent.setup();
      mockCheckoutService.pollUntilTerminal.mockResolvedValue(
        makeStatus({ status: "APPROVED", activationCode: null }),
      );

      await renderAndSubmitCustomerForm(user);

      expect(
        await screen.findByText(
          /No pudimos obtener el c.digo de activaci.n autom.ticamente/,
        ),
      ).toBeInTheDocument();
      expect(useLicenseStore.getState().pendingActivationCode).toBeNull();
    });

    it("shows the declined panel when the payment is rejected", async () => {
      const user = userEvent.setup();
      mockCheckoutService.pollUntilTerminal.mockResolvedValue(
        makeStatus({
          status: "DECLINED",
          statusMessage: "Rechazado por el banco",
        }),
      );

      await renderAndSubmitCustomerForm(user);

      expect(await screen.findByText("Pago rechazado")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Reintentar pago" }),
      ).toBeInTheDocument();
    });

    it("shows the pending panel when polling times out", async () => {
      const user = userEvent.setup();
      mockCheckoutService.pollUntilTerminal.mockRejectedValue(
        new CheckoutTimeoutError("wompi-ref-001", 600_000),
      );

      await renderAndSubmitCustomerForm(user);

      expect(
        await screen.findByText("Verificación en curso"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Verificar pago" }),
      ).toBeInTheDocument();
    });

    it("returns to the customer form with an error banner when the session fails", async () => {
      const user = userEvent.setup();
      mockCheckoutService.pollUntilTerminal.mockRejectedValue(
        new CheckoutError(422, "Invalid plan"),
      );

      await renderAndSubmitCustomerForm(user);

      expect(
        await screen.findByText("No se pudo crear el pago. Intente de nuevo."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Datos de facturación" }),
      ).toBeInTheDocument();
    });

    it("shows a network error banner for unexpected failures", async () => {
      const user = userEvent.setup();
      mockCheckoutService.pollUntilTerminal.mockRejectedValue(
        new Error("Connection dropped"),
      );

      await renderAndSubmitCustomerForm(user);

      expect(
        await screen.findByText(/Problema de conexión al procesar el pago/),
      ).toBeInTheDocument();
    });

    it("stays on the payment step when the browser cannot be opened", async () => {
      const user = userEvent.setup();
      mockOpenExternalUrl.mockResolvedValue(false);

      await renderAndSubmitCustomerForm(user);

      expect(
        await screen.findByText(/No se pudo abrir la pasarela de pago/),
      ).toBeInTheDocument();
      expect(mockCheckoutService.pollUntilTerminal).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Abrir pasarela de pago" }),
      ).toBeInTheDocument();
    });

    it("navigates to the license status screen when activating", async () => {
      const user = userEvent.setup();
      mockCheckoutService.pollUntilTerminal.mockResolvedValue(
        makeStatus({ status: "APPROVED", activationCode: "ABCDEFGHIJKL" }),
      );

      await renderAndSubmitCustomerForm(user);

      await user.click(
        await screen.findByRole("button", { name: "Activar mi terminal" }),
      );
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ui/setActiveScreen",
          payload: "license-status",
        }),
      );
    });
  });
});