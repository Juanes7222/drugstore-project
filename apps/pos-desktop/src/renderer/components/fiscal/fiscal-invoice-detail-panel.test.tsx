/**
 * Component tests for FiscalInvoiceDetailPanel.
 *
 * Covers: invoice identity, CUFE display, dates, line items, payments,
 * tax summary, totals, buyer/seller info, prescription, action message,
 * reprint and cancel buttons.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FiscalInvoiceDetailPanel } from "./fiscal-invoice-detail-panel";
import type { InvoiceModel } from "../../../domain/fiscal/fiscal-types";
import "@/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseInvoice: InvoiceModel = {
  id: "inv-1",
  saleId: "sale-1",
  workstationId: "ws-001",
  invoiceType: "ELECTRONIC_INVOICE",
  invoiceNumber: "FE-001",
  contingencyNumber: null,
  status: "TRANSMITTED_AUTHORIZED",
  cufeProvisional: "cufe-prov-001",
  cufeOfficial: "cufe-official-001",
  issuedAt: new Date("2026-07-13T10:00:00.000Z"),
  transmittedAt: new Date("2026-07-13T10:05:00.000Z"),
  expiresAt: new Date("2026-08-12T10:00:00.000Z"),
  fiscalXml: null,
  fiscalPdfPath: null,
  relatedInvoiceId: null,
  contingencyEventId: null,
  techKeySnapshot: "snapshot-001",
  fullData: {
    invoiceType: "ELECTRONIC_INVOICE",
    invoiceNumber: "FE-001",
    contingencyNumber: null,
    relatedInvoiceNumber: null,
    seller: {
      nit: "900123456-7",
      name: "Farmacia Prueba SAS",
      address: "Calle 10 #20-30",
      phone: "3000000000",
      resolutionNumber: "RES-001",
      resolutionDate: "2026-01-01",
      resolutionPrefix: "FE",
    },
    buyer: {
      identificationType: "CC",
      identificationNumber: "123456789",
      name: "Juan Pérez",
      email: "juan@example.com",
      phone: "3001112233",
      address: "Carrera 15 #30-40",
    },
    lineItems: [
      {
        productId: "p-001",
        internalCode: "COD-001",
        commercialName: "Acetaminofén 500mg",
        genericName: "Acetaminofén",
        concentration: "500mg",
        quantity: 2,
        unitPrice: "5000.00",
        discountPercentage: "0",
        discountAmount: "0",
        discountReason: null,
        taxRate: "19",
        taxAmount: "1900.00",
        subtotal: "10000.00",
        total: "11900.00",
      },
    ],
    payments: [
      {
        paymentMethodId: "pm-cash",
        paymentMethodName: "Efectivo",
        amount: "66164.00",
        category: "CASH",
        transactionReference: null,
        authorizationCode: null,
        cardBrand: null,
        cardLastFour: null,
      },
    ],
    taxSummaries: [
      {
        scheme: "IVA",
        rate: "19",
        taxableAmount: "10000.00",
        taxAmount: "1900.00",
      },
    ],
    subtotal: "55580.00",
    totalDiscount: "0",
    totalTax: "10584.00",
    totalAmount: "66164.00",
    changeAmount: "0",
    issuedAt: "2026-07-13T10:00:00.000Z",
    currency: "COP",
    prescriptionNumber: null,
    workstationCode: "WS-001",
  },
};

const defaultProps = {
  invoice: baseInvoice,
  onReprint: vi.fn().mockResolvedValue(undefined),
  onCancel: vi.fn().mockResolvedValue(undefined),
  isCancelling: false,
  isCancellable: true,
  actionMessage: null,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("FiscalInvoiceDetailPanel", () => {
  it("renders invoice identity (number, type, status)", () => {
    render(<FiscalInvoiceDetailPanel {...defaultProps} />);

    expect(screen.getByText("FE-001")).toBeInTheDocument();
    expect(screen.getByText("ELECTRONIC_INVOICE")).toBeInTheDocument();
    expect(screen.getByText("TRANSMITTED_AUTHORIZED")).toBeInTheDocument();
  });

  it("renders CUFE display (official)", () => {
    render(<FiscalInvoiceDetailPanel {...defaultProps} />);

    expect(screen.getByText("cufe-official-001")).toBeInTheDocument();
    expect(
      screen.getByText("CUFE OFICIAL - Transmitido a DIAN"),
    ).toBeInTheDocument();
  });

  it("renders CUFE provisional label when pending", () => {
    const pendingInvoice = {
      ...baseInvoice,
      status: "CONTINGENCY_PENDING_TRANSMISSION" as const,
      cufeOfficial: null,
    };
    render(
      <FiscalInvoiceDetailPanel {...defaultProps} invoice={pendingInvoice} />,
    );

    expect(
      screen.getByText("CUFE PROVISIONAL - Pendiente autorización DIAN"),
    ).toBeInTheDocument();
  });

  it("renders dates (issued, expires, transmitted)", () => {
    render(<FiscalInvoiceDetailPanel {...defaultProps} />);

    // Dates are formatted with es-CO locale; appears in at least one element
    const dateElements = screen.getAllByText(/13\/7\/2026/);
    expect(dateElements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders line items table", () => {
    render(<FiscalInvoiceDetailPanel {...defaultProps} />);

    expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders payments summary", () => {
    render(<FiscalInvoiceDetailPanel {...defaultProps} />);

    expect(screen.getByText("Efectivo")).toBeInTheDocument();
  });

  it("renders tax summary", () => {
    render(<FiscalInvoiceDetailPanel {...defaultProps} />);

    expect(screen.getByText("IVA")).toBeInTheDocument();
    expect(screen.getByText("19%")).toBeInTheDocument();
  });

  it("renders totals (subtotal, total tax, total)", () => {
    render(<FiscalInvoiceDetailPanel {...defaultProps} />);

    const totalAmounts = screen.getAllByText(/\$\s*66\.164/);
    expect(totalAmounts.length).toBeGreaterThanOrEqual(1);
  });

  it("renders buyer info", () => {
    render(<FiscalInvoiceDetailPanel {...defaultProps} />);

    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    expect(screen.getByText("CC 123456789")).toBeInTheDocument();
  });

  it("renders seller info", () => {
    render(<FiscalInvoiceDetailPanel {...defaultProps} />);

    expect(screen.getByText("900123456-7")).toBeInTheDocument();
    expect(screen.getByText("Farmacia Prueba SAS")).toBeInTheDocument();
  });

  it("renders prescription number when present", () => {
    const invoiceWithRx = {
      ...baseInvoice,
      fullData: { ...baseInvoice.fullData, prescriptionNumber: "RX-12345" },
    };
    render(
      <FiscalInvoiceDetailPanel {...defaultProps} invoice={invoiceWithRx} />,
    );

    expect(screen.getByText("RX-12345")).toBeInTheDocument();
  });

  it("renders action message with alert role", () => {
    render(
      <FiscalInvoiceDetailPanel
        {...defaultProps}
        actionMessage="Error: Factura rechazada"
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Error: Factura rechazada");
  });

  it("calls onReprint when reprint button clicked", () => {
    const onReprint = vi.fn().mockResolvedValue(undefined);
    render(
      <FiscalInvoiceDetailPanel {...defaultProps} onReprint={onReprint} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Reimprimir recibo/ }));
    expect(onReprint).toHaveBeenCalledTimes(1);
  });

  it("shows cancel button only when isCancellable is true", () => {
    const { rerender } = render(
      <FiscalInvoiceDetailPanel {...defaultProps} isCancellable={false} />,
    );

    expect(
      screen.queryByRole("button", { name: /Anular factura/ }),
    ).not.toBeInTheDocument();

    rerender(
      <FiscalInvoiceDetailPanel {...defaultProps} isCancellable />,
    );
    expect(
      screen.getByRole("button", { name: /Anular factura/ }),
    ).toBeInTheDocument();
  });

  it("calls onCancel and shows cancelling label when isCancelling", () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <FiscalInvoiceDetailPanel
        {...defaultProps}
        onCancel={onCancel}
        isCancellable
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Anular factura/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <FiscalInvoiceDetailPanel
        {...defaultProps}
        onCancel={onCancel}
        isCancellable
        isCancelling
      />,
    );

    expect(screen.getByText("Anulando…")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Anular factura/ }),
    ).toBeDisabled();
  });
});
