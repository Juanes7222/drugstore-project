/**
 * Component tests for SubscriptionPlansPanel — the switch-plan delta ledger.
 *
 * Covers: candidate-only cards with the gained/considered ledger and monthly
 * price delta when the current plan is matchable, the plain-card fallback
 * when it is not, the offline status panel, the loading state, and the
 * plan/period selection wiring.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillingPeriod } from "@pharmacy/shared-types";
import {
  SubscriptionPlansPanel,
  type SubscriptionPlansPanelProps,
} from "./subscription-plans-panel";
import type { CheckoutPlan } from "../../../domain/licensing/wompi-checkout.service";

function makePlan(overrides: Partial<CheckoutPlan> = {}): CheckoutPlan {
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

const currentPlan = makePlan();
const cheaperPlan = makePlan({
  code: "BASIC",
  name: "Basic",
  basePriceCents: 99_900,
  features: ["MULTI_LOCATION"],
  maxLocations: 1,
  includedWorkstations: 1,
  displayOrder: 2,
});
const upgradePlan = makePlan({
  code: "ENTERPRISE",
  name: "Enterprise",
  basePriceCents: 299_900,
  billingMethod: "CERTIFICATE",
  features: [
    "MULTI_LOCATION",
    "ADVANCED_REPORTS",
    "API_ACCESS",
    "UNLIMITED_LOCATIONS",
  ],
  maxLocations: 999,
  includedWorkstations: 10,
  displayOrder: 3,
});

const makeProps = (
  overrides: Partial<SubscriptionPlansPanelProps> = {},
): SubscriptionPlansPanelProps => ({
  plans: [currentPlan, cheaperPlan, upgradePlan],
  currentPlanCode: "PREMIUM",
  currentFeatures: currentPlan.features,
  currentBillingMethod: "PROVIDER",
  currentBasePriceCents: 199_900,
  isLoading: false,
  errorCode: null,
  onSelectPlan: vi.fn(),
  ...overrides,
});

const getCard = (planName: string): HTMLElement => {
  const heading = screen.getByRole("heading", { name: planName });
  const card = heading.closest("article");
  if (!card) throw new Error(`No card found for plan ${planName}`);
  return card;
};

describe("SubscriptionPlansPanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("when the current plan is matchable", () => {
    it("renders only candidates, never the current plan", () => {
      render(<SubscriptionPlansPanel {...makeProps()} />);

      expect(
        screen.getByRole("heading", { name: "Basic" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Enterprise" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Premium" }),
      ).not.toBeInTheDocument();
    });

    it("lists gained features under Ganas on an upgrade card", () => {
      render(<SubscriptionPlansPanel {...makeProps()} />);

      const card = within(getCard("Enterprise"));

      expect(card.getByText("Ganas")).toBeInTheDocument();
      expect(card.getByText("Acceso a API")).toBeInTheDocument();
      expect(card.getByText("Locales ilimitados")).toBeInTheDocument();
    });

    it("lists the billing trade-off of switching to a certificate plan", () => {
      render(<SubscriptionPlansPanel {...makeProps()} />);

      const card = within(getCard("Enterprise"));

      expect(
        card.getByText(
          "Firmas y transmite facturas con tu propio certificado DIAN",
        ),
      ).toBeInTheDocument();
      expect(
        card.getByText(
          "Debes obtener y subir tu certificado digital (.pfx/.p12) y renovarlo cuando venza",
        ),
      ).toBeInTheDocument();
    });

    it("shows a positive monthly price delta for a more expensive plan", () => {
      render(<SubscriptionPlansPanel {...makeProps()} />);

      expect(
        within(getCard("Enterprise")).getByText(
          "+$ 1.000/mes frente a tu plan actual",
        ),
      ).toBeInTheDocument();
    });

    it("shows lost features under Considera on a downgrade card", () => {
      render(<SubscriptionPlansPanel {...makeProps()} />);

      const card = within(getCard("Basic"));

      expect(card.getByText("Considera")).toBeInTheDocument();
      expect(card.getByText("Reportes avanzados")).toBeInTheDocument();
    });

    it("omits the Ganas section when a cheaper plan adds nothing", () => {
      render(<SubscriptionPlansPanel {...makeProps()} />);

      const card = within(getCard("Basic"));

      expect(card.queryByText("Ganas")).not.toBeInTheDocument();
    });

    it("shows a negative monthly price delta for a cheaper plan", () => {
      render(<SubscriptionPlansPanel {...makeProps()} />);

      expect(
        within(getCard("Basic")).getByText(
          "−$ 1.000/mes frente a tu plan actual",
        ),
      ).toBeInTheDocument();
    });

    it("marks equal-priced plans as same monthly price", () => {
      render(
        <SubscriptionPlansPanel
          {...makeProps({
            plans: [
              currentPlan,
              makePlan({ code: "TWIN", name: "Twin", basePriceCents: 199_900 }),
            ],
          })}
        />,
      );

      expect(
        within(getCard("Twin")).getByText(
          "Mismo precio mensual que tu plan actual",
        ),
      ).toBeInTheDocument();
    });

    it("keeps the price delta on monthly bases while showing period pricing", async () => {
      const user = userEvent.setup();
      render(<SubscriptionPlansPanel {...makeProps()} />);

      await user.click(screen.getByRole("radio", { name: /Anual/ }));

      // Annual estimate: round(299900 * 12 * 0.8) cents → $ 28.790.
      expect(
        within(getCard("Enterprise")).getByText("$ 28.790"),
      ).toBeInTheDocument();
      expect(
        within(getCard("Enterprise")).getByText(
          "+$ 1.000/mes frente a tu plan actual",
        ),
      ).toBeInTheDocument();
    });

    it("passes the clicked plan and active period to onSelectPlan", async () => {
      const user = userEvent.setup();
      const onSelectPlan = vi.fn();
      render(<SubscriptionPlansPanel {...makeProps({ onSelectPlan })} />);

      await user.click(
        within(getCard("Enterprise")).getByRole("button", {
          name: "Cambiar a este plan",
        }),
      );

      await waitFor(() => {
        expect(onSelectPlan).toHaveBeenCalledWith(
          expect.objectContaining({ code: "ENTERPRISE" }),
          BillingPeriod.MONTHLY,
        );
      });
    });
  });

  describe("when the current plan is not in the catalog", () => {
    it("falls back to plain cards for every plan without a fabricated ledger", () => {
      render(
        <SubscriptionPlansPanel
          {...makeProps({
            currentPlanCode: "LEGACY-2019",
            currentFeatures: ["OFFLINE_MODE"],
          })}
        />,
      );

      const headings = screen
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent);
      expect(headings).toEqual(["Premium", "Basic", "Enterprise"]);

      expect(screen.queryByText("Ganas")).not.toBeInTheDocument();
      expect(screen.queryByText("Considera")).not.toBeInTheDocument();
      expect(screen.queryByText(/mes frente a tu plan actual/)).not.toBeInTheDocument();
    });

    it("hides the billing badge on plain fallback cards", () => {
      render(
        <SubscriptionPlansPanel
          {...makeProps({ currentPlanCode: "LEGACY-2019" })}
        />,
      );

      expect(screen.queryByText("Facturación incluida")).not.toBeInTheDocument();
      expect(screen.queryByText("Tu certificado DIAN")).not.toBeInTheDocument();
    });

    it("still offers every fallback plan for purchase", () => {
      render(
        <SubscriptionPlansPanel
          {...makeProps({ currentPlanCode: "LEGACY-2019" })}
        />,
      );

      expect(screen.getAllByRole("button", { name: "Cambiar a este plan" })).toHaveLength(3);
    });
  });

  describe("when the current plan matches by code but has no matched price", () => {
    it("shows the current plan compactly plus plain cards without a ledger", () => {
      render(
        <SubscriptionPlansPanel
          {...makeProps({ currentBasePriceCents: null })}
        />,
      );

      expect(
        screen.getByRole("article", { name: "Tu plan actual" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Plan actual")).toBeInTheDocument();

      // No delta ledger anywhere — the incumbent price is unknown.
      expect(screen.queryByText("Ganas")).not.toBeInTheDocument();
      expect(screen.queryByText(/mes frente a tu plan actual/)).not.toBeInTheDocument();
    });
  });

  describe("catalog states", () => {
    it("shows a calm status panel instead of plans when the fetch failed", () => {
      render(
        <SubscriptionPlansPanel
          {...makeProps({ errorCode: "PLANS_LOAD_FAILED" })}
        />,
      );

      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("No pudimos cargar los planes");
      expect(status).toHaveTextContent(/Comparar planes necesita conexión/);

      expect(screen.queryByRole("article")).not.toBeInTheDocument();
    });

    it("does not announce the failed catalog as an alert", () => {
      render(
        <SubscriptionPlansPanel
          {...makeProps({ errorCode: "PLANS_LOAD_FAILED" })}
        />,
      );

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows a busy loading state while the catalog loads", () => {
      render(<SubscriptionPlansPanel {...makeProps({ isLoading: true })} />);

      expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
      expect(screen.getByText("Cargando planes...")).toBeInTheDocument();
      expect(screen.queryByRole("article")).not.toBeInTheDocument();
    });
  });
});
