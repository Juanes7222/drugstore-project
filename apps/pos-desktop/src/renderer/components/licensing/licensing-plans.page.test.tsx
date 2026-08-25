/**
 * Component tests for LicensingPlansPage — the thin onboarding-gate
 * container. It only wires the real checkout service to the shared
 * CheckoutFlow with a PlanCatalog; the flow orchestration itself is covered
 * by checkout-flow.test.tsx.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { LicensingPlansPage } from "./licensing-plans.page";
import type { CheckoutPlan } from "../../../domain/licensing/wompi-checkout.service";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockCheckoutService = vi.hoisted(() => ({
  fetchPlans: vi.fn(),
  createSession: vi.fn(),
  pollSession: vi.fn(),
  pollUntilTerminal: vi.fn(),
}));

const mockDispatch = vi.hoisted(() => vi.fn());

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePlan(overrides?: Partial<CheckoutPlan>): CheckoutPlan {
  return {
    code: "PREMIUM",
    name: "Premium",
    description: "All features included",
    pricingModel: "SUBSCRIPTION",
    basePriceCents: 199_900,
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

describe("LicensingPlansPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.getState().reset();
    mockDispatch.mockClear();
    mockCheckoutService.fetchPlans.mockReset();
    mockCheckoutService.createSession.mockReset();
    mockCheckoutService.pollSession.mockReset();
    mockCheckoutService.pollUntilTerminal.mockReset();

    mockCheckoutService.fetchPlans.mockResolvedValue([makePlan()]);
  });

  it("renders the fetched catalog with peso prices converted from cents", async () => {
    mockCheckoutService.fetchPlans.mockResolvedValue([
      makePlan(),
      makePlan({
        code: "BASIC",
        name: "Basic",
        basePriceCents: 99_900,
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
    // formatCurrency divides by 100: 199_900 cents → $ 1.999.
    expect(screen.getByText("$ 1.999")).toBeInTheDocument();
    expect(screen.getByText("$ 999")).toBeInTheDocument();
  });

  it("shows the busy catalog state while the plans fetch is pending", () => {
    mockCheckoutService.fetchPlans.mockReturnValue(new Promise(() => {}));

    render(<LicensingPlansPage />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Cargando planes...")).toBeInTheDocument();
  });

  it("shows the error banner when the catalog fetch fails", async () => {
    mockCheckoutService.fetchPlans.mockRejectedValue(new Error("offline"));

    render(<LicensingPlansPage />);

    expect(
      await screen.findByText("No se pudieron cargar los planes."),
    ).toBeInTheDocument();
  });

  it("hands the selected plan to the shared checkout customer step", async () => {
    const user = userEvent.setup();

    render(<LicensingPlansPage />);
    await user.click(await screen.findByRole("radio", { name: /Anual/ }));
    await user.click(screen.getByRole("button", { name: "Elegir plan" }));

    // round(199_900 * 12 * 0.8) = 1_919_040 cents → $ 19.190.
    expect(
      await screen.findByRole("heading", { name: "Datos de facturación" }),
    ).toBeInTheDocument();
    expect(screen.getByText("$ 19.190")).toBeInTheDocument();
  });
});
