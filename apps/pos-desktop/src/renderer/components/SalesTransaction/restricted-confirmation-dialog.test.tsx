/**
 * Component tests for RestrictedConfirmationDialog.
 *
 * Covers: null/empty states, open/closed visibility, confirm/cancel
 * callbacks, formatted currency display, and translation wiring.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RestrictedConfirmationDialog } from "./restricted-confirmation-dialog";
import { formatShortDate } from "@/utils/format-date";
import type { CatalogItem } from "@/services/catalog-service";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const createItem = (overrides?: Partial<CatalogItem>): CatalogItem => ({
  id: "ITEM-001",
  name: "Amoxicilina 500mg",
  genericName: "Amoxicilina",
  saleType: "RX",
  requiresPrescription: true,
  invimaCertificate: "INVIMA-2024-12345",
  lotCode: "L2407A",
  lotExpirationDate: "2027-07-15",
  unitPriceCents: 15000,
  hasCompleteData: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("RestrictedConfirmationDialog", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Null / empty guards ──────────────────────────────────────────────

  it("returns null when item is null", () => {
    const { container } = render(
      <RestrictedConfirmationDialog
        item={null}
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("returns null when unitPriceCents is null", () => {
    const { container } = render(
      <RestrictedConfirmationDialog
        item={createItem({ unitPriceCents: null })}
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  // ── Visibility ───────────────────────────────────────────────────────

  it("renders dialog content when open is true and item is valid", () => {
    render(
      <RestrictedConfirmationDialog
        item={createItem()}
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(
      screen.getByText("Amoxicilina 500mg"),
    ).toBeInTheDocument();

    // The title and confirm button both contain the same translation text
    expect(
      screen.getAllByText("Confirmar venta restringida").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("does not render dialog content when open is false", () => {
    render(
      <RestrictedConfirmationDialog
        item={createItem()}
        open={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(
      screen.queryByText("Confirmar venta restringida"),
    ).not.toBeInTheDocument();
  });

  // ── Content ──────────────────────────────────────────────────────────

  it("displays the product name and generic name", () => {
    const item = createItem();

    render(
      <RestrictedConfirmationDialog
        item={item}
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText(item.name)).toBeInTheDocument();
    expect(screen.getByText(item.genericName)).toBeInTheDocument();
  });

  it("displays the formatted price (es-CO, COP)", () => {
    const item = createItem({ unitPriceCents: 15000 });

    render(
      <RestrictedConfirmationDialog
        item={item}
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    // es-CO: $ 15.000 (with non-breaking space)
    expect(screen.getByText(/\$/, { selector: "p" })).toBeInTheDocument();
  });

  it("displays lot code and expiration date", () => {
    render(
      <RestrictedConfirmationDialog
        item={createItem()}
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText(/L2407A/)).toBeInTheDocument();
    // formatShortDate("2027-07-15") with es locale → "15/07/27" (2-digit year)
    const formattedDate = formatShortDate("2027-07-15");
    expect(screen.getByText(new RegExp(formattedDate))).toBeInTheDocument();
  });

  // ── Callbacks ────────────────────────────────────────────────────────

  it("calls onConfirm when the confirm button is clicked", async () => {
    const user = userEvent.setup();

    render(
      <RestrictedConfirmationDialog
        item={createItem()}
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Confirmar venta restringida",
      }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the cancel button is clicked", async () => {
    const user = userEvent.setup();

    render(
      <RestrictedConfirmationDialog
        item={createItem()}
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Cancelar" }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the dialog is dismissed (Escape)", async () => {
    const user = userEvent.setup();

    render(
      <RestrictedConfirmationDialog
        item={createItem()}
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    // Radix dialog's onOpenChange fires with false on Escape key
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // ── Translation keys ─────────────────────────────────────────────────

  it("renders INVIMA certificate and sale type in the warning", () => {
    const item = createItem({
      invimaCertificate: "INVIMA-2024-XYZ",
      saleType: "RX",
    });

    render(
      <RestrictedConfirmationDialog
        item={item}
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(
      screen.getByText(/INVIMA-2024-XYZ/),
    ).toBeInTheDocument();
    expect(screen.getByText(/RX/)).toBeInTheDocument();
  });
});
