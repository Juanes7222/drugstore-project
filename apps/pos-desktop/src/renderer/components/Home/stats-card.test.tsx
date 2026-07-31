/**
 * Component tests for StatsCard — a single KPI display card.
 *
 * Covers: label/value rendering, numeric font face, optional icon,
 * optional description, and custom className passthrough.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ShoppingCartIcon } from "@/components/ui/icons";
import { StatsCard } from "./stats-card";

// Provide matchMedia so motion/react's useReducedMotion works in jsdom.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

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
        icon={ShoppingCartIcon}
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

  describe("count-up", () => {
    afterEach(() => {
      // Never leak fake timers into sibling tests, even on assertion failure.
      vi.useRealTimers();
    });

    it("animates from 0 to the target when countUp is provided", () => {
      vi.useFakeTimers();
      render(
        <StatsCard label="Ventas hoy" value="0" countUp={42} numeric />,
      );

      // Starts at 0, then reaches the target after the duration elapses.
      expect(screen.getByText("0")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(screen.getByText("42")).toBeInTheDocument();
    });

    it("formats the final value with Spanish grouping", () => {
      vi.useFakeTimers();
      render(<StatsCard label="Ventas" value="0" countUp={45200} numeric />);

      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(screen.getByText("45.200")).toBeInTheDocument();
    });

    it("renders the plain string value when countUp is not provided", () => {
      render(<StatsCard label="Ventas hoy" value="—" />);

      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });
});
