/**
 * Component tests for CurrentPlanBenefits — the capacity line (with the
 * unlimited-locations handling) and the feature chip grid of the active plan.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  CurrentPlanBenefits,
  type CurrentPlanBenefitsProps,
} from "./current-plan-benefits";

const makeProps = (
  overrides: Partial<CurrentPlanBenefitsProps> = {},
): CurrentPlanBenefitsProps => ({
  features: ["MULTI_LOCATION", "OFFLINE_MODE"],
  maxLocations: 5,
  maxWorkstationsPerLocation: 3,
  ...overrides,
});

describe("CurrentPlanBenefits", () => {
  it("renders the location cap for a finite plan", () => {
    render(<CurrentPlanBenefits {...makeProps()} />);

    expect(screen.getByText(/5 local/i)).toBeInTheDocument();
  });

  it("renders the workstation cap when one is set", () => {
    render(<CurrentPlanBenefits {...makeProps()} />);

    expect(screen.getByText(/3 puesto/i)).toBeInTheDocument();
  });

  it("hides the workstation line when maxWorkstationsPerLocation is null", () => {
    render(<CurrentPlanBenefits {...makeProps({ maxWorkstationsPerLocation: null })} />);

    expect(screen.queryByText(/puesto/i)).not.toBeInTheDocument();
  });

  it("renders unlimited locations for a plan with the UNLIMITED_LOCATIONS feature", () => {
    render(
      <CurrentPlanBenefits
        {...makeProps({ features: ["UNLIMITED_LOCATIONS"], maxLocations: 3 })}
      />,
    );

    // Both the capacity line and the feature chip carry the label.
    expect(
      screen.getAllByText("Locales ilimitados").length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Hasta 3 local/i)).not.toBeInTheDocument();
  });

  it("renders unlimited locations when maxLocations is null", () => {
    render(<CurrentPlanBenefits {...makeProps({ maxLocations: null })} />);

    expect(screen.getByText("Locales ilimitados")).toBeInTheDocument();
  });

  it("renders the feature chips inside an accessible list", () => {
    render(<CurrentPlanBenefits {...makeProps()} />);

    const list = screen.getByRole("list", { name: "Características incluidas" });

    expect(within(list).getByText("Múltiples locales")).toBeInTheDocument();
    expect(within(list).getByText("Modo offline")).toBeInTheDocument();
  });

  it("falls back to the raw feature code for unknown features", () => {
    render(
      <CurrentPlanBenefits
        {...makeProps({ features: ["SOME_NEW_FEATURE"] })}
      />,
    );

    expect(screen.getByText("SOME_NEW_FEATURE")).toBeInTheDocument();
  });

  it("renders no feature list when the plan has no features", () => {
    render(<CurrentPlanBenefits {...makeProps({ features: [] })} />);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
