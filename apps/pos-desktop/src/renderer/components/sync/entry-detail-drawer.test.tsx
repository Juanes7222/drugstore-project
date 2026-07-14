import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntryDetailDrawer } from "./entry-detail-drawer";
import type { PermanentFailureEntry } from "../../../domain/sync/sync-metrics.service";

const baseEntry: PermanentFailureEntry = {
  id: "entry-001",
  operationType: "SALE_CREATION",
  operationUuid: "550e8400-e29b-41d4-a716-446655440000",
  payloadHash: "abc123def456",
  failureCategory: "NETWORK",
  lastErrorMessage: "Connection timed out",
  retryCount: 3,
  sourceCreatedAt: "2026-07-13T10:00:00.000Z",
  lastAttemptAt: "2026-07-13T10:30:00.000Z",
  payloadPreview: '{"saleId":"abc-123"}',
};

describe("EntryDetailDrawer", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Render structure ──────────────────────────────────────────────

  it("renders the drawer with dialog role", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    const drawer = screen.getByRole("dialog");
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute("aria-modal", "true");
  });

  it("renders the close button", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(
      screen.getByRole("button", { name: /Cerrar|Close/i }),
    ).toBeInTheDocument();
  });

  it("renders the title", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(screen.getByText("Entry Detail")).toBeInTheDocument();
  });

  // ── Metadata fields ───────────────────────────────────────────────

  it("renders operation type and UUID", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(screen.getByText("SALE_CREATION")).toBeInTheDocument();
    expect(
      screen.getByText("550e8400-e29b-41d4-a716-446655440000"),
    ).toBeInTheDocument();
  });

  it("renders PERMANENT_FAILURE status badge", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(screen.getByText("PERMANENT_FAILURE")).toBeInTheDocument();
  });

  it("renders failure category and error message", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(screen.getByText("NETWORK")).toBeInTheDocument();
    expect(screen.getByText("Connection timed out")).toBeInTheDocument();
  });

  it("renders retry count and created/last attempt timestamps", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(screen.getByText("3")).toBeInTheDocument();
    // formatRelativeTime is called but the output is locale-dependent;
    // just verify the labels exist
    expect(screen.getByText("Operation")).toBeInTheDocument();
    expect(screen.getByText("Retries")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Last Attempt")).toBeInTheDocument();
  });

  it("renders payload preview", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(
      screen.getByText('{"saleId":"abc-123"}'),
    ).toBeInTheDocument();
  });

  it("renders retry history and recovery actions sections", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(screen.getByText("Retry History")).toBeInTheDocument();
    expect(screen.getByText("Recovery Actions")).toBeInTheDocument();
  });

  it("shows empty messages for retry history and recovery actions", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(
      screen.getByText("No retry history available for this entry."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No recovery actions have been recorded."),
    ).toBeInTheDocument();
  });

  // ── Null/fallback values ──────────────────────────────────────────

  it("shows em dash when failureCategory is null", () => {
    const entry = { ...baseEntry, failureCategory: null };
    render(<EntryDetailDrawer entry={entry} onClose={onClose} />);

    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });

  it("shows em dash when lastErrorMessage is null", () => {
    const entry = { ...baseEntry, lastErrorMessage: null };
    render(<EntryDetailDrawer entry={entry} onClose={onClose} />);

    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });

  it("shows em dash when lastAttemptAt is null", () => {
    const entry = { ...baseEntry, lastAttemptAt: null };
    render(<EntryDetailDrawer entry={entry} onClose={onClose} />);

    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });

  it("shows placeholder when payloadPreview is empty", () => {
    const entry = { ...baseEntry, payloadPreview: "" };
    render(<EntryDetailDrawer entry={entry} onClose={onClose} />);

    expect(screen.getByText("No payload data")).toBeInTheDocument();
  });

  // ── Interactions ──────────────────────────────────────────────────

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();

    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    await user.click(
      screen.getByRole("button", { name: /Cerrar|Close/i }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", async () => {
    const user = userEvent.setup();

    const { container } = render(
      <EntryDetailDrawer entry={baseEntry} onClose={onClose} />,
    );

    // Backdrop is the first child of the fragment (the div with bg-black/20)
    const backdrop = container.firstElementChild!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
