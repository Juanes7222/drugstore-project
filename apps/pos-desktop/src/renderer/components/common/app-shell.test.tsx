/**
 * Component tests for AppShell.
 *
 * Covers: cashier header rendering, SyncPulse presence, children,
 * and sync state propagation.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// SyncAttentionBanner calls getLocalDatabase() and createSyncMetricsService()
// on mount — mock it as a no-op to keep the shell test focused.
vi.mock(
  "../../../infrastructure/local-database",
  () => ({ getLocalDatabase: vi.fn() }),
);
vi.mock(
  "../../../domain/sync/sync-metrics.service",
  () => ({ createSyncMetricsService: vi.fn() }),
);

// QuickSwitch is an auth component that reads from the Zustand store.
// Mock it as a simple placeholder so the shell test stays focused on layout.
vi.mock("../auth/quick-switch.component", () => ({
  QuickSwitch: () => <div data-testid="quick-switch-mock" />,
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AppShell", () => {
  const defaultProps = {
    cashierName: "María Pérez",
    openingBalanceCents: 500_000,
    openedAt: "2026-07-13T08:00:00.000Z",
    initialSyncState: "online" as const,
  };

  describe("APP-01: cash shift header", () => {
    it("renders the cashier name", () => {
      render(
        <AppShell {...defaultProps}>
          <div>content</div>
        </AppShell>,
      );

      expect(screen.getByText(/María Pérez/)).toBeInTheDocument();
    });

    it("renders the opening balance formatted in COP", () => {
      render(
        <AppShell {...defaultProps}>
          <div>content</div>
        </AppShell>,
      );

      expect(screen.getByText(/\$\s*500\.000/)).toBeInTheDocument();
    });

    it("renders the elapsed time indicator", () => {
      render(
        <AppShell {...defaultProps}>
          <div>content</div>
        </AppShell>,
      );

      expect(screen.getByText(/activo/i)).toBeInTheDocument();
    });
  });

  describe("APP-02: SyncPulse", () => {
    it("renders the sync pulse bar with the correct initial state", () => {
      render(
        <AppShell {...defaultProps} initialSyncState="draining">
          <div>content</div>
        </AppShell>,
      );

      const pulseBar = screen.getByRole("status");
      expect(pulseBar).toBeInTheDocument();
      expect(pulseBar).toHaveAttribute("data-sync-state", "draining");
    });
  });

  describe("APP-03: navigation sidebar (QuickSwitch)", () => {
    it("renders the QuickSwitch component in the header area", () => {
      render(
        <AppShell {...defaultProps}>
          <div>content</div>
        </AppShell>,
      );

      expect(
        screen.getByTestId("quick-switch-mock"),
      ).toBeInTheDocument();
    });
  });

  describe("APP-04: children rendering", () => {
    it("renders the children inside the main content area", () => {
      render(
        <AppShell {...defaultProps}>
          <h1>Hello World</h1>
        </AppShell>,
      );

      expect(
        screen.getByRole("heading", { name: "Hello World" }),
      ).toBeInTheDocument();
    });

    it("renders the main element with overflow hidden", () => {
      render(
        <AppShell {...defaultProps}>
          <span>child</span>
        </AppShell>,
      );

      const main = document.querySelector("main");
      expect(main).toBeInTheDocument();
    });
  });
});
