/**
 * Tests for the shift close HTML report generator.
 *
 * generateShiftCloseHtml produces a printable HTML document. These tests
 * verify the document structure, escape safety, and edge cases without
 * rendering in a browser.
 */
import { describe, expect, it } from "vitest";
import { generateShiftCloseHtml, type ShiftCloseReportData } from "./shift-close-html";

const baseData: ShiftCloseReportData = {
  shiftId: "shift-12345678-9012",
  workstationId: "WS-001",
  cashierName: "Juan Pérez",
  openedAt: new Date("2026-07-14T06:00:00"),
  closedAt: new Date("2026-07-14T14:30:00"),
  openingBalance: "200000",
  expectedClosingAmount: "1850000",
  actualClosingAmount: "1845000",
  closingDifference: "-5000",
  closingNotes: null,
  paymentMethodCounts: [
    {
      methodName: "Efectivo",
      isCash: true,
      expectedAmount: "1500000",
      declaredAmount: "1495000",
      difference: "-5000",
    },
    {
      methodName: "Tarjeta Débito",
      isCash: false,
      expectedAmount: "350000",
      declaredAmount: "350000",
      difference: "0",
    },
  ],
};

describe("generateShiftCloseHtml", () => {
  it("includes the shift id fragment in the document title", () => {
    const html = generateShiftCloseHtml(baseData);
    expect(html).toContain("<title>Cierre de Turno shift-12</title>");
  });

  it("includes workstation and cashier info in the header", () => {
    const html = generateShiftCloseHtml(baseData);
    expect(html).toContain("WS-001");
    expect(html).toContain("Juan Pérez");
  });

  it("renders opening and closing times", () => {
    const html = generateShiftCloseHtml(baseData);
    expect(html).toContain("Apertura:");
    expect(html).toContain("Cierre:");
  });

  it("renders payment method table rows", () => {
    const html = generateShiftCloseHtml(baseData);
    expect(html).toContain("Efectivo");
    expect(html).toContain("Tarjeta Débito");
    expect(html).toContain("$ 1.500.000,00");
    expect(html).toContain("$ 350.000,00");
  });

  it("formats monetary values with es-CO locale (thousands separators, decimals)", () => {
    const html = generateShiftCloseHtml(baseData);
    // Opening balance: 200000 → 200.000,00
    expect(html).toContain("$ 200.000,00");
    // Expected closing: 1850000 → 1.850.000,00
    expect(html).toContain("$ 1.850.000,00");
  });

  it("marks negative differences with a 'negative' class", () => {
    const html = generateShiftCloseHtml(baseData);
    // Efectivo difference is -5000 → negative
    expect(html).toContain('class="right negative"');
  });

  it("shows the difference in the summary with correct sign", () => {
    const html = generateShiftCloseHtml(baseData);
    expect(html).toContain("DIFERENCIA:");
    // Difference is -5000 → negative class, no sign prefix
    expect(html).toContain("negative");
    expect(html).toContain("$ 5.000,00");
  });

  it("includes closing notes section when notes are present", () => {
    const data: ShiftCloseReportData = {
      ...baseData,
      closingNotes: "Cierre anticipado por corte de luz",
    };
    const html = generateShiftCloseHtml(data);
    expect(html).toContain("Notas:");
    expect(html).toContain("Cierre anticipado por corte de luz");
  });

  it("omits closing notes section when notes are null", () => {
    const html = generateShiftCloseHtml(baseData);
    expect(html).not.toContain("Notas:");
  });

  it("escapes HTML in user-supplied strings", () => {
    const data: ShiftCloseReportData = {
      ...baseData,
      cashierName: "<script>alert('xss')</script>",
      closingNotes: 'Note with "quotes" & <angle>',
    };
    const html = generateShiftCloseHtml(data);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;quotes&quot;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;angle&gt;");
  });

  it("includes a footer with generation timestamp", () => {
    const html = generateShiftCloseHtml(baseData);
    expect(html).toContain("Generado:");
  });

  it("starts with the HTML5 doctype", () => {
    const html = generateShiftCloseHtml(baseData);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("renders a zero difference as non-negative", () => {
    const data: ShiftCloseReportData = {
      ...baseData,
      closingDifference: "0",
      paymentMethodCounts: [
        {
          methodName: "Efectivo",
          isCash: true,
          expectedAmount: "1500000",
          declaredAmount: "1500000",
          difference: "0",
        },
      ],
    };
    const html = generateShiftCloseHtml(data);
    // Zero should not carry the 'negative' class
    expect(html).not.toContain('class="right negative"');
  });

  it("renders a positive closing difference with a + sign", () => {
    const data: ShiftCloseReportData = {
      ...baseData,
      closingDifference: "1500",
      paymentMethodCounts: [
        {
          methodName: "Efectivo",
          isCash: true,
          expectedAmount: "1500000",
          declaredAmount: "1501500",
          difference: "1500",
        },
      ],
    };
    const html = generateShiftCloseHtml(data);
    // Positive difference should show +$ 1.500,00
    expect(html).toContain("+$ 1.500,00");
  });

  it("renders an empty payment methods table gracefully", () => {
    const data: ShiftCloseReportData = {
      ...baseData,
      paymentMethodCounts: [],
    };
    const html = generateShiftCloseHtml(data);
    // Should still produce valid HTML table structure
    expect(html).toContain("<table>");
    expect(html).toContain("</table>");
  });
});
