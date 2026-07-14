/**
 * Tests for the label formatter — HTML-based product labels.
 *
 * Verifies that generated HTML includes product name, price, barcode
 * metadata, and that batch labels are separated by page breaks.
 */
import { describe, expect, it } from "vitest";
import {
  generateLabelHtml,
  generateBatchLabelHtml,
  type LabelRenderInput,
  type LabelRenderBatchInput,
} from "./label-formatter";
import { PaperSize } from "../printing-types";

function makeLabelInput(overrides?: Partial<LabelRenderInput>): LabelRenderInput {
  return {
    productName: "Ibuprofeno 600mg",
    price: 12500,
    barcode: "7701234567890",
    barcodeType: "EAN13",
    paperSize: PaperSize.LABEL_50X25,
    ...overrides,
  };
}

describe("generateLabelHtml", () => {
  it("returns a string containing the product name", () => {
    const result = generateLabelHtml(makeLabelInput());

    expect(result).toContain("Ibuprofeno 600mg");
  });

  it("returns a string containing the formatted price", () => {
    const result = generateLabelHtml(makeLabelInput({ price: 12500 }));

    // The price should appear in the output (formatted with es-CO locale)
    expect(result).toContain("12");
    expect(result).toContain("500");
    expect(result).not.toContain("undefined");
  });

  it("returns HTML starting with a DOCTYPE declaration", () => {
    const result = generateLabelHtml(makeLabelInput());

    expect(result).toMatch(/^<!DOCTYPE html>/i);
  });

  it("contains barcode SVG with jsbarcode attributes", () => {
    const result = generateLabelHtml(makeLabelInput({ barcode: "7701234567890" }));

    expect(result).toContain("jsbarcode");
    expect(result).toContain("jsbarcode-value=\"7701234567890\"");
    expect(result).toContain("jsbarcode-format=\"EAN13\"");
  });

  it("uses CODE128 format when barcodeType is CODE128", () => {
    const result = generateLabelHtml(
      makeLabelInput({ barcodeType: "CODE128", barcode: "ABC123" }),
    );

    expect(result).toContain("jsbarcode-format=\"CODE128\"");
  });

  it("includes product code / SKU when provided", () => {
    const result = generateLabelHtml(makeLabelInput({ productCode: "SKU-456" }));

    expect(result).toContain("SKU-456");
    expect(result).toContain("class=\"sku\"");
  });

  it("omits the SKU section when productCode is not provided", () => {
    const result = generateLabelHtml(makeLabelInput({ productCode: undefined }));

    expect(result).not.toContain("class=\"sku\"");
  });

  it("includes a logo image when showLogo is true and logoPath is provided", () => {
    const result = generateLabelHtml(
      makeLabelInput({ showLogo: true, logoPath: "/img/logo.png" }),
    );

    expect(result).toContain("src=\"/img/logo.png\"");
    expect(result).toContain("class=\"logo\"");
  });

  it("omits the logo when showLogo is false", () => {
    const result = generateLabelHtml(
      makeLabelInput({ showLogo: false, logoPath: "/img/logo.png" }),
    );

    expect(result).not.toContain("class=\"logo\"");
  });

  it("wraps inline CSS with width and height matching the paper size", () => {
    const result = generateLabelHtml(makeLabelInput({ paperSize: PaperSize.LABEL_62X29 }));

    // LABEL_62X29 has cssWidth: 234, cssHeight: 110
    expect(result).toContain("width: 234px");
    expect(result).toContain("height: 110px");
  });

  it("handles minimum required fields without crashing", () => {
    const input: LabelRenderInput = {
      productName: "Test",
      price: 0,
      barcode: "000000",
      paperSize: PaperSize.LABEL_50X25,
    };

    const result = generateLabelHtml(input);

    expect(result).toContain("Test");
    expect(result).toContain("jsbarcode");
  });

  it("escapes HTML characters in product name", () => {
    const result = generateLabelHtml(
      makeLabelInput({ productName: "Acetaminofén & \"Cafeína\" <extra>" }),
    );

    expect(result).toContain("&amp;");
    expect(result).toContain("&quot;Cafeína&quot;");
    expect(result).toContain("&lt;extra&gt;");
    expect(result).not.toContain("<extra>");
  });
});

describe("generateBatchLabelHtml", () => {
  it("returns a string containing all product names", () => {
    const input: LabelRenderBatchInput = {
      products: [
        makeLabelInput({ productName: "Ibuprofeno 600mg", barcode: "001" }),
        makeLabelInput({ productName: "Acetaminofén 500mg", barcode: "002" }),
        makeLabelInput({ productName: "Loratadina 10mg", barcode: "003" }),
      ],
      paperSize: PaperSize.LABEL_50X25,
    };

    const result = generateBatchLabelHtml(input);

    expect(result).toContain("Ibuprofeno 600mg");
    expect(result).toContain("Acetaminofén 500mg");
    expect(result).toContain("Loratadina 10mg");
  });

  it("separates products with page-break-after dividers", () => {
    const input: LabelRenderBatchInput = {
      products: [
        makeLabelInput({ productName: "A", barcode: "001" }),
        makeLabelInput({ productName: "B", barcode: "002" }),
      ],
      paperSize: PaperSize.LABEL_50X25,
    };

    const result = generateBatchLabelHtml(input);

    // Should have exactly one page-break divider between two labels
    expect(result).toContain("page-break-after: always");

    // Two labels mean one divider between them
    const dividerCount = result.split("page-break-after: always").length - 1;
    expect(dividerCount).toBe(1);
  });

  it("returns the single label HTML directly when there is only one product", () => {
    const input: LabelRenderBatchInput = {
      products: [makeLabelInput({ productName: "Único", barcode: "001" })],
      paperSize: PaperSize.LABEL_50X25,
    };

    const result = generateBatchLabelHtml(input);

    expect(result).toContain("Único");
    expect(result).not.toContain("page-break-after");
  });

  it("handles an empty products array gracefully", () => {
    const input: LabelRenderBatchInput = {
      products: [],
      paperSize: PaperSize.LABEL_50X25,
    };

    const result = generateBatchLabelHtml(input);

    expect(result).toBe("");
  });
});
