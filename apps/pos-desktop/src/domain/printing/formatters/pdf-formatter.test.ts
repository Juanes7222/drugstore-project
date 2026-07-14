/**
 * Tests for the PDF formatter — HTML document generation for print/PDF output.
 *
 * Verifies that the generated HTML starts with a proper doctype, includes
 * CSS @page rules matching the requested paper size, renders header, body,
 * and footer content, and conditionally includes page numbers.
 */
import { describe, expect, it } from "vitest";
import { generatePdfHtml, type PdfRenderInput } from "./pdf-formatter";
import { PaperSize, TemplateFormat } from "../printing-types";

function makePdfInput(overrides?: Partial<PdfRenderInput>): PdfRenderInput {
  return {
    headerLines: ["Farmacia Salud", "NIT 123"],
    footerLines: ["Gracias por su compra", "Tel: 555-0000"],
    templateBody: [
      "## DETALLE DE VENTA",
      "# Medicamentos",
      "| 1 | Ibuprofeno 600mg | $5.00 | $5.00 |",
      "---",
      ">> Total: $5.00",
    ].join("\n"),
    templateFormat: TemplateFormat.HTML_TEMPLATE,
    paperSize: PaperSize.A4,
    context: {},
    title: "Factura de Venta",
    showPageNumbers: true,
    logoPath: null,
    ...overrides,
  };
}

describe("generatePdfHtml", () => {
  it("returns a string starting with <!DOCTYPE html>", () => {
    const result = generatePdfHtml(makePdfInput());

    expect(result).toMatch(/^<!DOCTYPE html>/i);
  });

  it("includes CSS @page rules for the paper size", () => {
    const result = generatePdfHtml(makePdfInput({ paperSize: PaperSize.A4 }));

    expect(result).toContain("@page");
    expect(result).toContain("210mm");
    expect(result).toContain("297mm");
  });

  it("includes header lines in the output", () => {
    const result = generatePdfHtml(
      makePdfInput({ headerLines: ["Farmacia Salud", "NIT 123"] }),
    );

    expect(result).toContain("Farmacia Salud");
    expect(result).toContain("NIT 123");
    expect(result).toContain("class=\"header-line\"");
  });

  it("includes footer lines in the output", () => {
    const result = generatePdfHtml(
      makePdfInput({ footerLines: ["Gracias por su compra", "Tel: 555-0000"] }),
    );

    expect(result).toContain("Gracias por su compra");
    expect(result).toContain("Tel: 555-0000");
    expect(result).toContain("class=\"footer-line\"");
  });

  it("includes the template body content", () => {
    const result = generatePdfHtml(makePdfInput());

    expect(result).toContain("DETALLE DE VENTA");
    expect(result).toContain("Ibuprofeno 600mg");
  });

  it("converts ## section headers to section-title CSS class", () => {
    const result = generatePdfHtml(makePdfInput());

    expect(result).toContain("class=\"body-line section-title\"");
    expect(result).toContain("DETALLE DE VENTA");
  });

  it("converts >> right-aligned lines to right CSS class", () => {
    const result = generatePdfHtml(makePdfInput());

    expect(result).toContain("class=\"body-line right\"");
    expect(result).toContain("Total: $5.00");
  });

  it("includes page numbers in @page footer when showPageNumbers is true", () => {
    const result = generatePdfHtml(makePdfInput({ showPageNumbers: true }));

    expect(result).toContain("counter(page)");
    expect(result).toContain("@bottom-center");
  });

  it("omits page number CSS from @page when showPageNumbers is false", () => {
    const result = generatePdfHtml(makePdfInput({ showPageNumbers: false }));

    expect(result).not.toContain("counter(page)");
    expect(result).not.toContain("@bottom-center");
  });

  it("handles empty header and footer lines gracefully", () => {
    const result = generatePdfHtml(
      makePdfInput({ headerLines: [], footerLines: [] }),
    );

    // Should still produce a full HTML document
    expect(result).toMatch(/^<!DOCTYPE html>/i);
    expect(result).toContain("class=\"document-header\"");
    expect(result).toContain("class=\"document-footer\"");
  });

  it("works with LETTER paper size", () => {
    const result = generatePdfHtml(makePdfInput({ paperSize: PaperSize.LETTER }));

    // LETTER is 215.9mm x 279.4mm
    expect(result).toContain("@page");
    expect(result).toContain("215.9mm");
    expect(result).toContain("279.4mm");
  });

  it("uses a default title when none is provided", () => {
    const result = generatePdfHtml(makePdfInput({ title: undefined }));

    expect(result).toContain("<title>Documento</title>");
  });

  it("uses the provided title in the HTML title tag", () => {
    const result = generatePdfHtml(makePdfInput({ title: "Mi Factura" }));

    expect(result).toContain("<title>Mi Factura</title>");
  });

  it("renders the document structure with header, body, and footer divs", () => {
    const result = generatePdfHtml(makePdfInput());

    expect(result).toContain("class=\"document-header\"");
    expect(result).toContain("class=\"document-body\"");
    expect(result).toContain("class=\"document-footer\"");
  });

  it("escapes HTML characters in header and footer lines", () => {
    const result = generatePdfHtml(
      makePdfInput({
        headerLines: ["<script>alert('xss')</script>"],
        footerLines: [],
      }),
    );

    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>");
  });

  it("renders --- separators as divider divs", () => {
    const result = generatePdfHtml(
      makePdfInput({ templateBody: "Antes\n---\nDespués" }),
    );

    expect(result).toContain("class=\"body-line divider\"");
  });

  it("renders pipe-delimited totals as total divs", () => {
    const result = generatePdfHtml(
      makePdfInput({
        templateBody: "| $5.00 |",
      }),
    );

    expect(result).toContain("class=\"body-line total\"");
    expect(result).toContain("$5.00");
  });

  it("renders regular lines as body-line divs", () => {
    const result = generatePdfHtml(
      makePdfInput({
        templateBody: "Una línea de texto normal",
      }),
    );

    expect(result).toContain("class=\"body-line\"");
    expect(result).toContain("Una línea de texto normal");
  });
});
