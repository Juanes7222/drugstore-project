/**
 * Component tests for LanHubCard backoff and duplicate variants.
 *
 * Covers the calm backoff waiting state (never error red) and the hard
 * duplicate workstation-ID warning (raw code never rendered).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LanHubCard } from "./lan-hub-card";
import type { HubInfo } from "@pharmacy/shared-types";
import { HubRole, LocalSyncConnectionStatus } from "@pharmacy/shared-types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeHub(overrides: Partial<HubInfo> = {}): HubInfo {
  return {
    workstationId: "ws-hub",
    friendlyName: "Hub Principal",
    ipAddress: "192.168.1.10",
    port: 49500,
    hubScore: 100,
    role: HubRole.AUTO,
    isSelf: false,
    ...overrides,
  };
}

function makeLanCounts(
  overrides: Partial<{ pendingLanRelayed: number; pendingNotRelayed: number; lanRelayedLast5Min: number }> = {},
) {
  return {
    pendingLanRelayed: 0,
    pendingNotRelayed: 0,
    lanRelayedLast5Min: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("LanHubCard", () => {
  describe("backoff variant", () => {
    it("shows the waiting message when isBackoff is true", () => {
      render(
        <LanHubCard
          currentHub={makeHub()}
          status={LocalSyncConnectionStatus.CONNECTED}
          lanCounts={makeLanCounts()}
          lastSyncAt={null}
          lastSyncError={null}
          peersCount={1}
          isBackoff
        />,
      );

      expect(screen.getByTestId("lan-hub-primary")).toHaveTextContent(/En espera|Waiting/);
    });

    it("never renders a red error while backoff is active", () => {
      render(
        <LanHubCard
          currentHub={makeHub()}
          status={LocalSyncConnectionStatus.DISCONNECTED}
          lanCounts={makeLanCounts()}
          lastSyncAt={null}
          lastSyncError="hub unreachable"
          peersCount={1}
          isBackoff
        />,
      );

      expect(screen.queryByTestId("lan-hub-error")).not.toBeInTheDocument();
      expect(screen.queryByTestId("lan-hub-duplicate")).not.toBeInTheDocument();
      expect(screen.getByTestId("lan-hub-primary")).toHaveTextContent(/En espera|Waiting/);
    });
  });

  describe("duplicate variant", () => {
    it("shows the translated warning with the skipped count", () => {
      render(
        <LanHubCard
          currentHub={makeHub()}
          status={LocalSyncConnectionStatus.CONNECTED}
          lanCounts={makeLanCounts()}
          lastSyncAt={null}
          lastSyncError="DUPLICATE_WORKSTATION_ID:3"
          peersCount={1}
        />,
      );

      const warning = screen.getByTestId("lan-hub-duplicate");

      expect(warning).toBeInTheDocument();
      expect(warning).toHaveTextContent("3");
      expect(warning).toHaveTextContent(/duplicado|duplicate/i);
    });

    it("never renders the raw DUPLICATE_WORKSTATION_ID code", () => {
      const { container } = render(
        <LanHubCard
          currentHub={makeHub()}
          status={LocalSyncConnectionStatus.CONNECTED}
          lanCounts={makeLanCounts()}
          lastSyncAt={null}
          lastSyncError="DUPLICATE_WORKSTATION_ID:3"
          peersCount={1}
        />,
      );

      expect(screen.queryByText(/DUPLICATE_WORKSTATION_ID/)).not.toBeInTheDocument();
      expect(container.textContent ?? "").not.toContain("DUPLICATE_WORKSTATION_ID:3");
      expect(screen.queryByTestId("lan-hub-error")).not.toBeInTheDocument();
    });
  });
});
