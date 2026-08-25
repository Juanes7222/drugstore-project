/**
 * Component tests for PlanCatalog — billing-method badges (PROVIDER vs
 * CERTIFICATE), fixed cent-based pricing, unlimited-location handling,
 * feature chips, the certificate help link, and the period/selection wiring.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillingPeriod } from "@pharmacy/shared-types";
import { PlanCatalog } from "./plan-catalog";
import type { CheckoutPlan } from "../../../domain/licensing/wompi-checkout.service";

// ---------------------------------------------------------------------------
// Mock the assistant store — the certificate card opens a help topic on it
// ---------------------------------------------------------------------------

const mockAssistantState = vi.hoisted(() => ({
  openHelp: vi.fn(),
}));

vi.mock("../../../stores/assistant.store", () => ({
  useAssistantStore: (selector: (s: typeof mockAssistantState) => unknown) =>
    selector(mockAssistantState),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePlan(overrides?: Partial<CheckoutPlan>): CheckoutPlan {
  return {
    code: "PROVIDER-1",
    name: "Plan Proveedor",
    description: "Suscripción con facturación electrónica",
    pricingModel: "SUBSCRIPTION",
    basePriceCents: 199_900,
    currency: "COP",
    billingPeriod: "MONTHLY",
    maxLocations: 3,
    includedWorkstations: 1,
    extraWorkstationPriceCents: 99_900,
    features: ["MULTI_LOCATION", "OFFLINE_MODE"],
    displayOrder: 1,
    billingMethod: "PROVIDER",
    ...overrides,
  };
}

const makeProps = (plans: CheckoutPlan[]) => ({
  plans,
  isLoading: false,
  errorCode: null,
  onSelectPlan: vi.fn(),
});

describe("PlanCatalog", () => {
  beforeEach(() => {
    mockAssistantState.openHelp.mockReset();
  });

  describe("billing method badge", () => {
    it("shows the PROVIDER badge for a billing-included plan", () => {
      render(<PlanCatalog {...makeProps([makePlan()])} />);

      expect(screen.getByText("Facturación incluida")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: "Abrir ayuda sobre el certificado DIAN",
        }),
      ).not.toBeInTheDocument();
    });

    it("shows the CERTIFICATE badge with its help link for a self-managed plan", () => {
      render(
        <PlanCatalog
          {...makeProps([
            makePlan({ code: "CERT-1", billingMethod: "CERTIFICATE" }),
          ])}
        />,
      );

      expect(screen.getByText("Tu certificado DIAN")).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "Abrir ayuda sobre el certificado DIAN",
        }),
      ).toBeInTheDocument();
    });

    it("opens the DIAN certificate assistant topic from the help link", async () => {
      const user = userEvent.setup();
      render(
        <PlanCatalog
          {...makeProps([
            makePlan({ code: "CERT-1", billingMethod: "CERTIFICATE" }),
          ])}
        />,
      );

      await user.click(
        screen.getByRole("button", {
          name: "Abrir ayuda sobre el certificado DIAN",
        }),
      );

      expect(mockAssistantState.openHelp).toHaveBeenCalledWith(
        "fiscal-dian-certificate",
      );
    });

    it("falls back to the PROVIDER label for legacy plans without a billing method", () => {
      render(<PlanCatalog {...makeProps([makePlan({ billingMethod: null })])} />);

      expect(screen.getByText("Facturación incluida")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: "Abrir ayuda sobre el certificado DIAN",
        }),
      ).not.toBeInTheDocument();
    });
  });

  describe("pricing", () => {
    it("renders the monthly price from cents", () => {
      render(<PlanCatalog {...makeProps([makePlan()])} />);

      // formatCurrency divides by 100: 199_900 cents → $ 1.999.
      expect(screen.getByText("$ 1.999")).toBeInTheDocument();
      expect(screen.getByText("/mes")).toBeInTheDocument();
    });

    it("renders the discounted quarterly price after switching period", async () => {
      const user = userEvent.setup();
      render(<PlanCatalog {...makeProps([makePlan()])} />);

      await user.click(within(screen.getByRole("radiogroup")).getByRole("radio", { name: /Trimestral/ }));

      // round(199_900 * 3 * 0.9) = 539_730 cents → $ 5.397.
      expect(screen.getByText("$ 5.397")).toBeInTheDocument();
      expect(screen.getByText("/trimestre")).toBeInTheDocument();
      expect(
        within(screen.getByRole("radiogroup")).getByText("10% OFF"),
      ).toBeInTheDocument();
    });

    it("renders the discounted annual price after switching period", async () => {
      const user = userEvent.setup();
      render(<PlanCatalog {...makeProps([makePlan()])} />);

      await user.click(within(screen.getByRole("radiogroup")).getByRole("radio", { name: /Anual/ }));

      // round(199_900 * 12 * 0.8) = 1_919_040 cents → $ 19.190.
      expect(screen.getByText("$ 19.190")).toBeInTheDocument();
      expect(screen.getByText("/año")).toBeInTheDocument();
      expect(
        within(screen.getByRole("radiogroup")).getByText("20% OFF"),
      ).toBeInTheDocument();
    });

    it("prices extra workstations in pesos, not cents", () => {
      render(<PlanCatalog {...makeProps([makePlan()])} />);

      const workstationLine = screen
        .getByText(/1 puesto incluido/)
        .closest("p");
      expect(workstationLine).not.toBeNull();
      // formatCurrency divides by 100: 99_900 cents → $ 999.
      expect(workstationLine).toHaveTextContent(
        "+ $ 999 por puesto adicional / mes",
      );
    });
  });

  describe("capacity", () => {
    it("shows the location cap for finite plans", () => {
      render(<PlanCatalog {...makeProps([makePlan()])} />);

      expect(screen.getByText(/3 locales/)).toBeInTheDocument();
      expect(screen.getByText(/1 puesto incluido/)).toBeInTheDocument();
    });

    it('shows "Locales ilimitados" for the 999 sentinel', () => {
      render(<PlanCatalog {...makeProps([makePlan({ maxLocations: 999 })])} />);

      expect(screen.getByText("Locales ilimitados")).toBeInTheDocument();
      expect(screen.queryByText(/999 local/)).not.toBeInTheDocument();
    });

    it('shows "Locales ilimitados" for plans carrying the UNLIMITED_LOCATIONS feature', () => {
      render(
        <PlanCatalog
          {...makeProps([
            makePlan({
              maxLocations: 2,
              features: ["UNLIMITED_LOCATIONS"],
            }),
          ])}
        />,
      );

      // Capacity line and the feature chip both carry the label.
      expect(
        screen.getAllByText("Locales ilimitados").length,
      ).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText(/2 locales/)).not.toBeInTheDocument();
    });
  });

  describe("feature chips", () => {
    it("renders translated features as chips inside one accessible list", () => {
      render(<PlanCatalog {...makeProps([makePlan()])} />);

      const list = screen.getByRole("list", {
        name: "Características incluidas",
      });
      const items = within(list).getAllByRole("listitem");

      expect(items).toHaveLength(2);
      expect(within(items[0]).getByText("Múltiples locales")).toBeInTheDocument();
      expect(items[0].querySelectorAll("svg")).toHaveLength(1);
      expect(within(items[1]).getByText("Modo offline")).toBeInTheDocument();
    });
  });

  describe("selection wiring", () => {
    it("calls onSelectPlan with the plan and the selected period", async () => {
      const user = userEvent.setup();
      const onSelectPlan = vi.fn();
      render(<PlanCatalog {...makeProps([makePlan()])} onSelectPlan={onSelectPlan} />);

      await user.click(screen.getByRole("button", { name: "Elegir plan" }));

      expect(onSelectPlan).toHaveBeenCalledWith(
        expect.objectContaining({ code: "PROVIDER-1" }),
        BillingPeriod.MONTHLY,
      );
    });

    it("passes the switched period through to onSelectPlan", async () => {
      const user = userEvent.setup();
      const onSelectPlan = vi.fn();
      render(<PlanCatalog {...makeProps([makePlan()])} onSelectPlan={onSelectPlan} />);

      await user.click(screen.getByRole("radio", { name: /Anual/ }));
      await user.click(screen.getByRole("button", { name: "Elegir plan" }));

      expect(onSelectPlan).toHaveBeenCalledWith(
        expect.objectContaining({ code: "PROVIDER-1" }),
        BillingPeriod.ANNUAL,
      );
    });

    it("renders plans sorted by display order", () => {
      const second = makePlan({
        code: "CERT-1",
        name: "Plan Autogestionado",
        displayOrder: 2,
        billingMethod: "CERTIFICATE",
      });
      const first = makePlan({ code: "PROVIDER-1", displayOrder: 1 });

      render(<PlanCatalog {...makeProps([second, first])} />);

      const headings = screen.getAllByRole("heading", { level: 3 });
      expect(headings.map((h) => h.textContent)).toEqual([
        "Plan Proveedor",
        "Plan Autogestionado",
      ]);
    });
  });

  describe("catalog states", () => {
    it("shows a busy status while loading", () => {
      render(<PlanCatalog {...makeProps([])} isLoading={true} />);

      expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
      expect(screen.getByText("Cargando planes...")).toBeInTheDocument();
      expect(screen.queryAllByRole("article")).toHaveLength(0);
    });

    it("alerts when the catalog failed to load", () => {
      render(
        <PlanCatalog
          {...makeProps([])}
          errorCode="PLANS_LOAD_FAILED"
        />,
      );

      expect(
        screen.getByRole("alert"),
      ).toHaveTextContent("No se pudieron cargar los planes.");
      expect(screen.queryAllByRole("article")).toHaveLength(0);
    });

    it("shows an empty message when no plans exist", () => {
      render(<PlanCatalog {...makeProps([])} />);

      expect(
        screen.getByText("No hay planes disponibles en este momento."),
      ).toBeInTheDocument();
    });
  });
});
