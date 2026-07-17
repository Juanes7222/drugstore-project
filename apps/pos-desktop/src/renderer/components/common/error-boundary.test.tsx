/**
 * Component tests for ErrorBoundary.
 *
 * Covers: catching render errors, default fallback UI, retry mechanism,
 * custom fallback, onError callback, and no-error pass-through.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./error-boundary";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A component that throws during render. */
function CrashOnRender({ message = "Intentional crash" }: { message?: string }) {
  throw new Error(message);
}

/** A stable component that renders normally. */
function StableComponent({ text = "Hello" }: { text?: string }) {
  return <div>{text}</div>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // Suppress console.error from React's caught errors during tests
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <StableComponent text="All good" />
      </ErrorBoundary>,
    );

    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("catches a render error and shows the default fallback UI", () => {
    render(
      <ErrorBoundary>
        <CrashOnRender />
      </ErrorBoundary>,
    );

    // Default title
    expect(
      screen.getByText(/something went wrong/i),
    ).toBeInTheDocument();

    // Retry button
    expect(
      screen.getByRole("button", { name: /try again|retry|intentar/i }),
    ).toBeInTheDocument();
  });

  it("renders the custom fallback element instead of the default", () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom Error UI</div>}>
        <CrashOnRender />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
    expect(screen.getByText("Custom Error UI")).toBeInTheDocument();
  });

  it("renders the custom fallback function with the error object", () => {
    render(
      <ErrorBoundary
        fallback={(error) => (
          <div data-testid="fn-fallback">
            Error: {error.message}
          </div>
        )}
      >
        <CrashOnRender message="Boom!" />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("fn-fallback")).toBeInTheDocument();
    expect(screen.getByText("Error: Boom!")).toBeInTheDocument();
  });

  it("calls the onError callback with the error and info", () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <CrashOnRender message="Test error" />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Test error" }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });

  it("recovers and re-renders children after retry", () => {
    // After a crash, clicking retry resets the error state.
    // But if the same crashing children are still there, React re-catches.
    // The retry only makes sense after the parent changes which children are
    // rendered — so we first re-render with non-crashing children, then retry.
    function TestApp({ crash }: { crash: boolean }) {
      return (
        <ErrorBoundary>
          {crash ? <CrashOnRender /> : <StableComponent text="Recovered" />}
        </ErrorBoundary>
      );
    }

    const { rerender } = render(<TestApp crash={true} />);

    expect(
      screen.getByText(/something went wrong/i),
    ).toBeInTheDocument();

    // 1. First change children to non-crashing ones (ErrorBoundary still in error state)
    rerender(<TestApp crash={false} />);

    // 2. Then click retry to reset error state — now children are stable
    fireEvent.click(
      screen.getByRole("button", { name: /try again|retry|intentar/i }),
    );

    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });

  it("does not interfere with sibling error boundaries", () => {
    render(
      <div>
        <ErrorBoundary>
          <CrashOnRender />
        </ErrorBoundary>
        <ErrorBoundary>
          <StableComponent text="Still works" />
        </ErrorBoundary>
      </div>,
    );

    expect(
      screen.getByText(/something went wrong/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Still works")).toBeInTheDocument();
  });
});
