/**
 * Component tests for ShiftHistorySection — load-more pagination.
 *
 * The section renders the shift table and a single "Load more" button
 * driven by keyset-cursor pagination (no prev/next offset controls).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Prisma } from "@pharmacy/database/local";
import { ShiftHistorySection } from "./shift-history-section";
import type { CashShiftRecord } from "../../../domain/cash-shift/cash-shift.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShift(index: number): CashShiftRecord {
  return {
    // Unpadded so the table's 8-char id prefix stays distinguishable.
    id: `shift-${index}`,
    workstationId: "ws-1",
    userId: "user-1",
    state: "CLOSED",
    openedAt: new Date(Date.UTC(2026, 6, 1, 8, index)),
    closedAt: new Date(Date.UTC(2026, 6, 1, 18, index)),
    closedByUserId: "user-1",
    openingBalance: new Prisma.Decimal("100000"),
    openingNotes: null,
    expectedClosingAmount: new Prisma.Decimal("0"),
    actualClosingAmount: new Prisma.Decimal("0"),
    closingDifference: new Prisma.Decimal("0"),
    closingNotes: null,
    forcedClose: false,
    hasExtendedAlert: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const shifts = [makeShift(1), makeShift(2)];

function renderSection(overrides: Partial<Parameters<typeof ShiftHistorySection>[0]> = {}) {
  const props = {
    history: shifts,
    historyTotal: 5,
    historyLoading: false,
    loadingMore: false,
    hasMore: true,
    onLoadMore: vi.fn(),
    ...overrides,
  };
  render(<ShiftHistorySection {...props} />);
  return props;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ShiftHistorySection", () => {
  it("renders the loaded shifts and the total count", () => {
    renderSection();

    expect(screen.getByText("5 turno(s)")).toBeInTheDocument();
    expect(screen.getByText("SHIFT-1")).toBeInTheDocument();
    expect(screen.getByText("SHIFT-2")).toBeInTheDocument();
  });

  it("shows the load-more button while more rows exist", () => {
    renderSection();

    expect(
      screen.getByRole("button", { name: "Cargar más" }),
    ).toBeInTheDocument();
  });

  it("hides the load-more button when all rows are loaded", () => {
    renderSection({ hasMore: false });

    expect(
      screen.queryByRole("button", { name: "Cargar más" }),
    ).not.toBeInTheDocument();
  });

  it("disables the button and shows the loading label while appending", () => {
    renderSection({ loadingMore: true });

    const button = screen.getByRole("button", { name: "Cargando..." });
    expect(button).toBeDisabled();
  });

  it("calls onLoadMore when the button is clicked", async () => {
    const user = userEvent.setup();
    const props = renderSection();

    await user.click(screen.getByRole("button", { name: "Cargar más" }));

    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("shows the initial loading state instead of the table", () => {
    renderSection({ history: [], historyLoading: true });

    expect(screen.getByText("Cargando...")).toBeInTheDocument();
    expect(screen.queryByText("SHIFT-1")).not.toBeInTheDocument();
  });

  it("shows the empty state when there is no history", () => {
    renderSection({ history: [], historyTotal: 0, hasMore: false });

    expect(screen.getByText("No hay turnos registrados")).toBeInTheDocument();
  });
});
