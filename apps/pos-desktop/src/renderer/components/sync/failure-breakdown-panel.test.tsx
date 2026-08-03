import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FailureBreakdownPanel } from "./failure-breakdown-panel";
import type { FailureBreakdownEntry } from "../../../domain/sync/sync-metrics.service";

const mockEntries: FailureBreakdownEntry[] = [
  { category: "NETWORK", count: 12, mostRecent: "2026-07-13T10:30:00.000Z" },
  { category: "VALIDATION", count: 3, mostRecent: "2026-07-12T08:15:00.000Z" },
  { category: "AUTH", count: 1, mostRecent: null },
];

describe("FailureBreakdownPanel", () => {
  const baseProps = {
    data: mockEntries,
    selectedCategory: null,
    onSelectCategory: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Render structure ──────────────────────────────────────────────

  it("renders the card title", () => {
    render(<FailureBreakdownPanel {...baseProps} />);

    expect(
      screen.getByText("Desglose de fallos"),
    ).toBeInTheDocument();
  });

  it("renders a pill for each entry", () => {
    render(<FailureBreakdownPanel {...baseProps} />);

    expect(
      screen.getByRole("button", { name: /Red/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Validación/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Autenticación/ }),
    ).toBeInTheDocument();
  });

  it("renders pill count badges", () => {
    render(<FailureBreakdownPanel {...baseProps} />);

    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  // ── Most recent time ──────────────────────────────────────────────

  it("shows 'latest: ... ago' for entries with mostRecent", () => {
    render(<FailureBreakdownPanel {...baseProps} />);

    // Both NETWORK and VALIDATION have a non-null mostRecent
    const pills = screen.getAllByRole("button");
    // Each pill contains the category, count, and optionally the time text
    const networkPill = pills[0];
    expect(networkPill.textContent).toMatch(/último/i);
  });

  it("does NOT show 'latest' for entries without mostRecent", () => {
    render(<FailureBreakdownPanel {...baseProps} />);

    // AUTH has mostRecent: null — its pill should not show "último"
    const authPill = screen.getByRole("button", { name: /Autenticación/ });
    expect(authPill.textContent).not.toMatch(/último/i);
  });

  // ── Empty state ───────────────────────────────────────────────────

  it("shows empty message when no data is provided", () => {
    render(<FailureBreakdownPanel {...baseProps} data={[]} />);

    expect(
      screen.getByText("No hay datos de fallos disponibles."),
    ).toBeInTheDocument();
  });

  it("does not render pills when data is empty", () => {
    render(<FailureBreakdownPanel {...baseProps} data={[]} />);

    expect(
      screen.queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  // ── Selection state ───────────────────────────────────────────────

  it("applies selected styling to the active category pill", () => {
    render(
      <FailureBreakdownPanel
        {...baseProps}
        selectedCategory="NETWORK"
      />,
    );

    const selectedPill = screen.getByRole("button", { name: /Red/ });
    // Selected pill uses the pharma brand background class
    expect(selectedPill.className).toContain("bg-pharma");
  });

  it("applies default styling to unselected pills", () => {
    render(
      <FailureBreakdownPanel
        {...baseProps}
        selectedCategory="NETWORK"
      />,
    );

    const unselectedPill = screen.getByRole("button", {
      name: /Validación/,
    });
    expect(unselectedPill.className).toContain("bg-surface");
  });

  // ── Interactions ──────────────────────────────────────────────────

  it("calls onSelectCategory with the category when clicking an unselected pill", async () => {
    const user = userEvent.setup();
    const onSelectCategory = vi.fn();

    render(
      <FailureBreakdownPanel
        {...baseProps}
        onSelectCategory={onSelectCategory}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Red/ }),
    );
    expect(onSelectCategory).toHaveBeenCalledWith("NETWORK");
  });

  it("calls onSelectCategory with null when clicking the already-selected pill", async () => {
    const user = userEvent.setup();
    const onSelectCategory = vi.fn();

    render(
      <FailureBreakdownPanel
        {...baseProps}
        selectedCategory="NETWORK"
        onSelectCategory={onSelectCategory}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Red/ }),
    );
    expect(onSelectCategory).toHaveBeenCalledWith(null);
  });

  it("switches selection when clicking a different category", async () => {
    const user = userEvent.setup();
    const onSelectCategory = vi.fn();

    render(
      <FailureBreakdownPanel
        {...baseProps}
        selectedCategory="NETWORK"
        onSelectCategory={onSelectCategory}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Validación/ }),
    );
    expect(onSelectCategory).toHaveBeenCalledWith("VALIDATION");
  });

  // ── Large numbers ─────────────────────────────────────────────────

  it("formats large count numbers with toLocaleString", () => {
    const largeData: FailureBreakdownEntry[] = [
      { category: "NETWORK", count: 1500, mostRecent: null },
    ];

    render(
      <FailureBreakdownPanel
        {...baseProps}
        data={largeData}
      />,
    );

    // es-CO locale uses "." as thousands separator: 1500 → "1.500"
    const countBadge = screen.getByText("1.500");
    expect(countBadge).toBeInTheDocument();
    expect(countBadge.className).toContain("tabular-nums");
  });
});
