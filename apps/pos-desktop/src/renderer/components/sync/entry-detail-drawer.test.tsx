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

    expect(screen.getByText("Detalle de entrada")).toBeInTheDocument();
  });

  // ── Metadata fields ───────────────────────────────────────────────

  it("renders the operation type but not the raw UUID", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    // Unknown op types fall back to the raw value; raw UUIDs are
    // deliberately excluded from the non-technical drawer.
    expect(screen.getByText("SALE_CREATION")).toBeInTheDocument();
    expect(
      screen.queryByText("550e8400-e29b-41d4-a716-446655440000"),
    ).not.toBeInTheDocument();
  });

  it("renders the retry count badge", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(screen.getByText(/3 intentos/)).toBeInTheDocument();
  });

  it("uses the singular retry label for a single retry", () => {
    render(
      <EntryDetailDrawer
        entry={{ ...baseEntry, retryCount: 1 }}
        onClose={onClose}
      />,
    );

    expect(screen.getByText(/1 intento/)).toBeInTheDocument();
  });

  it("renders failure category and error message", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(screen.getByText("Red")).toBeInTheDocument();
    expect(screen.getByText("Connection timed out")).toBeInTheDocument();
  });

  it("renders the timeline labels", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(screen.getByText("Cronología")).toBeInTheDocument();
    expect(screen.getByText("Creado")).toBeInTheDocument();
    expect(screen.getByText("Último intento")).toBeInTheDocument();
  });

  it("renders the human-readable payload summary instead of raw JSON", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(screen.getByText("venta: abc-123")).toBeInTheDocument();
    expect(
      screen.queryByText('{"saleId":"abc-123"}'),
    ).not.toBeInTheDocument();
  });

  it("renders retry history and recovery actions sections", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(screen.getByText("Historial de reintentos")).toBeInTheDocument();
    expect(screen.getByText("Acciones de recuperación")).toBeInTheDocument();
  });

  it("shows empty messages for retry history and recovery actions", () => {
    render(<EntryDetailDrawer entry={baseEntry} onClose={onClose} />);

    expect(
      screen.getByText("No hay historial de reintentos disponible."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No se han registrado acciones de recuperación."),
    ).toBeInTheDocument();
  });

  // ── Null/fallback values ──────────────────────────────────────────

  it("shows em dash when lastAttemptAt is null", () => {
    const entry = { ...baseEntry, lastAttemptAt: null };
    render(<EntryDetailDrawer entry={entry} onClose={onClose} />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("does not render a category badge when failureCategory is null", () => {
    const entry = { ...baseEntry, failureCategory: null };
    render(<EntryDetailDrawer entry={entry} onClose={onClose} />);

    expect(screen.queryByText("Red")).not.toBeInTheDocument();
  });

  it("does not render the payload section when payloadPreview is empty", () => {
    const entry = { ...baseEntry, payloadPreview: "" };
    render(<EntryDetailDrawer entry={entry} onClose={onClose} />);

    expect(screen.queryByText("Sin datos de payload")).not.toBeInTheDocument();
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

    // Backdrop is the first child of the fragment (the div with bg-ink/20)
    const backdrop = container.firstElementChild!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
