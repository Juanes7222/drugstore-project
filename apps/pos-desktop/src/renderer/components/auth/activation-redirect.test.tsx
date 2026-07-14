/**
 * Component tests for ActivationRedirect.
 *
 * Covers: children rendering when activationToken is present,
 * fallback + dispatch when no token, error path.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ActivationRedirect } from "./activation-redirect";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const dispatch = vi.fn();

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => dispatch,
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ActivationRedirect", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders children when activationToken exists in localStorage", async () => {
    localStorage.setItem("activationToken", "tok-123");

    render(
      <ActivationRedirect>
        <p>Activated content</p>
      </ActivationRedirect>,
    );

    await waitFor(() => {
      expect(screen.getByText("Activated content")).toBeInTheDocument();
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("renders fallback and dispatches setActiveScreen('recovery') when no token", async () => {
    render(
      <ActivationRedirect fallback={<p>Not activated</p>}>
        <p>Activated content</p>
      </ActivationRedirect>,
    );

    await waitFor(() => {
      expect(screen.getByText("Not activated")).toBeInTheDocument();
    });
    expect(screen.queryByText("Activated content")).not.toBeInTheDocument();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui/setActiveScreen",
        payload: "recovery",
      }),
    );
  });

  it("renders children if localStorage check succeeds but getItem still returns the token", async () => {
    localStorage.setItem("activationToken", "tok-456");

    render(
      <ActivationRedirect fallback={<p>Not activated</p>}>
        <p>Activated</p>
      </ActivationRedirect>,
    );

    await waitFor(() => {
      expect(screen.getByText("Activated")).toBeInTheDocument();
    });
  });

  it("handles localStorage throws (error path) by dispatching recovery", async () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("Storage error");
      });

    render(
      <ActivationRedirect fallback={<p>Error</p>}>
        <p>Content</p>
      </ActivationRedirect>,
    );

    await waitFor(() => {
      expect(screen.getByText("Error")).toBeInTheDocument();
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui/setActiveScreen",
        payload: "recovery",
      }),
    );

    getItemSpy.mockRestore();
  });
});
