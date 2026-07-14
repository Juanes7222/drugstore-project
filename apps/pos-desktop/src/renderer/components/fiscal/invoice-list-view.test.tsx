/**
 * Component tests for InvoiceListView.
 *
 * Covers: table rendering, row selection, refresh action, empty state, loading.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InvoiceListView } from "./invoice-list-view";
import type { InvoiceListItem } from "../../../domain/fiscal/fiscal-types";
import "@/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseInvoice = {
  id: "inv-1",
  invoiceNumber: "FE-001",
  contingencyNumber: null,
  invoiceType: "ELECTRONIC_INVOICE" as const,
  status: "TRANSMITTED_AUTHORIZED" as const,
  issuedAt: "2026-07-13T10:00:00.000Z",
  expiresAt: "2026-08-12T10:00:00.000Z",
  cufeProvisional: "cufe-prov-001",
  cufeOfficial: "cufe-off-001",
  totalAmount: "66164.00",
  clientName: "Juan Pérez",
};

const createInvoices = (count: number): InvoiceListItem[] =>
  Array.from({ length: count }, (_, i) => ({
    ...baseInvoice,
    id: `inv-${i + 1}`,
    invoiceNumber: `FE-${String(i + 1).padStart(3, "0")}`,
    totalAmount: `${(i + 1) * 10000}.00`,
  }));

const defaultProps = {
  invoices: createInvoices(2),
  onSelect: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  isLoading: false,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("InvoiceListView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a table with invoice data", () => {
    render(<InvoiceListView {...defaultProps} />);

    expect(screen.getByRole("region")).toBeInTheDocument();
    expect(screen.getByText("FE-001")).toBeInTheDocument();
    expect(screen.getByText("FE-002")).toBeInTheDocument();
    // Customer name appears in multiple rows; verify it exists
    expect(screen.getAllByText("Juan Pérez").length).toBeGreaterThanOrEqual(1);
  });

  it("calls onSelect when a row is clicked", () => {
    const onSelect = vi.fn();
    render(<InvoiceListView {...defaultProps} onSelect={onSelect} />);

    const row = screen.getByText("FE-001").closest("tr")!;
    fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-1" }),
    );
  });

  it("calls onRefresh when the refresh button is clicked", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<InvoiceListView {...defaultProps} onRefresh={onRefresh} />);

    const refreshButton = screen.getByRole("button", { name: /Refrescar/ });
    fireEvent.click(refreshButton);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables the refresh button while loading", () => {
    render(<InvoiceListView {...defaultProps} isLoading />);

    const refreshButton = screen.getByRole("button", { name: /Refrescar/ });
    expect(refreshButton).toBeDisabled();
  });

  it("shows empty state when invoices are empty", () => {
    render(<InvoiceListView {...defaultProps} invoices={[]} />);

    expect(screen.getByText("No hay facturas registradas.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows loading state via disabled refresh button", () => {
    render(<InvoiceListView {...defaultProps} isLoading />);

    expect(screen.getByRole("button", { name: /Refrescar/ })).toBeDisabled();
  });
});
