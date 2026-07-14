import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntriesSection } from "./entries-section";
import type { PermanentFailureEntry } from "../../../domain/sync/sync-metrics.service";

const baseEntry: PermanentFailureEntry = {
  id: "entry-001",
  operationType: "SALE_CREATION",
  operationUuid: "uuid-1",
  payloadHash: "hash1",
  failureCategory: "NETWORK",
  lastErrorMessage: "Connection timed out",
  retryCount: 3,
  sourceCreatedAt: "2026-07-13T10:00:00.000Z",
  lastAttemptAt: "2026-07-13T10:30:00.000Z",
  payloadPreview: '{"saleId":"abc"}',
};

const staleEntry: PermanentFailureEntry = {
  ...baseEntry,
  id: "entry-002",
  operationType: "SYNC_PULL",
  failureCategory: null,
  lastErrorMessage: null,
  retryCount: 0,
};

const mockEntries = [baseEntry, staleEntry];

describe("EntriesSection", () => {
  const baseProps = {
    entries: mockEntries,
    actionLoading: null,
    sortField: "lastAttemptAt" as const,
    sortDir: "desc" as const,
    hasMore: false,
    selectedCategory: null,
    showDiscarded: false,
    retryDisabledMessage: undefined,
    sessionRole: "ADMIN",
    onSort: vi.fn(),
    onRetry: vi.fn(),
    onDiscard: vi.fn(),
    onSelect: vi.fn(),
    onLoadMore: vi.fn(),
    onRefresh: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Empty state ───────────────────────────────────────────────────

  it("shows empty message when entries is empty", () => {
    render(<EntriesSection {...baseProps} entries={[]} />);

    expect(
      screen.getByText("No error entries found."),
    ).toBeInTheDocument();
  });

  it("does not show entry count when entries is empty", () => {
    render(<EntriesSection {...baseProps} entries={[]} />);

    // The count span only renders when entries.length > 0
    const countEl = screen.queryByText("2");
    expect(countEl).not.toBeInTheDocument();
  });

  // ── Table rendering ───────────────────────────────────────────────

  it("renders the table title", () => {
    render(<EntriesSection {...baseProps} />);

    expect(screen.getByText("Error Entries")).toBeInTheDocument();
  });

  it("renders entry data in table rows", () => {
    render(<EntriesSection {...baseProps} />);

    expect(screen.getByText("SALE_CREATION")).toBeInTheDocument();
    expect(screen.getByText("SYNC_PULL")).toBeInTheDocument();
    expect(screen.getByText("NETWORK")).toBeInTheDocument();
  });

  it("renders entry count when entries exist", () => {
    render(<EntriesSection {...baseProps} />);

    // The count is rendered inline as "2 entries"
    expect(
      screen.getByText((content) => content.includes("2") && content.includes("entries")),
    ).toBeInTheDocument();
  });

  // ── Sortable headers ──────────────────────────────────────────────

  it("renders sortable column headers", () => {
    render(<EntriesSection {...baseProps} />);

    expect(screen.getByText("Operation")).toBeInTheDocument();
    expect(screen.getByText("Last Attempt")).toBeInTheDocument();
    expect(screen.getByText("Retries")).toBeInTheDocument();
  });

  it("shows ↓ indicator on the active sorted column (desc)", () => {
    render(<EntriesSection {...baseProps} />);

    const lastAttemptHeader = screen.getByText("Last Attempt");
    expect(lastAttemptHeader.parentElement?.textContent).toContain("\u2193");
  });

  it("shows ↑ indicator when sortDir is asc", () => {
    render(
      <EntriesSection
        {...baseProps}
        sortField="retryCount"
        sortDir="asc"
      />,
    );

    const retriesHeader = screen.getByText("Retries");
    expect(retriesHeader.parentElement?.textContent).toContain("\u2191");
  });

  it("calls onSort when a sortable header is clicked", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();

    render(<EntriesSection {...baseProps} onSort={onSort} />);

    await user.click(screen.getByText("Operation"));
    expect(onSort).toHaveBeenCalledWith("operationType");
  });

  // ── Row styling ───────────────────────────────────────────────────

  it("applies red left border to permanent failure entries", () => {
    const { container } = render(<EntriesSection {...baseProps} />);

    const rows = container.querySelectorAll("tbody tr");
    // entry-001 has retryCount > 0 → red border
    expect(rows[0].className).toContain("border-l-red-500");
  });

  it("applies yellow left border to stale-pending entries", () => {
    const { container } = render(<EntriesSection {...baseProps} />);

    const rows = container.querySelectorAll("tbody tr");
    // entry-002 has retryCount=0 and lastErrorMessage=null → yellow border
    expect(rows[1].className).toContain("border-l-yellow-400");
  });

  // ── Admin column ──────────────────────────────────────────────────

  it("renders Reintentar and Discard buttons for ADMIN role", () => {
    render(
      <EntriesSection {...baseProps} sessionRole="ADMIN" />,
    );

    const retryButtons = screen.getAllByText("Reintentar");
    const discardButtons = screen.getAllByText("Discard");
    expect(retryButtons).toHaveLength(2);
    expect(discardButtons).toHaveLength(2);
  });

  it("does NOT render Reintentar/Discard for non-ADMIN role", () => {
    render(
      <EntriesSection {...baseProps} sessionRole="CASHIER" />,
    );

    expect(screen.queryByText("Reintentar")).not.toBeInTheDocument();
    expect(screen.queryByText("Discard")).not.toBeInTheDocument();
  });

  // ── Action interactions ───────────────────────────────────────────

  it("calls onRetry when Reintentar button is clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<EntriesSection {...baseProps} onRetry={onRetry} />);

    const retryButtons = screen.getAllByText("Reintentar");
    await user.click(retryButtons[0]);
    expect(onRetry).toHaveBeenCalledWith("entry-001");
  });

  it("calls onDiscard when Discard button is clicked", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();

    render(<EntriesSection {...baseProps} onDiscard={onDiscard} />);

    const discardButtons = screen.getAllByText("Discard");
    await user.click(discardButtons[0]);
    expect(onDiscard).toHaveBeenCalledWith("entry-001");
  });

  it("calls onSelect when the preview link is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<EntriesSection {...baseProps} onSelect={onSelect} />);

    // Both entries share payloadPreview '{"saleId":"abc"}'; pick first button
    const previewBtns = screen.getAllByText(
      mockEntries[0].payloadPreview,
      { selector: "button" },
    );
    await user.click(previewBtns[0]);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "entry-001" }),
    );
  });

  // ── Loading state ─────────────────────────────────────────────────

  it("shows 'Cargando...' for the entry being retried", () => {
    render(
      <EntriesSection {...baseProps} actionLoading="entry-001" />,
    );

    expect(screen.getByText("Cargando...")).toBeInTheDocument();
    // The other entry still shows "Reintentar"
    expect(screen.getByText("Reintentar")).toBeInTheDocument();
  });

  it("disables Reintentar button when another entry is being retried", () => {
    render(
      <EntriesSection {...baseProps} actionLoading="entry-001" />,
    );

    const retryButtons = screen.getAllByText("Reintentar");
    expect(retryButtons[0]).toBeDisabled();
  });

  it("disables Discard button when actionLoading is active", () => {
    render(
      <EntriesSection {...baseProps} actionLoading="entry-001" />,
    );

    const discardButtons = screen.getAllByText("Discard");
    expect(discardButtons[0]).toBeDisabled();
  });

  it("shows retryDisabledMessage as tooltip and disables Reintentar", () => {
    render(
      <EntriesSection
        {...baseProps}
        retryDisabledMessage="Server is offline"
      />,
    );

    const retryButtons = screen.getAllByText("Reintentar");
    retryButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
      expect(btn.closest("button")).toHaveAttribute(
        "title",
        "Server is offline",
      );
    });
  });

  // ── Load more ─────────────────────────────────────────────────────

  it("shows 'Load more' button when hasMore is true", () => {
    render(<EntriesSection {...baseProps} hasMore={true} />);

    expect(
      screen.getByText("Load more"),
    ).toBeInTheDocument();
  });

  it("calls onLoadMore when Load more is clicked", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();

    render(
      <EntriesSection
        {...baseProps}
        hasMore={true}
        onLoadMore={onLoadMore}
      />,
    );

    await user.click(screen.getByText("Load more"));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not show 'Load more' when hasMore is false", () => {
    render(<EntriesSection {...baseProps} hasMore={false} />);

    expect(
      screen.queryByText("Load more"),
    ).not.toBeInTheDocument();
  });

  it("disables Load more when actionLoading is active", () => {
    render(
      <EntriesSection
        {...baseProps}
        hasMore={true}
        actionLoading="entry-001"
      />,
    );

    expect(screen.getByText("Load more")).toBeDisabled();
  });

  // ── Refresh button ────────────────────────────────────────────────

  it("renders Actualizar button", () => {
    render(<EntriesSection {...baseProps} />);

    expect(screen.getByText("Actualizar")).toBeInTheDocument();
  });

  it("calls onRefresh when Actualizar is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();

    render(
      <EntriesSection {...baseProps} onRefresh={onRefresh} />,
    );

    await user.click(screen.getByText("Actualizar"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables Actualizar when actionLoading is active", () => {
    render(
      <EntriesSection
        {...baseProps}
        actionLoading="entry-001"
      />,
    );

    expect(screen.getByText("Actualizar")).toBeDisabled();
  });

  // ── Filter badges ─────────────────────────────────────────────────

  it("shows selected category filter badge", () => {
    render(
      <EntriesSection
        {...baseProps}
        selectedCategory="NETWORK"
      />,
    );

    expect(
      screen.getByText(/filtered: NETWORK/i),
    ).toBeInTheDocument();
  });

  it("shows discarded badge when showDiscarded is true", () => {
    render(
      <EntriesSection {...baseProps} showDiscarded={true} />,
    );

    expect(
      screen.getByText("Showing discarded"),
    ).toBeInTheDocument();
  });
});
