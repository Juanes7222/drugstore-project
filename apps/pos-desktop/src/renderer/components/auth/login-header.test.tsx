/**
 * Component tests for LoginHeader.
 *
 * Covers: app name and login title rendering via translation keys.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginHeader } from "./login-header";

describe("LoginHeader", () => {
  it("renders the application name from translation", () => {
    render(<LoginHeader />);

    expect(screen.getByText("Pharmacy POS")).toBeInTheDocument();
  });

  it("renders the login title from translation", () => {
    render(<LoginHeader />);

    expect(screen.getByText("Iniciar sesión")).toBeInTheDocument();
  });

  it("renders both pieces of text in heading and paragraph tags", () => {
    render(<LoginHeader />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Pharmacy POS");

    const paragraph = screen.getByText("Iniciar sesión");
    expect(paragraph.tagName).toBe("P");
  });
});
