/**
 * Component tests for LicenseRedirect.
 *
 * Covers: license status ACTIVE, GRACE_PERIOD, EXPIRED, and fetch failure.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LicenseRedirect } from "./license-redirect";

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

describe("LicenseRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when the license status is ACTIVE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ status: "ACTIVE" }),
      }),
    );

    render(
      <LicenseRedirect>
        <p>Licensed content</p>
      </LicenseRedirect>,
    );

    await waitFor(() => {
      expect(screen.getByText("Licensed content")).toBeInTheDocument();
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("renders children when the license status is GRACE_PERIOD", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ status: "GRACE_PERIOD" }),
      }),
    );

    render(
      <LicenseRedirect>
        <p>Grace period content</p>
      </LicenseRedirect>,
    );

    await waitFor(() => {
      expect(screen.getByText("Grace period content")).toBeInTheDocument();
    });
  });

  it("renders children when the fetch fails (offline mode assumption)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );

    render(
      <LicenseRedirect>
        <p>Offline content</p>
      </LicenseRedirect>,
    );

    await waitFor(() => {
      expect(screen.getByText("Offline content")).toBeInTheDocument();
    });
  });

  it("dispatches setActiveScreen('recovery') and renders fallback when license is EXPIRED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ status: "EXPIRED" }),
      }),
    );

    render(
      <LicenseRedirect fallback={<p>License expired</p>}>
        <p>Content</p>
      </LicenseRedirect>,
    );

    await waitFor(() => {
      expect(screen.getByText("License expired")).toBeInTheDocument();
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui/setActiveScreen",
        payload: "recovery",
      }),
    );
  });

  it("ensures the fetch was called to /api/licensing/status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: "ACTIVE" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LicenseRedirect>
        <p>Content</p>
      </LicenseRedirect>,
    );

    await waitFor(() => {
      expect(screen.getByText("Content")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/licensing/status");
  });
});
