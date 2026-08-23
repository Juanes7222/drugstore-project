/**
 * Component tests for PlanCatalog — billing-method badges (PROVIDER vs
 * CERTIFICATE), the certificate note for self-managed plans, legacy plans
 * without a billing method, and the period/selection wiring.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillingPeriod } from "@pharmacy/shared-types";
import { PlanCatalog } from "./plan-catalog";
import type { CheckoutPlan } from "../../../domain/licensing/wompi-checkout.service";

const makePlan = (
  overrides: Partial<CheckoutPlan> = {},
): CheckoutPlan => ({
  code: "PROVIDER-1",
  name: "Plan Proveedor",
  description: "Suscripción con facturación electrónica",
  pricingModel: "SUBSCRIPTION",
  basePriceCents: 199900,
  currency: "COP",
  billingPeriod: "MONTHLY",
  maxLocations: 1,
  includedWorkstations: 1,
  extraWorkstationPriceCents: 99900,
  features: ["ELECTRONIC_INVOICING"],
  displayOrder: 1,
  billingMethod: "PROVIDER",
  ...overrides,
});

const makeProps = (plans: CheckoutPlan[]) => ({
  plans,
  isLoading: false,
  errorCode: null,
  onSelectPlan: vi.fn(),
});

describe("PlanCatalog", () => {
  it("shows the PROVIDER badge and note for a billing-included plan", () => {
    render(<PlanCatalog {...makeProps([makePlan()])} />);

    expect(screen.getByText("Facturación incluida")).toBeInTheDocument();
    expect(
      screen.getByText(/Transmitimos tus facturas a la DIAN/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /¿Cómo obtengo el certificado DIAN?/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the CERTIFICATE badge, the upload note and the help link for a self-managed plan", () => {
    render(
      <PlanCatalog
        {...makeProps([
          makePlan({
            code: "CERT-1",
            name: "Plan Autogestionado",
            billingMethod: "CERTIFICATE",
          }),
        ])}
      />,
    );

    expect(screen.getByText("Tu certificado DIAN")).toBeInTheDocument();
    expect(
      screen.getByText(/subirás tu certificado digital/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Abrir ayuda sobre el certificado DIAN" }),
    ).toBeInTheDocument();
  });

  it("hides the billing badge and note for a legacy plan without a billing method", () => {
    render(
      <PlanCatalog
        {...makeProps([makePlan({ billingMethod: null })])}
      />,
    );

    expect(screen.queryByText("Facturación incluida")).not.toBeInTheDocument();
    expect(screen.queryByText("Tu certificado DIAN")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Transmitimos tus facturas a la DIAN/),
    ).not.toBeInTheDocument();
  });

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