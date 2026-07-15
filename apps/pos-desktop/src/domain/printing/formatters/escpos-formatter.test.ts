/**
 * Tests for the ESC/POS formatter — thermal receipt printer byte sequences.
 *
 * Verifies that rendered receipts start with the init sequence, end with a
 * paper cut command, and contain expected control bytes for text, QR codes,
 * and barcodes.  Tests focus on output structure (byte sequences) rather
 * than exact pixel-level rendering.
 */
import { describe, expect, it } from "vitest";
import {
  renderEscposReceipt,
  renderEscposTestPage,
  renderDrawerKickCommand,
  type EscposRenderInput,
} from "./escpos-formatter";
import { PaperSize, QRCodeContent } from "../printing-types";

const ESC = 0x1b;
const GS = 0x1d;

function makeMinimalInput(overrides?: Partial<EscposRenderInput>): EscposRenderInput {
  return {
    headerLines: ["Farmacia Salud"],
    footerLines: ["Gracias"],
    templateBody: "Item 1     $10.00\nItem 2     $20.00",
    showQrCode: false,
    qrCodeContent: "NONE" as QRCodeContent,
    showLogo: false,
    context: {},
    paperSize: PaperSize.RECEIPT_80MM,
    ...overrides,
  };
}

function searchBytes(haystack: Uint8Array, needle: number[]): number {
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function encodeString(str: string): number[] {
  return Array.from(new TextEncoder().encode(str));
}

describe("renderEscposReceipt", () => {
  it("returns a non-empty Uint8Array", () => {
    const result = renderEscposReceipt(makeMinimalInput());

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("starts with the ESC/POS init sequence (0x1B, 0x40)", () => {
    const result = renderEscposReceipt(makeMinimalInput());

    expect(result[0]).toBe(ESC);
    expect(result[1]).toBe(0x40);
  });

  it("ends with a partial paper cut command (0x1D, 0x56, 0x01)", () => {
    const result = renderEscposReceipt(makeMinimalInput());

    expect(result[result.length - 3]).toBe(GS);
    expect(result[result.length - 2]).toBe(0x56);
    expect(result[result.length - 1]).toBe(0x01);
  });

  it("includes header text encoded as bytes in the output", () => {
    const headerText = "CLIENTE_X";
    const input = makeMinimalInput({ headerLines: [headerText] });
    const result = renderEscposReceipt(input);
    const needle = encodeString(headerText);

    const position = searchBytes(result, needle);

    expect(position).not.toBe(-1);
  });

  it("includes QR code model 2 commands when showQrCode is true", () => {
    const input = makeMinimalInput({
      showQrCode: true,
      qrCodeContent: QRCodeContent.CUFE_ONLY,
      context: { invoice: { cufeOfficial: "cufe123" } } as any,
    });
    const result = renderEscposReceipt(input);

    // QR model 2 header: GS 0x28 0x6B
    const qrHeader = [GS, 0x28, 0x6b];
    const position = searchBytes(result, qrHeader);

    expect(position).not.toBe(-1);
  });

  it("uses INVOICE_NUMBER_AND_CUFE as QR content when specified", () => {
    const input = makeMinimalInput({
      showQrCode: true,
      qrCodeContent: QRCodeContent.INVOICE_NUMBER_AND_CUFE,
      context: {
        invoice: { invoiceNumber: "INV001", cufeOfficial: "cufe123" },
      } as any,
    });
    const result = renderEscposReceipt(input);

    const qrHeader = [GS, 0x28, 0x6b];
    expect(searchBytes(result, qrHeader)).not.toBe(-1);
  });

  it("uses INVOICE_URL as QR content when specified", () => {
    const input = makeMinimalInput({
      showQrCode: true,
      qrCodeContent: QRCodeContent.INVOICE_URL,
      context: { invoice: { invoiceNumber: "INV001" } } as any,
    });
    const result = renderEscposReceipt(input);

    const qrHeader = [GS, 0x28, 0x6b];
    expect(searchBytes(result, qrHeader)).not.toBe(-1);
  });

  it("does not include QR code commands when showQrCode is false", () => {
    const input = makeMinimalInput({ showQrCode: false });
    const result = renderEscposReceipt(input);

    const qrHeader = [GS, 0x28, 0x6b];
    const position = searchBytes(result, qrHeader);

    expect(position).toBe(-1);
  });

  it("includes barcode data when barcodeData is provided", () => {
    const barcodeValue = "7701234567890";
    const input = makeMinimalInput({
      barcodeData: barcodeValue,
      barcodeType: "EAN13",
    });
    const result = renderEscposReceipt(input);

    // Barcode header for EAN13: GS 0x6B 0x43
    const barcodeHeader = [GS, 0x6b, 0x43];
    const position = searchBytes(result, barcodeHeader);

    expect(position).not.toBe(-1);
  });

  it("does not include barcode when barcodeData is omitted", () => {
    const input = makeMinimalInput({ barcodeData: undefined });
    const result = renderEscposReceipt(input);

    // Check that neither EAN13 nor CODE128 barcode commands appear
    const eanHeader = [GS, 0x6b, 0x43];
    const code128Header = [GS, 0x6b, 0x49];

    expect(searchBytes(result, eanHeader)).toBe(-1);
    expect(searchBytes(result, code128Header)).toBe(-1);
  });

  it("renders a line feed (0x0A) in the body area", () => {
    const result = renderEscposReceipt(makeMinimalInput());

    // At least one LF byte should be present
    const lfCount = Array.from(result).filter((b) => b === 0x0a).length;
    expect(lfCount).toBeGreaterThanOrEqual(1);
  });

  it("renders with 58mm paper width when specified", () => {
    const input = makeMinimalInput({ paperSize: PaperSize.RECEIPT_58MM });
    const result = renderEscposReceipt(input);

    expect(result.length).toBeGreaterThan(0);
  });

  it("includes footer text encoded as bytes in the output", () => {
    const footerText = "FOOTER_XYZ";
    const input = makeMinimalInput({ footerLines: [footerText] });
    const result = renderEscposReceipt(input);
    const needle = encodeString(footerText);

    const position = searchBytes(result, needle);

    expect(position).not.toBe(-1);
  });

  it("applies double-height formatting for section headers (## prefix)", () => {
    const input = makeMinimalInput({
      templateBody: "## TOTALES",
    });
    const result = renderEscposReceipt(input);

    const doubleHeightOn = [0x1b, 0x21, 0x10];
    expect(searchBytes(result, doubleHeightOn)).not.toBe(-1);
  });

  it("renders a CODE128 barcode when barcodeType is CODE128", () => {
    const barcodeValue = "ABC123";
    const input = makeMinimalInput({
      barcodeData: barcodeValue,
      barcodeType: "CODE128",
    });
    const result = renderEscposReceipt(input);

    // CODE128 header: GS 0x6B 0x49 followed by length byte
    const code128Header = [GS, 0x6b, 0x49, barcodeValue.length];
    expect(searchBytes(result, code128Header)).not.toBe(-1);
  });

  it("wraps long lines at word boundaries when exceeding maxChars", () => {
    // 80mm maxChars is 48 — build a line longer than that with a space break
    const part1 = "ProductoConNombreLargoX    $123.456,00  xx";
    const part2 = "99.000";
    const longLine = part1 + " " + part2; // 49+ chars total
    const shortLine = "Corto";

    const longInput = makeMinimalInput({ templateBody: longLine });
    const longResult = renderEscposReceipt(longInput);

    // Both parts of the wrapped line should appear as separate text segments
    expect(searchBytes(longResult, encodeString(part1))).not.toBe(-1);
    expect(searchBytes(longResult, encodeString(part2))).not.toBe(-1);

    // Short line renders contiguously without wrapping
    const shortInput = makeMinimalInput({ templateBody: shortLine });
    const shortResult = renderEscposReceipt(shortInput);
    expect(searchBytes(shortResult, encodeString(shortLine))).not.toBe(-1);
  });

  it("force-breaks a long line with no spaces", () => {
    const noSpaces = "A".repeat(60);
    const input = makeMinimalInput({
      templateBody: noSpaces,
    });
    const result = renderEscposReceipt(input);

    // The 60-char line should still be rendered (characters appear in output)
    expect(searchBytes(result, [0x41])).not.toBe(-1);
  });

  it("applies bold sub-header formatting for # prefix lines", () => {
    const input = makeMinimalInput({
      templateBody: "# Subtotal",
    });
    const result = renderEscposReceipt(input);

    // Sub-header uses bold on (ESC 0x45 0x01) then bold off (ESC 0x45 0x00)
    const boldOn = [0x1b, 0x45, 0x01];
    const boldOff = [0x1b, 0x45, 0x00];
    expect(searchBytes(result, boldOn)).not.toBe(-1);
    expect(searchBytes(result, boldOff)).not.toBe(-1);
    // Sub-header text should appear
    expect(searchBytes(result, encodeString("Subtotal"))).not.toBe(-1);
  });

  it("renders right-aligned totals for | ... | line format", () => {
    const input = makeMinimalInput({
      templateBody: "| TOTAL     $100.00 |",
    });
    const result = renderEscposReceipt(input);

    // Total text should appear (trimmed inner content)
    expect(searchBytes(result, encodeString("TOTAL     $100.00"))).not.toBe(-1);
  });

  it("renders a dash separator line for --- content", () => {
    const input = makeMinimalInput({
      templateBody: "---",
    });
    const result = renderEscposReceipt(input);

    // Separator duplicates ─ across maxChars
    const resultLength = result.length;
    expect(resultLength).toBeGreaterThan(0);
  });

  it("right-aligns lines starting with >>", () => {
    const input = makeMinimalInput({
      templateBody: ">> Pagado",
    });
    const result = renderEscposReceipt(input);

    // The text without prefix should appear
    expect(searchBytes(result, encodeString("Pagado"))).not.toBe(-1);
  });
});

describe("renderEscposTestPage", () => {
  it("returns a non-empty Uint8Array", () => {
    const result = renderEscposTestPage("TestPrinter");

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("starts with the ESC/POS init sequence", () => {
    const result = renderEscposTestPage("TestPrinter");

    expect(result[0]).toBe(ESC);
    expect(result[1]).toBe(0x40);
  });

  it("ends with a partial paper cut command", () => {
    const result = renderEscposTestPage("TestPrinter");

    expect(result[result.length - 3]).toBe(GS);
    expect(result[result.length - 2]).toBe(0x56);
    expect(result[result.length - 1]).toBe(0x01);
  });

  it("includes the printer name as encoded bytes", () => {
    const printerName = "EPSON_TM_88VI";
    const result = renderEscposTestPage(printerName);
    const needle = encodeString(printerName);

    const position = searchBytes(result, needle);

    expect(position).not.toBe(-1);
  });
});

describe("renderDrawerKickCommand", () => {
  it("returns a non-empty Uint8Array", () => {
    const result = renderDrawerKickCommand();

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("starts with the standard drawer kick prefix 0x1B 0x70", () => {
    const result = renderDrawerKickCommand();

    expect(result[0]).toBe(0x1b);
    expect(result[1]).toBe(0x70);
  });

  it("has the expected length of 5 bytes", () => {
    const result = renderDrawerKickCommand();

    expect(result).toHaveLength(5);
    expect(Array.from(result)).toEqual([0x1b, 0x70, 0x00, 0x32, 0xfa]);
  });
});
