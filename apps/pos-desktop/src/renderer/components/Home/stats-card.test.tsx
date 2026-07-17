/**
 * Component tests for StatsCard — a single KPI display card.
 *
 * Covers: label/value rendering, numeric font face, optional icon,
 * optional description, and custom className passthrough.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShoppingCart } from "lucide-react";
import { StatsCard } from "./stats-card";

describe("StatsCard", () => {
  it("renders label and value text", () => {
    render(<StatsCard label="Ventas hoy" value="$45.200" />);

    expect(screen.getByText("Ventas hoy")).toBeInTheDocument();
    expect(screen.getByText("$45.200")).toBeInTheDocument();
  });

  it("applies font-data class when numeric prop is true", () => {
    render(<StatsCard label="Total" value="$45.200" numeric />);

    const valueEl = screen.getByText("$45.200");
    expect(valueEl.className).toContain("font-data");
  });

  it("does not apply font-data class when numeric prop is false", () => {
    render(<StatsCard label="Total" value="$45.200" />);

    const valueEl = screen.getByText("$45.200");
    expect(valueEl.className).not.toContain("font-data");
  });

  it("renders icon when provided", () => {
    render(
      <StatsCard
        label="Ventas hoy"
        value="$45.200"
        icon={ShoppingCart}
      />,
    );

    const svg = document.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("renders description when provided", () => {
    render(
      <StatsCard
        label="Ventas hoy"
        value="$45.200"
        description="12 transacciones"
      />,
    );

    expect(screen.getByText("12 transacciones")).toBeInTheDocument();
  });

  it("does not render description when not provided", () => {
    render(<StatsCard label="Ventas hoy" value="$45.200" />);

    expect(
      screen.queryByText("12 transacciones"),
    ).not.toBeInTheDocument();
  });

  it("applies custom className to the card wrapper", () => {
    const { container } = render(
      <StatsCard
        label="Ventas hoy"
        value="$45.200"
        className="custom-outer-class"
      />,
    );

    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("custom-outer-class");
  });
});
