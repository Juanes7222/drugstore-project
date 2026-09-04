/**
 * Component tests for the KpiGrid LAN-aware pending tile.
 *
 * Covers the actionable headline (audit batches excluded) and the
 * subordinate audit caption that stays hidden when the backlog is zero.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiGrid } from "./kpi-grid";
import type { QueueCounts } from "../../../domain/sync/sync-metrics.service";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeCounts(overrides: Partial<QueueCounts> = {}): QueueCounts {
  return {
    pending: 0,
    stalePending: 0,
    failed: 0,
    permanentFailure: 0,
    completed24h: 0,
    completedTotal: 0,
    pendingLanRelayed: 0,
    pendingNotRelayed: 0,
    lanRelayedLast5Min: 0,
    pendingActionable: 0,
    auditPending: 0,
    ...overrides,
  };
}

function renderGrid(counts: QueueCounts) {
  render(
    <KpiGrid
      counts={counts}
      successRateDisplay="—"
      backupSummary={null}
      onBackupClick={vi.fn()}
    />,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("KpiGrid", () => {
  describe("pending actionable headline", () => {
    it("shows pendingActionable instead of raw pending", () => {
      renderGrid(
        makeCounts({ pending: 12, pendingActionable: 7, auditPending: 0 }),
      );

      const tile = screen.getByTestId("kpi-pending");

      expect(tile).toHaveTextContent("7");
      expect(tile.textContent ?? "").not.toContain("12");
    });
  });

  describe("audit backlog caption", () => {
    it("shows the audit count as a subordinate caption when above zero", () => {
      renderGrid(
        makeCounts({ pending: 9, pendingActionable: 6, auditPending: 3 }),
      );

      const caption = screen.getByTestId("kpi-pending-audit");

      expect(caption).toBeInTheDocument();
      expect(caption).toHaveTextContent("3");
    });

    it("hides the audit caption when the backlog is zero", () => {
      renderGrid(
        makeCounts({ pending: 6, pendingActionable: 6, auditPending: 0 }),
      );

      expect(screen.queryByTestId("kpi-pending-audit")).not.toBeInTheDocument();
    });
  });
});
