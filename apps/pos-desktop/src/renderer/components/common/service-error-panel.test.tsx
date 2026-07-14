/**
 * Tests for ServiceErrorPanel — full-screen error panel for service init failure.
 *
 * Covers:
 * 1. Renders the error message text.
 * 2. Renders a "Reintentar" button when onRetry is provided.
 * 3. The retry button calls onRetry when clicked.
 * 4. Does not render a retry button when onRetry is omitted.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServiceErrorPanel } from "./service-error-panel";

describe("ServiceErrorPanel", () => {
  it("renders the error message", () => {
    const error = new Error("Database connection refused");

    render(<ServiceErrorPanel error={error} />);

    expect(screen.getByText("Database connection refused")).toBeInTheDocument();
  });

  it("renders the app name from i18n", () => {
    render(<ServiceErrorPanel error={new Error("fail")} />);

    expect(screen.getByText("Pharmacy POS")).toBeInTheDocument();
  });

  it("has role='alert' on the container", () => {
    render(<ServiceErrorPanel error={new Error("fail")} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  describe("retry button", () => {
    it("renders a 'Reintentar' button when onRetry is provided", () => {
      const onRetry = vi.fn();

      render(<ServiceErrorPanel error={new Error("fail")} onRetry={onRetry} />);

      expect(
        screen.getByRole("button", { name: "Reintentar" }),
      ).toBeInTheDocument();
    });

    it("calls onRetry when the button is clicked", async () => {
      const onRetry = vi.fn();
      const user = userEvent.setup();

      render(<ServiceErrorPanel error={new Error("fail")} onRetry={onRetry} />);

      await user.click(screen.getByRole("button", { name: "Reintentar" }));

      expect(onRetry).toHaveBeenCalledOnce();
    });

    it("does not render a retry button when onRetry is omitted", () => {
      render(<ServiceErrorPanel error={new Error("fail")} />);

      expect(
        screen.queryByRole("button", { name: "Reintentar" }),
      ).not.toBeInTheDocument();
    });
  });
});
