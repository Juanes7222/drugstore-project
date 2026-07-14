/**
 * Component tests for ErrorBanner.
 *
 * Covers: rendering the error message text.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBanner } from "./error-banner";

describe("ErrorBanner", () => {
  it("renders the provided message", () => {
    render(<ErrorBanner message="Something went wrong" />);

    expect(
      screen.getByText("Something went wrong"),
    ).toBeInTheDocument();
  });

  it("renders an empty message without crashing", () => {
    const { container } = render(<ErrorBanner message="" />);

    const p = container.querySelector("p");
    expect(p).toBeInTheDocument();
    expect(p).toHaveTextContent("");
  });

  it("updates the rendered text when message changes", () => {
    const { rerender } = render(
      <ErrorBanner message="First error" />,
    );

    expect(screen.getByText("First error")).toBeInTheDocument();

    rerender(<ErrorBanner message="Second error" />);

    expect(screen.getByText("Second error")).toBeInTheDocument();
  });
});
