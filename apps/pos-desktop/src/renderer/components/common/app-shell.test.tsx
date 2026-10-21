/**
 * Component tests for AppShell.
 *
 * Covers: cash-shift header rendering, real-signal sync state derivation,
 * the sync chip and QuickSwitch in the header row, and children rendering.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// SyncAttentionBanner calls getLocalDatabase() and createSyncMetricsService()
// on mount — mock it as a no-op to keep the shell test focused.
vi.mock("../../../infrastructure/local-database", () => ({
  getLocalDatabase: vi.fn(),
}));
vi.mock("../../../domain/sync/sync-metrics.service", () => ({
  createSyncMetricsService: vi.fn(),
}));

// QuickSwitch is an auth component that reads from the Zustand store.
// Mock it as a simple placeholder so the shell test stays focused on layout.
vi.mock("../auth/quick-switch.component", () => ({
  QuickSwitch: () => <div data-testid="quick-switch-mock" />,
}));

// SyncStatusChip consumes the AppShell-derived sync view — mock its surface
// and let the pulse-derivation tests drive the real hooks below.
vi.mock("./sync-status-chip", () => ({
  SyncStatusChip: () => <div data-testid="sync-chip-mock" />,
}));

// Real-signal hooks backing the Ambient Sync Pulse state.
const localSyncOverrides: Record<string, unknown> = {};
vi.mock("../../hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));
vi.mock("../../hooks/use-local-sync", () => ({
  useLocalSync: () => ({
    status: "CONNECTED",
    isConnected: true,
    isReconnecting: false,
    isDisconnected: false,
    isThisWorkstationHub: false,
    hasPendingOps: false,
    pendingPushCount: 0,
    pendingPullCount: 0,
    lastSyncAt: null,
    currentHub: null,
    ...localSyncOverrides,
  }),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AppShell", () => {
  const defaultProps = {
    openingBalanceCents: 500_000,
    openedAt: "2026-07-13T08:00:00.000Z",
  };

  describe("APP-01: cash shift header", () => {
    it("renders the opening balance formatted in COP", () => {
      render(
        <AppShell {...defaultProps}>
          <div>content</div>
        </AppShell>,
      );

      // openingBalanceCents=500_000 → 5000 COP → "$ 5.000"
      expect(screen.getByText(/\$\s*5\.000/)).toBeInTheDocument();
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

  describe("APP-02: SyncPulse derived from real sync signals", () => {
    it("rests online when the browser is online and the queue is empty", () => {
      render(
        <AppShell {...defaultProps}>
          <div>content</div>
        </AppShell>,
      );

      const pulseBar = screen.getByRole("status");
      expect(pulseBar).toHaveAttribute("data-sync-state", "online");
    });

    it("show draining while local operations await replication", () => {
      localSyncOverrides.hasPendingOps = true;
      try {
        render(
          <AppShell {...defaultProps}>
            <div>content</div>
          </AppShell>,
        );

        const pulseBar = screen.getByRole("status");
        expect(pulseBar).toHaveAttribute("data-sync-state", "draining");
      } finally {
        delete localSyncOverrides.hasPendingOps;
      }
    });
  });

  describe("APP-03: header row instruments", () => {
    it("renders the sync status chip in the header row", () => {
      render(
        <AppShell {...defaultProps}>
          <div>content</div>
        </AppShell>,
      );

      expect(screen.getByTestId("sync-chip-mock")).toBeInTheDocument();
    });

    it("renders the QuickSwitch component in the header area", () => {
      render(
        <AppShell {...defaultProps}>
          <div>content</div>
        </AppShell>,
      );

      expect(screen.getByTestId("quick-switch-mock")).toBeInTheDocument();
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

    it("renders the main element", () => {
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
