/**
 * Component tests for CheckoutFlow — the shared checkout step machine
 * (catalog → customer → payment → result) driven by an injected
 * WompiCheckoutService test double.
 *
 * Covers: catalog hand-off, customer submit (createSession → open URL →
 * poll), approved with/without activation code, declined, timeout, error
 * mapping, blocked-gateway retry, and the result-step actions.
 */
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillingPeriod } from "@pharmacy/shared-types";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { CheckoutFlow } from "./checkout-flow";
import {
  CheckoutError,
  CheckoutTimeoutError,
  type CheckoutPlan,
  type CheckoutSession,
  type SessionStatus,
  type WompiCheckoutService,
} from "../../../domain/licensing/wompi-checkout.service";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockDispatch = vi.hoisted(() => vi.fn());
const mockOpenExternalUrl = vi.hoisted(() => vi.fn());

vi.mock("react-redux", () => ({
  useDispatch: () => mockDispatch,
}));

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
    pricingModel: "SUBSCRIPTION",
    basePriceCents: 50_000,
    currency: "COP",
    billingPeriod: "MONTHLY",
    maxLocations: 5,
    includedWorkstations: 3,
    extraWorkstationPriceCents: null,
    features: ["MULTI_LOCATION"],
    displayOrder: 1,
    billingMethod: "PROVIDER",
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

interface MockCheckoutService {
  fetchPlans: Mock;
  createSession: Mock;
  pollSession: Mock;
  pollUntilTerminal: Mock;
}

