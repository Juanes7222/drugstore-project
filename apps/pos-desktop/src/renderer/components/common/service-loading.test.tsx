/**
 * Tests for ServiceLoading — full-screen spinner displayed during service init.
 *
 * Covers:
 * 1. Renders the loading text from i18n.
 * 2. The spinner div has aria-hidden="true".
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServiceLoading } from "./service-loading";

describe("ServiceLoading", () => {
  it("renders the loading text from i18n", () => {
    render(<ServiceLoading />);

    expect(screen.getByText("Cargando...")).toBeInTheDocument();
  });

  it("has aria-hidden='true' on the spinner div", () => {
    render(<ServiceLoading />);

    // The spinner is a div with animate-spin classes inside the layout
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveAttribute("aria-hidden", "true");
  });

  it("renders in a full-screen container", () => {
    render(<ServiceLoading />);

    const outerDiv = document.querySelector(".flex.h-screen");
    expect(outerDiv).toBeInTheDocument();
  });
});
