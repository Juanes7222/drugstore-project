/**
 * Tests for the receipt generator.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { generateReceiptHtml, printReceipt, createReceiptBlobUrl } from "./receipt-generator";
import type { InvoiceFullData } from "./fiscal-types";

function makeFullData(overrides?: Partial<InvoiceFullData>): InvoiceFullData {
  return {
    invoiceType: "ELECTRONIC_INVOICE",
    invoiceNumber: "FE-WS000001-00000001",
    contingencyNumber: null,
    relatedInvoiceNumber: null,
    seller: {
      nit: "900123456-7",
      name: "FARMACIA DEL BARRIO S.A.S.",
      address: "Calle 10 #20-30",
      phone: "6012345678",
      resolutionNumber: "RES-2026-001",
      resolutionDate: "2026-01-15",
      resolutionPrefix: "FE",
    },
    buyer: {
      identificationType: "CC",
      identificationNumber: "1012345678",
      name: "JUAN PEREZ",
      email: null,
      phone: null,
      address: null,
    },
    lineItems: [
      {
        productId: "prod-1",
        internalCode: "ACET-500",
        commercialName: "ACETAMINOFEN 500MG",
        genericName: "Acetaminofén",
        concentration: "500 mg",
        quantity: 2,
        unitPrice: "5000.00",
        discountPercentage: "0.00",
        discountAmount: "0.00",
        discountReason: null,
        taxRate: "19.00",
        taxAmount: "1900.00",
        subtotal: "10000.00",
        total: "11900.00",
      },
    ],
    taxSummaries: [
      { scheme: "IVA", rate: "19.00", taxableAmount: "10000.00", taxAmount: "1900.00" },
    ],
    payments: [
      {
        paymentMethodId: "pm-cash",
        paymentMethodName: "Efectivo",
        amount: "11900.00",
        category: "CASH",
        transactionReference: null,
        authorizationCode: null,
        cardBrand: null,
        cardLastFour: null,
      },
    ],
    subtotal: "10000.00",
    totalDiscount: "0.00",
    totalTax: "1900.00",
    totalAmount: "11900.00",
    changeAmount: "0.00",
    issuedAt: "2026-06-15T14:30:00.000Z",
    currency: "COP",
    prescriptionNumber: null,
    workstationCode: "WS000001",
    ...overrides,
  };
}

describe("generateReceiptHtml", () => {
  it("returns a complete HTML document for an electronic invoice", () => {
    const html = generateReceiptHtml({
      id: "inv-1",
      invoiceNumber: "FE-WS000001-00000001",
      contingencyNumber: null,
      invoiceType: "ELECTRONIC_INVOICE",
      status: "TRANSMITTED_AUTHORIZED",
      cufeProvisional: "PROVISIONAL-CUFE-HASH",
      cufeOfficial: "OFFICIAL-CUFE-HASH",
      issuedAt: new Date("2026-06-15T14:30:00.000Z"),
      fullData: makeFullData(),
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Factura");
    expect(html).toContain("FE-WS000001-00000001");
    expect(html).toContain("CUFE");
    expect(html).toContain("OFFICIAL-CUFE-HASH");
    expect(html).not.toContain("PENDIENTE");
    expect(html).not.toContain("CONTINGENCIA");
  });

  it("includes CONTINGENCIA badge for pending transmission invoices", () => {
    const html = generateReceiptHtml({
      id: "inv-2",
      invoiceNumber: "CONT-WS000001-00000001",
      contingencyNumber: "CONT-WS000001-00000001",
      invoiceType: "ELECTRONIC_INVOICE",
      status: "CONTINGENCY_PENDING_TRANSMISSION",
      cufeProvisional: "PROVISIONAL-CUFE-HASH",
      cufeOfficial: null,
      issuedAt: "2026-06-15T14:30:00.000Z",
      fullData: makeFullData({ contingencyNumber: "CONT-WS000001-00000001" }),
    });

    expect(html).toContain("CONTINGENCIA");
    expect(html).toContain("PENDIENTE AUTORIZACI");
    expect(html).toContain("CUFE PROVISIONAL");
  });

  it("includes NOTA CREDITO badge for credit notes", () => {
    const html = generateReceiptHtml({
      id: "inv-3",
      invoiceNumber: "NC-WS000001-00000001",
      contingencyNumber: null,
      invoiceType: "CREDIT_NOTE",
      status: "TRANSMITTED_AUTHORIZED",
      cufeProvisional: "PROVISIONAL-CUFE-HASH",
      cufeOfficial: "OFFICIAL-CUFE",
      issuedAt: "2026-06-15T14:30:00.000Z",
      fullData: makeFullData({ invoiceType: "CREDIT_NOTE" }),
    });

    expect(html).toContain("NOTA CRÉDITO");
  });

  it("includes ANULACION badge for cancellations", () => {
    const html = generateReceiptHtml({
      id: "inv-4",
      invoiceNumber: "ANUL-WS000001-00000001",
      contingencyNumber: null,
      invoiceType: "CONTINGENCY_CANCELLATION",
      status: "CONTINGENCY_PENDING_TRANSMISSION",
      cufeProvisional: "PROVISIONAL-CUFE-HASH",
      cufeOfficial: null,
      issuedAt: "2026-06-15T14:30:00.000Z",
      fullData: makeFullData(),
    });

    expect(html).toContain("ANULACI");
  });

  it("renders line items with names and prices", () => {
    const data = makeFullData({
      lineItems: [
        {
          productId: "prod-1",
          internalCode: "IBU-400",
          commercialName: "IBUPROFENO 400MG",
          genericName: "Ibuprofeno",
          concentration: "400 mg",
          quantity: 1,
          unitPrice: "8000.00",
          discountPercentage: "10.00",
          discountAmount: "800.00",
          discountReason: "Promo",
          taxRate: "19.00",
          taxAmount: "1368.00",
          subtotal: "7200.00",
          total: "8568.00",
        },
      ],
    });

    const html = generateReceiptHtml({
      id: "inv-5",
      invoiceNumber: "FE-0005",
      contingencyNumber: null,
      invoiceType: "ELECTRONIC_INVOICE",
      status: "TRANSMITTED_AUTHORIZED",
      cufeProvisional: "CUFE-HASH",
      cufeOfficial: null,
      issuedAt: new Date(),
      fullData: data,
    });

    expect(html).toContain("IBUPROFENO 400MG");
    expect(html).toContain("8.568");
  });

  it("escapes HTML special characters in user-provided strings", () => {
    const data = makeFullData({
      buyer: {
        identificationType: "CC",
        identificationNumber: "1012345678",
        name: "JUAN <script>alert('xss')</script> PEREZ",
        email: null,
        phone: null,
        address: null,
      },
    });

    const html = generateReceiptHtml({
      id: "inv-6",
      invoiceNumber: "FE-0006",
      contingencyNumber: null,
      invoiceType: "ELECTRONIC_INVOICE",
      status: "TRANSMITTED_AUTHORIZED",
      cufeProvisional: "CUFE-HASH",
      cufeOfficial: null,
      issuedAt: new Date(),
      fullData: data,
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("handles missing fullData gracefully", () => {
    const html = generateReceiptHtml({
      id: "inv-7",
      invoiceNumber: "FE-0007",
      contingencyNumber: null,
      invoiceType: "ELECTRONIC_INVOICE",
      status: "TRANSMITTED_AUTHORIZED",
      cufeProvisional: "CUFE-HASH",
      cufeOfficial: null,
      issuedAt: "2026-06-15T14:30:00.000Z",
      fullData: null,
    });

    expect(html).toContain("FE-0007");
    expect(html).toContain("Farmacia");
  });

  it("includes discount line when totalDiscount > 0", () => {
    const data = makeFullData({
      totalDiscount: "500.00",
      lineItems: [
        {
          productId: "prod-1",
          internalCode: "P001",
          commercialName: "Producto",
          genericName: null,
          concentration: null,
          quantity: 1,
          unitPrice: "10000.00",
          discountPercentage: "5.00",
          discountAmount: "500.00",
          discountReason: "Descuento",
          taxRate: "19.00",
          taxAmount: "1805.00",
          subtotal: "9500.00",
          total: "11305.00",
        },
      ],
    });

    const html = generateReceiptHtml({
      id: "inv-8",
      invoiceNumber: "FE-0008",
      contingencyNumber: null,
      invoiceType: "ELECTRONIC_INVOICE",
      status: "TRANSMITTED_AUTHORIZED",
      cufeProvisional: "CUFE-HASH",
      cufeOfficial: null,
      issuedAt: new Date(),
      fullData: data,
    });

    expect(html).toContain("Descuento");
    expect(html).toContain("$500");
  });
});

describe("printReceipt", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an iframe and writes HTML to it", () => {
    const createElementSpy = vi.spyOn(document, "createElement");
    const appendChildSpy = vi.spyOn(document.body, "appendChild");

    printReceipt("<html><body>Test</body></html>");

    expect(createElementSpy).toHaveBeenCalledWith("iframe");
    expect(appendChildSpy).toHaveBeenCalled();
  });
});

describe("createReceiptBlobUrl", () => {
  it("creates a blob URL from HTML content", () => {
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL");

    const url = createReceiptBlobUrl("<html><body>Test</body></html>");

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(typeof url).toBe("string");
    expect(url).toMatch(/^blob:/);
  });
});