function makeCheckoutService(): MockCheckoutService {
  return {
    fetchPlans: vi.fn(),
    createSession: vi.fn(),
    pollSession: vi.fn(),
    pollUntilTerminal: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RenderFlowOptions {
  plan?: CheckoutPlan;
  selectPeriod?: BillingPeriod;
}

function renderFlow(
  service: WompiCheckoutService,
  { plan = makePlan(), selectPeriod = BillingPeriod.MONTHLY }: RenderFlowOptions = {},
): void {
  render(
    <CheckoutFlow
      checkoutService={service}
      renderCatalog={(onSelectPlan) => (
        <button type="button" onClick={() => onSelectPlan(plan, selectPeriod)}>
          catálogo de prueba
        </button>
      )}
    />,
  );
}

async function choosePlan(
  user: ReturnType<typeof userEvent.setup>,
  options: RenderFlowOptions = {},
): Promise<MockCheckoutService> {
  const service = makeCheckoutService();
  service.createSession.mockResolvedValue(makeSession());
  renderFlow(service, options);

  await user.click(
    await screen.findByRole("button", { name: "catálogo de prueba" }),
  );
  return service;
}

interface SubmitOptions extends RenderFlowOptions {
  /** Terminal status the mocked pollUntilTerminal resolves with. */
  pollResolves?: SessionStatus;
  /** Error the mocked pollUntilTerminal rejects with. */
  pollRejects?: unknown;
  /** Error the mocked createSession rejects with (defaults to resolved). */
  createSessionError?: unknown;
}

async function submitCustomerForm(
  user: ReturnType<typeof userEvent.setup>,
  { pollResolves, pollRejects, createSessionError, ...flowOptions }: SubmitOptions = {},
): Promise<MockCheckoutService> {
  const service = await choosePlan(user, flowOptions);

  if (createSessionError !== undefined) {
    service.createSession.mockRejectedValue(createSessionError);
  } else {
    service.createSession.mockResolvedValue(makeSession());
  }

  if (pollRejects !== undefined) {
    service.pollUntilTerminal.mockRejectedValue(pollRejects);
  } else {
    service.pollUntilTerminal.mockResolvedValue(
      pollResolves ?? makeStatus({ status: "APPROVED", activationCode: "ABCDEFGHIJKL" }),
    );
  }

  await user.type(screen.getByLabelText("Nombre completo"), "Ana García");
  await user.type(screen.getByLabelText("NIT o cédula"), "900123456");
  await user.type(
    screen.getByLabelText("Correo electrónico"),
    "ana@farmacia.com",
  );
  await user.click(screen.getByRole("button", { name: "Pagar" }));
  return service;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CheckoutFlow", () => {
  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.getState().reset();
    mockDispatch.mockClear();
    mockOpenExternalUrl.mockReset();
    mockOpenExternalUrl.mockResolvedValue(true);
  });

  describe("catalog step", () => {
    it("renders the catalog view provided by renderCatalog", () => {
      const service = makeCheckoutService();
      renderFlow(service);

      expect(
        screen.getByRole("button", { name: "catálogo de prueba" }),
      ).toBeInTheDocument();
    });

    it("opens the customer form with the chosen plan summary", async () => {
      const user = userEvent.setup();

      await choosePlan(user, {
        plan: makePlan({ name: "Premium", basePriceCents: 50_000 }),
      });

      expect(
        await screen.findByRole("heading", { name: "Datos de facturación" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Premium")).toBeInTheDocument();
      expect(screen.getByText("Mensual")).toBeInTheDocument();
      // formatCurrency divides cents by 100: 50_000 cents → $ 500.
      expect(screen.getByText("$ 500")).toBeInTheDocument();
    });

    it("shows the discounted annual estimate for an annual selection", async () => {
      const user = userEvent.setup();

      await choosePlan(user, { selectPeriod: BillingPeriod.ANNUAL });

      // round(50_000 * 12 * 0.8) = 480_000 cents → $ 4.800.
      expect(await screen.findByText("$ 4.800")).toBeInTheDocument();
      expect(screen.getByText("Anual")).toBeInTheDocument();
    });

    it("returns to the catalog when the customer goes back", async () => {
      const user = userEvent.setup();

      await choosePlan(user);
      await screen.findByRole("heading", { name: "Datos de facturación" });
      await user.click(screen.getByRole("button", { name: "Volver" }));

      expect(
        await screen.findByRole("button", { name: "catálogo de prueba" }),
      ).toBeInTheDocument();
    });
  });

  describe("customer submit", () => {
    it("creates the session, opens the gateway and starts polling", async () => {
      const user = userEvent.setup();
      const service = makeCheckoutService();
      service.createSession.mockResolvedValue(makeSession());
      service.pollUntilTerminal.mockReturnValue(new Promise(() => {}));
      renderFlow(service);

      await user.click(
        await screen.findByRole("button", { name: "catálogo de prueba" }),
      );
      await user.type(screen.getByLabelText("Nombre completo"), "Ana García");
      await user.type(screen.getByLabelText("NIT o cédula"), "900123456");
      await user.type(
        screen.getByLabelText("Correo electrónico"),
        "ana@farmacia.com",
      );
      await user.click(screen.getByRole("button", { name: "Pagar" }));

      await waitFor(() => {
        expect(service.createSession).toHaveBeenCalledWith({
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
        expect(service.pollUntilTerminal).toHaveBeenCalledWith(
          "wompi-ref-001",
          expect.objectContaining({
            intervalMs: 5_000,
            timeoutMs: 10 * 60_000,
          }),
        );
      });
    });

    it("stores the activation code and shows the approved result", async () => {
      const user = userEvent.setup();

      await submitCustomerForm(user);

      expect(await screen.findByText("¡Pago aprobado!")).toBeInTheDocument();
      expect(screen.getByText("ABCD")).toBeInTheDocument();
      expect(useLicenseStore.getState().pendingActivationCode).toBe(
        "ABCDEFGHIJKL",
      );
    });

    it("keeps the store code empty and explains the missing code on APPROVED without one", async () => {
      const user = userEvent.setup();

      await submitCustomerForm(user, {
        pollResolves: makeStatus({ status: "APPROVED", activationCode: null }),
      });

      expect(
        await screen.findByText(
          /No pudimos obtener el c.digo de activaci.n autom.ticamente/,
        ),
      ).toBeInTheDocument();
      expect(useLicenseStore.getState().pendingActivationCode).toBeNull();
    });

    it("shows the certificate note only for CERTIFICATE plans", async () => {
      const user = userEvent.setup();

      await submitCustomerForm(user, {
        plan: makePlan({ billingMethod: "CERTIFICATE" }),
        pollResolves: makeStatus({ status: "APPROVED", activationCode: null }),
      });

      expect(
        await screen.findByRole("note"),
      ).toHaveTextContent(/Siguiente: tu certificado DIAN/);
    });

    it("shows the declined panel when the payment is rejected", async () => {
      const user = userEvent.setup();

      await submitCustomerForm(user, {
        pollResolves: makeStatus({
          status: "DECLINED",
          statusMessage: "Rechazado por el banco",
        }),
      });

      expect(await screen.findByText("Pago rechazado")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Reintentar pago" }),
      ).toBeInTheDocument();
    });

    it("shows the verification panel when polling times out", async () => {
      const user = userEvent.setup();

      await submitCustomerForm(user, {
        pollRejects: new CheckoutTimeoutError("wompi-ref-001", 600_000),
      });

      expect(
        await screen.findByText("Verificación en curso"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Verificar pago" }),
      ).toBeInTheDocument();
    });

    it("returns to the customer form with a create-failed banner on CheckoutError", async () => {
      const user = userEvent.setup();

      await submitCustomerForm(user, {
        pollRejects: new CheckoutError(422, "Invalid plan"),
      });

      expect(
        await screen.findByText(
          "No se pudo crear el pago. Intente de nuevo.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Datos de facturación" }),
      ).toBeInTheDocument();
    });

    it("returns to the customer form with a network banner on unexpected failures", async () => {
      const user = userEvent.setup();

      await submitCustomerForm(user, {
        createSessionError: new Error("Connection dropped"),
      });

      expect(
        await screen.findByText(/Problema de conexión al procesar el pago/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Datos de facturación" }),
      ).toBeInTheDocument();
    });

    it("stays on the payment step without polling when the browser blocks the gateway", async () => {
      const user = userEvent.setup();
      mockOpenExternalUrl.mockResolvedValue(false);

      const service = await submitCustomerForm(user);

      expect(
        await screen.findByText(/No se pudo abrir la pasarela de pago/),
      ).toBeInTheDocument();
      expect(service.pollUntilTerminal).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Abrir pasarela de pago" }),
      ).toBeEnabled();
    });
  });

  describe("result actions", () => {
    it("dispatches setActiveScreen license-status when activating", async () => {
      const user = userEvent.setup();

      await submitCustomerForm(user);

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

    it("reopens the same session URL from the declined result", async () => {
      const user = userEvent.setup();

      await submitCustomerForm(user, {
        pollResolves: makeStatus({ status: "DECLINED" }),
      });

      await user.click(
        await screen.findByRole("button", { name: "Reintentar pago" }),
      );
      expect(mockOpenExternalUrl).toHaveBeenLastCalledWith(
        "https://checkout.wompi.co/pay/abc",
      );
    });

    it("restarts to the catalog from the result view", async () => {
      const user = userEvent.setup();

      await submitCustomerForm(user, {
        pollResolves: makeStatus({ status: "DECLINED" }),
      });

      await user.click(
        await screen.findByRole("button", { name: "Ver planes de nuevo" }),
      );
      expect(
        await screen.findByRole("button", { name: "catálogo de prueba" }),
      ).toBeInTheDocument();
      // A non-approved flow leaves the pending activation code untouched.
      expect(useLicenseStore.getState().pendingActivationCode).toBeNull();
    });
  });
});
