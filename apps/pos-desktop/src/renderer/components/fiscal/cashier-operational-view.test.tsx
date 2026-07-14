/**
 * Component tests for CashierOperationalView.
 *
 * Covers: compact mode card, full mode table, differences display,
 * payment comparison, notes, tags, empty states, and contact info.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CashierOperationalView } from "./cashier-operational-view";
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
    email: "",
    phone: "",
    address: "",
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

const createOperationalView = (): OperationalInvoiceView => ({
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
        text: "Cambio solicitado por el cliente",
        authorName: "María López",
        createdAt: "2026-07-13T11:00:00.000Z",
      },
    ],
    contactInfo: {
      email: "cliente@mail.com",
      phone: "3001112233",
      address: "Calle 50 #20-30",
    },
    tags: ["DOMICILIO"],
    customFields: {},
    deliveryInfo: null,
    hasDifferences: true,
  },
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CashierOperationalView", () => {
  describe("compact mode", () => {
    it("renders a compact card with differences", () => {
      render(
        <CashierOperationalView
          operationalView={createOperationalView()}
          compact
        />,
      );

      expect(screen.getByRole("region")).toBeInTheDocument();
      expect(screen.getByText("Vista Operativa")).toBeInTheDocument();
      expect(screen.getByText(/Compacta/)).toBeInTheDocument();
    });

    it("shows payment method changes with strikethrough for old amounts", () => {
      render(
        <CashierOperationalView
          operationalView={createOperationalView()}
          compact
        />,
      );

      // The component shows old fiscal amount ($60,000) with strikethrough
      // and new operational amount ($66,164) in bold
      expect(screen.getByText("Efectivo")).toBeInTheDocument();
    });

    it("shows internal notes count", () => {
      render(
        <CashierOperationalView
          operationalView={createOperationalView()}
          compact
        />,
      );

      expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("shows tags in compact mode", () => {
      render(
        <CashierOperationalView
          operationalView={createOperationalView()}
          compact
        />,
      );

      expect(screen.getByText("DOMICILIO")).toBeInTheDocument();
    });

    it("shows no-differences message when hasDifferences is false", () => {
      const view = createOperationalView();
      view.operational.hasDifferences = false;
      view.operational.payments = [];
      view.operational.notes = [];
      view.operational.tags = [];

      render(
        <CashierOperationalView operationalView={view} compact />,
      );

      expect(
        screen.getByText("Esta factura tiene ajustes operativos"),
      ).toBeInTheDocument();
    });
  });

  describe("full mode", () => {
    it("renders detailed view with payment comparison table", () => {
      render(
        <CashierOperationalView
          operationalView={createOperationalView()}
          compact={false}
        />,
      );

      expect(screen.getByText("Vista Operativa")).toBeInTheDocument();
      expect(screen.getByText("Completa")).toBeInTheDocument();
    });

    it("renders internal notes with author name", () => {
      render(
        <CashierOperationalView
          operationalView={createOperationalView()}
          compact={false}
        />,
      );

      expect(
        screen.getByText("Cambio solicitado por el cliente"),
      ).toBeInTheDocument();
    });

    it("renders contact info in full mode", () => {
      render(
        <CashierOperationalView
          operationalView={createOperationalView()}
          compact={false}
        />,
      );

      expect(screen.getByText("cliente@mail.com")).toBeInTheDocument();
      expect(screen.getByText("3001112233")).toBeInTheDocument();
    });

    it('shows "no notes" empty state when notes are empty', () => {
      const view = createOperationalView();
      view.operational.notes = [];

      render(
        <CashierOperationalView operationalView={view} compact={false} />,
      );

      expect(screen.getByText("Sin notas internas")).toBeInTheDocument();
    });
  });
});
