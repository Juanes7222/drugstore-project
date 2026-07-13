/**
 * Component tests for SyncPulse.
 *
 * Covers all three sync states (online, offline, draining) and accessibility.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SyncPulse } from "./sync-pulse";

describe("SyncPulse", () => {
  describe("SPP-01: online state", () => {
    it("renders a status region with the correct data attribute", () => {
      render(<SyncPulse state="online" />);

      const bar = screen.getByRole("status");
      expect(bar).toBeInTheDocument();
      expect(bar).toHaveAttribute("data-sync-state", "online");
    });
  });

  describe("SPP-02: offline state", () => {
    it("renders with data-sync-state set to offline", () => {
      render(<SyncPulse state="offline" />);

      expect(screen.getByRole("status")).toHaveAttribute(
        "data-sync-state",
        "offline",
      );
    });
  });

  describe("SPP-03: draining state", () => {
    it("renders with data-sync-state set to draining", () => {
      render(<SyncPulse state="draining" />);

      expect(screen.getByRole("status")).toHaveAttribute(
        "data-sync-state",
        "draining",
      );
    });
  });

  it("has aria-live polite for accessibility announcements", () => {
    render(<SyncPulse state="online" />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});
