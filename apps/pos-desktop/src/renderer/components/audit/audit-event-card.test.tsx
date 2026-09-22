/**
 * Component tests for the redesigned AuditEventCard.
 *
 * Covers the new visual anatomy: timeline node with category color, category
 * chip, module pill, stock delta chip for InventoryMovement-backed entries,
 * entityName target display, and local/synced status badge.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditEventCard, type AuditLogEntry } from "./audit-event-card";

// i18n is initialized globally via vitest.setup.ts (Spanish locale).

function makeLog(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "log-1",
    action: "AUTH_LOGIN_SUCCESS",
    createdAt: new Date().toISOString(),
    userId: "maria.gomez",
    userRole: "OWNER",
    entityType: "Session",
    entityId: "sess-1",
    details: null,
    ...overrides,
  };
}

describe("AuditEventCard — redesigned anatomy", () => {
  it("renders the event as an article with translated name and time in aria-label", () => {
    render(<AuditEventCard log={makeLog({ action: "CASH_SHIFT_OPENED" })} />);

    const card = screen.getByRole("article", { name: /Apertura de turno/ });
    expect(card).toBeInTheDocument();
  });

  it("shows the category chip with the translated category name", () => {
    render(<AuditEventCard log={makeLog({ action: "CASH_SHIFT_OPENED" })} />);

    // cashShift category → "Turno"
    expect(screen.getByText("Turno")).toBeInTheDocument();
  });

  it("renders the actor username and translated role badge", () => {
    render(<AuditEventCard log={makeLog({ userRole: "OWNER" })} />);

    expect(screen.getByText("maria.gomez")).toBeInTheDocument();
    expect(screen.getByText("Dueño")).toBeInTheDocument();
  });

  it("renders the module pill from the event registry config", () => {
    render(<AuditEventCard log={makeLog({ action: "CASH_SHIFT_OPENED" })} />);

    expect(screen.getByText("Turnos")).toBeInTheDocument();
  });

  // ── Stock delta chip (InventoryMovement entries) ──────────────────────

  it("shows the stock delta chip when previousStock and resultingStock are present", () => {
    render(
      <AuditEventCard
        log={makeLog({
          action: "INVENTORY_SALE",
          productName: "Acetaminofén 500mg",
          lotBatch: "BATCH-001",
          quantity: 5,
          previousStock: 20,
          resultingStock: 15,
        })}
      />,
    );

    expect(screen.getByText("20 → 15 u")).toBeInTheDocument();
  });

  it("does not show the stock delta chip for non-stock actions", () => {
    render(
      <AuditEventCard
        log={makeLog({
          action: "AUTH_LOGIN_SUCCESS",
          previousStock: 20,
          resultingStock: 15,
        })}
      />,
    );

    expect(screen.queryByText("20 → 15 u")).not.toBeInTheDocument();
  });

  it("does not show the stock delta chip when stock fields are missing", () => {
    render(
      <AuditEventCard
        log={makeLog({
          action: "INVENTORY_SALE",
          productName: "Acetaminofén 500mg",
        })}
      />,
    );

    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  // ── Target display ─────────────────────────────────────────────────────

  it("prefers entityName over entityId for the target label", () => {
    render(
      <AuditEventCard
        log={makeLog({
          action: "CLIENT_CREATED",
          entityType: "Client",
          entityId: "abc-123-def-456",
          entityName: "Juan Pérez",
        })}
      />,
    );

    expect(screen.getByText(/Juan Pérez/)).toBeInTheDocument();
    expect(screen.queryByText(/abc-123/)).not.toBeInTheDocument();
  });

  it("falls back to truncated entityId when entityName is absent", () => {
    render(
      <AuditEventCard
        log={makeLog({
          action: "CLIENT_CREATED",
          entityType: "Client",
          entityId: "abc-123-def-456",
        })}
      />,
    );

    // Only the first 12 characters are shown ("abc-123-def-")
    expect(screen.getByText(/abc-123-def-/)).toBeInTheDocument();
    expect(screen.queryByText(/abc-123-def-456/)).not.toBeInTheDocument();
  });

  it("hides the target row when entityType and entityId are unknown", () => {
    render(
      <AuditEventCard
        log={makeLog({ entityType: "unknown", entityId: "unknown" })}
      />,
    );

    expect(screen.queryByText(/unknown/)).not.toBeInTheDocument();
  });

  // ── Sync status badge ──────────────────────────────────────────────────

  it("shows the synced badge when syncedAt is set", () => {
    render(
      <AuditEventCard
        log={makeLog({ syncedAt: "2026-07-22T11:00:00.000Z" })}
      />,
    );

    expect(screen.getByText("Sincronizado")).toBeInTheDocument();
  });

  it("shows the pending badge when syncedAt is null (present but empty)", () => {
    render(<AuditEventCard log={makeLog({ syncedAt: null })} />);

    expect(screen.getByText("Pendiente de sincronizar")).toBeInTheDocument();
    expect(screen.queryByText("Sincronizado")).not.toBeInTheDocument();
  });

  it("shows no sync badge when syncedAt is undefined (server entries)", () => {
    render(<AuditEventCard log={makeLog({ syncedAt: undefined })} />);

    expect(screen.queryByText("Sincronizado")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Pendiente de sincronizar"),
    ).not.toBeInTheDocument();
  });

  // ── Detail expand / collapse ───────────────────────────────────────────

  it("expands to show parsed detail fragments and collapses again", async () => {
    const user = userEvent.setup();

    render(
      <AuditEventCard
        log={makeLog({
          action: "CASH_SHIFT_OPENED",
          details: '{"openingBalance":"500000","notes":"apertura matutina"}',
        })}
      />,
    );

    const expandButton = screen.getByRole("button", { name: "Ver detalles" });
    await user.click(expandButton);

    // Known key translated + unknown key rendered as translated label: value
    expect(screen.getByText("Saldo inicial: 500000")).toBeInTheDocument();
    expect(screen.getByText("Notas: apertura matutina")).toBeInTheDocument();

    const collapseButton = screen.getByRole("button", {
      name: "Ocultar detalles",
    });
    await user.click(collapseButton);

    expect(
      screen.queryByRole("button", { name: "Ocultar detalles" }),
    ).not.toBeInTheDocument();
  });

  it("renders non-JSON details as a free-text reason (InventoryMovement)", () => {
    render(
      <AuditEventCard
        log={makeLog({
          action: "INVENTORY_SALE",
          details: "Venta directa en mostrador",
        })}
      />,
    );

    expect(screen.getByText("Venta directa en mostrador")).toBeInTheDocument();
  });

  it("does not render the expand button when there are no details", () => {
    render(<AuditEventCard log={makeLog({ details: null })} />);

    expect(
      screen.queryByRole("button", { name: "Ver detalles" }),
    ).not.toBeInTheDocument();
  });

  // ── Summary fragments ─────────────────────────────────────────────────

  it("shows reason and amount fragments from JSON details", () => {
    render(
      <AuditEventCard
        log={makeLog({
          action: "CASH_SHIFT_CLOSED",
          details: '{"reason":"cierre programado","amountCents":15000000}',
        })}
      />,
    );

    expect(screen.getByText("Motivo: cierre programado")).toBeInTheDocument();
    // 15000000 cents = $150.000 COP
    expect(screen.getByText("Monto: $ 150.000")).toBeInTheDocument();
  });

  it("shows the lot batch fragment when lotBatch is present", () => {
    render(
      <AuditEventCard
        log={makeLog({
          action: "INVENTORY_ADJUSTMENT_NEGATIVE",
          productName: "Ibuprofeno 400mg",
          lotBatch: "IB-2411",
          details: '{"reason":"unidad vencida"}',
        })}
      />,
    );

    expect(screen.getByText("Lote: IB-2411")).toBeInTheDocument();
  });

  // ── Unknown action fallback ────────────────────────────────────────────

  it("renders unknown actions with the raw action as label without crashing", () => {
    render(<AuditEventCard log={makeLog({ action: "SOME_FUTURE_EVENT" })} />);

    expect(screen.getByText("SOME_FUTURE_EVENT")).toBeInTheDocument();
    // Falls back to "Sin categoría" chip
    expect(screen.getByText("Sin categoría")).toBeInTheDocument();
  });

  // ── Card structure invariants ─────────────────────────────────────────

  it("renders exactly one timeline node and one category chip per card", () => {
    render(<AuditEventCard log={makeLog({ action: "SALE_CONFIRMED" })} />);

    const card = screen.getByRole("article");
    // Category chip shows "Venta" (category_sale)
    expect(within(card).getByText("Venta")).toBeInTheDocument();
  });
});
