/**
 * Component tests for ContingencyHistoryView.
 *
 * Covers: table rendering, empty state, trigger labels, active event indicator.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContingencyHistoryView } from "./contingency-history-view";
import type { ContingencyEventSummary } from "../../../domain/fiscal/fiscal-types";
import "@/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createEvent = (
  overrides: Partial<ContingencyEventSummary> = {},
): ContingencyEventSummary => ({
  id: "evt-1",
  startedAt: "2026-07-13T08:00:00.000Z",
  endedAt: "2026-07-13T10:30:00.000Z",
  workstationId: "ws-001",
  trigger: "NETWORK_LOST",
  triggerReason: "ISP outage",
  invoicesGenerated: 15,
  invoicesTransmitted: 12,
  invoicesExpired: 0,
  notifiedDian: true,
  ...overrides,
});

const defaultProps = {
  history: [createEvent(), createEvent({ trigger: "MANUAL_OVERRIDE" })],
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ContingencyHistoryView", () => {
  it("renders a table with contingency events", () => {
    render(<ContingencyHistoryView {...defaultProps} />);

    expect(screen.getByRole("region")).toBeInTheDocument();
    // Header
    expect(screen.getByText("Historial de Contingencia")).toBeInTheDocument();
    // Trigger labels
    expect(screen.getByText("Red perdida")).toBeInTheDocument();
    expect(screen.getByText("Anulación manual")).toBeInTheDocument();
    // Invoice counts
    const generatedCells = screen.getAllByText("15");
    expect(generatedCells.length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when history is empty", () => {
    render(<ContingencyHistoryView history={[]} />);

    expect(
      screen.getByText("No hay eventos de contingencia registrados."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("formats trigger labels correctly for all trigger types", () => {
    const history: ContingencyEventSummary[] = [
      createEvent({ trigger: "NETWORK_LOST", id: "e1" }),
      createEvent({ trigger: "MANUAL_OVERRIDE", id: "e2" }),
      createEvent({ trigger: "SERVER_UNREACHABLE", id: "e3" }),
    ];
    render(<ContingencyHistoryView history={history} />);

    expect(screen.getByText("Red perdida")).toBeInTheDocument();
    expect(screen.getByText("Anulación manual")).toBeInTheDocument();
    expect(screen.getByText("Servidor inaccesible")).toBeInTheDocument();
  });

  it('shows "Activo" for ongoing events with no endedAt', () => {
    const history = [createEvent({ endedAt: null })];
    render(<ContingencyHistoryView history={history} />);

    expect(screen.getByText("Activo")).toBeInTheDocument();
  });
});
