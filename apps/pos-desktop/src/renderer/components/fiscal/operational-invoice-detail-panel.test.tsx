/**
 * Component tests for OperationalInvoiceDetailPanel.
 *
 * Covers: operational differences view, payment comparison, notes, tags,
 * contact info, delivery info, custom fields, empty states, and loading.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OperationalInvoiceDetailPanel } from "./operational-invoice-detail-panel";
import type { OperationalInvoiceView } from "../../../domain/fiscal/local-adjustment.types";
import type { InvoiceFullData } from "../../../domain/fiscal/fiscal-types";
import "@/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseFullData: InvoiceFullData = {
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
  lineItems: [],
  taxSummaries: [],
  payments: [
    {
      paymentMethodId: "pm-cash",
      paymentMethodName: "Efectivo",
      amount: "60000.00",
      category: "CASH",
      transactionReference: null,
      authorizationCode: null,
      cardBrand: null,
      cardLastFour: null,
    },
  ],
  subtotal: "50420.17",
  totalDiscount: "0",
  totalTax: "9543.83",
  totalAmount: "60000.00",
  changeAmount: "0",
  issuedAt: "2026-07-13T10:00:00.000Z",
  currency: "COP",
  prescriptionNumber: null,
  workstationCode: "WS-001",
};

const createOperationalView = (
  hasDifferences = true,
): OperationalInvoiceView => ({
  fiscal: {
    id: "inv-1",
    invoiceNumber: "FE-001",
    invoiceType: "ELECTRONIC_INVOICE",
    status: "TRANSMITTED_AUTHORIZED",
    cufeProvisional: "cufe-prov",
    cufeOfficial: "cufe-off",
    issuedAt: "2026-07-13T10:00:00.000Z",
    fullData: baseFullData,
  },
  operational: {
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
    notes: [
      {
        id: "note-1",
        text: "Cliente solicitó cambio de efectivo a tarjeta",
        authorName: "María López",
        createdAt: "2026-07-13T11:00:00.000Z",
      },
    ],
    contactInfo: {
      email: "cliente@example.com",
      phone: "3009998877",
      address: "Cra 20 #15-30",
    },
    tags: ["URGENTE", "DOMICILIO"],
    customFields: { orden_medica: "RX-2026-001" },
    deliveryInfo: {
      address: "Cra 20 #15-30",
      contactName: "Pedro Sánchez",
      contactPhone: "3009998877",
      scheduledDate: "2026-07-14T09:00:00.000Z",
      notes: "Dejar con el portero",
    },
    hasDifferences,
  },
});

const defaultProps = {
  operationalView: createOperationalView(),
  adjustmentCount: 3,
  isLoading: false,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("OperationalInvoiceDetailPanel", () => {
  it("renders the differences banner when hasDifferences is true", () => {
    render(<OperationalInvoiceDetailPanel {...defaultProps} />);

    expect(
      screen.getByText("Vista Operativa"),
    ).toBeInTheDocument();
  });

  it("renders payment methods comparison table", () => {
    render(<OperationalInvoiceDetailPanel {...defaultProps} />);

    expect(screen.getByText("Efectivo")).toBeInTheDocument();
  });

  it("renders internal notes with author and text", () => {
    render(<OperationalInvoiceDetailPanel {...defaultProps} />);

    expect(
      screen.getByText("Cliente solicitó cambio de efectivo a tarjeta"),
    ).toBeInTheDocument();
    expect(screen.getByText(/María López/)).toBeInTheDocument();
  });

  it("renders tags as badges", () => {
    render(<OperationalInvoiceDetailPanel {...defaultProps} />);

    expect(screen.getByText("URGENTE")).toBeInTheDocument();
    expect(screen.getByText("DOMICILIO")).toBeInTheDocument();
  });

  it("renders contact info", () => {
    render(<OperationalInvoiceDetailPanel {...defaultProps} />);

    expect(screen.getByText("cliente@example.com")).toBeInTheDocument();
    // Phone appears in both Contact and Delivery sections
    expect(screen.getAllByText("3009998877").length).toBeGreaterThanOrEqual(1);
  });

  it("renders delivery info", () => {
    render(<OperationalInvoiceDetailPanel {...defaultProps} />);

    expect(screen.getByText("Dejar con el portero")).toBeInTheDocument();
    expect(screen.getByText("Pedro Sánchez")).toBeInTheDocument();
  });

  it("renders custom fields", () => {
    render(<OperationalInvoiceDetailPanel {...defaultProps} />);

    expect(screen.getByText("RX-2026-001")).toBeInTheDocument();
  });

  it("shows empty states when sections have no data", () => {
    const emptyView = createOperationalView();
    emptyView.operational.notes = [];
    emptyView.operational.tags = [];
    emptyView.operational.contactInfo = { email: null, phone: null, address: null };
    emptyView.operational.customFields = {};
    emptyView.operational.deliveryInfo = null;

    render(
      <OperationalInvoiceDetailPanel
        {...defaultProps}
        operationalView={emptyView}
      />,
    );

    expect(screen.getByText("Sin notas internas")).toBeInTheDocument();
    expect(screen.getByText("Sin etiquetas")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(
      <OperationalInvoiceDetailPanel
        {...defaultProps}
        isLoading
        adjustmentCount={0}
      />,
    );

    expect(screen.getByText("Cargando...")).toBeInTheDocument();
  });
});
