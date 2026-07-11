/**
 * ESC/POS formatter for thermal receipt printers.
 *
 * Takes a receipt template and a VariableContext and produces raw ESC/POS
 * byte arrays ready to be sent to a thermal printer.
 *
 * ## Supported commands
 * - Text alignment (left, center, right)
 * - Bold text
 * - Underline (single, double)
 * - Double-width / double-height
 * - QR code (via ESC/POS QR model 2 commands)
 * - Barcode (Code128 / EAN13)
 * - Line feeds and paper cut (full/partial)
 * - Character encoding for Spanish locale
 *
 * ## Paper width handling
 * The formatter clips output to the configured paper width (default 80mm = 48 chars,
 * 58mm = 32 chars). Lines wider than the configured width are wrapped at word boundaries.
 */

import { PaperSize, type VariableContext, type QRCodeContent } from '../printing-types';
import { resolveTemplateVariables, resolveHeaderLines, resolveFooterLines } from './template-engine';

// Character widths per paper size (monospace font 12CPI)
const MAX_CHARS: Record<string, number> = {
  RECEIPT_80MM: 48,
  RECEIPT_58MM: 32,
  RECEIPT_76MM: 45,
};

// ESC/POS control bytes
const ESC = 0x1B;
const GS = 0x1D;
const LF = 0x0A;

// ---------------------------------------------------------------------------
// ESC/POS command builders
// ---------------------------------------------------------------------------

function text(data: string): number[] {
  return [...new TextEncoder().encode(data)];
}

function cmd(...bytes: number[]): number[] {
  return [...bytes];
}

function init(): number[] {
  return cmd(ESC, 0x40);
}

function lineFeed(n: number = 1): number[] {
  return cmd(LF).concat(new Array(n > 1 ? n - 1 : 0).fill(LF));
}

function setAlign(align: 'left' | 'center' | 'right'): number[] {
  const map: Record<string, number> = { left: 0x00, center: 0x01, right: 0x02 };
  return cmd(ESC, 0x61, map[align] ?? 0x00);
}

function setBold(on: boolean): number[] {
  return cmd(ESC, 0x45, on ? 1 : 0);
}

function setUnderline(mode: 0 | 1 | 2): number[] {
  return cmd(ESC, 0x2D, mode);
}

function setDoubleWidth(on: boolean): number[] {
  return cmd(ESC, 0x21, on ? 0x20 : 0x00);
}

function setDoubleHeight(on: boolean): number[] {
  return cmd(ESC, 0x21, on ? 0x10 : 0x00);
}

function setCharSize(width: 0 | 1, height: 0 | 1): number[] {
  const value = (width << 4) | height;
  return cmd(GS, 0x21, value);
}

function paperCut(full: boolean): number[] {
  return cmd(GS, 0x56, full ? 0x00 : 0x01);
}

function cashDrawerKick(): number[] {
  return cmd(ESC, 0x70, 0x00, 0x32, 0xFA);
}

function qrCode(data: string): number[] {
  const bytes = new TextEncoder().encode(data);
  const length = bytes.length + 3;
  const pL = length & 0xFF;
  const pH = (length >> 8) & 0xFF;

  return [
    // Model 2
    ...cmd(GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00),
    // Set module size
    ...cmd(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06),
    // Store data
    ...cmd(GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30),
    ...Array.from(bytes),
    // Print QR
    ...cmd(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30),
  ];
}

function barcode(code: string, type: 'CODE128' | 'EAN13'): number[] {
  if (type === 'EAN13') {
    return cmd(GS, 0x6B, 0x43, 12, ...new TextEncoder().encode(code.padEnd(12, '0')));
  }
  // CODE128
  const bytes = new TextEncoder().encode(code);
  return cmd(GS, 0x6B, 0x49, bytes.length, ...Array.from(bytes));
}

function setCharset(): number[] {
  // Latin-1 / Western European for Spanish
  return cmd(ESC, 0x52, 0x00);
}

function setCodePage(): number[] {
  // Code page 850 (Latin-1 with euro sign)
  return cmd(ESC, 0x74, 0x02);
}

// ---------------------------------------------------------------------------
// Line wrapping helper
// ---------------------------------------------------------------------------

function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];

  const lines: string[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      break;
    }

    // Try to break at a space within the limit
    const segment = remaining.slice(0, maxChars);
    const lastSpace = segment.lastIndexOf(' ');

    if (lastSpace > 0) {
      lines.push(remaining.slice(0, lastSpace));
      remaining = remaining.slice(lastSpace + 1);
    } else {
      lines.push(segment);
      remaining = remaining.slice(maxChars);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Receipt rendering
// ---------------------------------------------------------------------------

export interface EscposRenderInput {
  headerLines: string[];
  footerLines: string[];
  templateBody: string;
  showQrCode: boolean;
  qrCodeContent: QRCodeContent;
  showLogo: boolean;
  context: VariableContext;
  paperSize: PaperSize;
  /** Barcode data for product labels (optional). */
  barcodeData?: string;
  barcodeType?: 'CODE128' | 'EAN13';
}

/**
 * Render a complete receipt as ESC/POS byte array.
 *
 * @returns The raw ESC/POS bytes ready to be sent to the printer.
 */
export function renderEscposReceipt(input: EscposRenderInput): Uint8Array {
  const maxChars = MAX_CHARS[input.paperSize] ?? MAX_CHARS.RECEIPT_80MM;
  const bytes: number[] = [];

  // Initialize printer
  bytes.push(...init());
  bytes.push(...setCharset());
  bytes.push(...setCodePage());

  // ===== Header =====
  const resolvedHeader = resolveHeaderLines(input.headerLines, input.context);
  for (const line of resolvedHeader) {
    const wrapped = wrapLine(line, maxChars);
    for (const wLine of wrapped) {
      bytes.push(...setAlign('center'));
      bytes.push(...setBold(true));
      bytes.push(...setCharSize(0, 0));
      bytes.push(...text(wLine));
      bytes.push(...lineFeed());
    }
    bytes.push(...setBold(false));
  }
  bytes.push(...lineFeed());

  // ===== Separator =====
  bytes.push(...setAlign('center'));
  bytes.push(...text('─'.repeat(maxChars)));
  bytes.push(...lineFeed());

  // ===== Body =====
  const bodyText = resolveTemplateVariables(input.templateBody, input.context);
  const bodyLines = bodyText.split('\n');
  for (const line of bodyLines) {
    if (line.startsWith('## ')) {
      // Section header
      bytes.push(...setAlign('center'));
      bytes.push(...setBold(true));
      bytes.push(...setDoubleHeight(true));
      bytes.push(...text(line.slice(3).trim()));
      bytes.push(...setDoubleHeight(false));
      bytes.push(...setBold(false));
      bytes.push(...lineFeed());
    } else if (line.startsWith('# ')) {
      // Sub-header
      bytes.push(...setAlign('left'));
      bytes.push(...setBold(true));
      bytes.push(...text(line.slice(2).trim()));
      bytes.push(...setBold(false));
      bytes.push(...lineFeed());
    } else if (line.startsWith('| ') && line.endsWith(' |')) {
      // Right-aligned value (for totals)
      const content = line.slice(2, -2).trim();
      bytes.push(...setAlign('right'));
      bytes.push(...setBold(true));
      bytes.push(...setCharSize(1, 0)); // double width
      bytes.push(...text(content));
      bytes.push(...setCharSize(0, 0));
      bytes.push(...setBold(false));
      bytes.push(...lineFeed());
    } else if (line.trim() === '---') {
      // Separator
      bytes.push(...setAlign('center'));
      bytes.push(...text('─'.repeat(maxChars)));
      bytes.push(...lineFeed());
    } else {
      // Regular line
      const trimmed = line.trimEnd();
      const align = trimmed.startsWith('>>') ? 'right' : 'left';
      const displayText = align === 'right' ? trimmed.slice(2).trim() : trimmed;
      const wrapped = wrapLine(displayText, maxChars);
      for (const wLine of wrapped) {
        bytes.push(...setAlign(align));
        bytes.push(...text(wLine));
        bytes.push(...lineFeed());
      }
    }
  }

  bytes.push(...lineFeed());

  // ===== QR Code =====
  if (input.showQrCode && input.qrCodeContent !== 'NONE') {
    let qrData = '';
    const invoice = input.context.invoice as Record<string, unknown> | undefined;
    const invoiceNum = invoice?.invoiceNumber ?? '';
    const cufe = invoice?.cufeProvisional ?? invoice?.cufeOfficial ?? '';

    switch (input.qrCodeContent) {
      case 'INVOICE_NUMBER_AND_CUFE':
        qrData = `${invoiceNum}|${cufe}`;
        break;
      case 'CUFE_ONLY':
        qrData = String(cufe);
        break;
      case 'INVOICE_URL':
        qrData = `https://factura.farmacia.local/invoice/${invoiceNum}`;
        break;
    }

    if (qrData) {
      bytes.push(...setAlign('center'));
      bytes.push(...qrCode(qrData));
      bytes.push(...lineFeed(2));
    }
  }

  // ===== Barcode =====
  if (input.barcodeData) {
    bytes.push(...setAlign('center'));
    bytes.push(...barcode(input.barcodeData, input.barcodeType ?? 'CODE128'));
    bytes.push(...lineFeed());
  }

  // ===== Footer =====
  const resolvedFooter = resolveFooterLines(input.footerLines, input.context);
  if (resolvedFooter.length > 0) {
    bytes.push(...setAlign('center'));
    bytes.push(...setCharSize(0, 0));
    for (const line of resolvedFooter) {
      const wrapped = wrapLine(line, maxChars);
      for (const wLine of wrapped) {
        bytes.push(...text(wLine));
        bytes.push(...lineFeed());
      }
    }
  }

  // Line feeds before cut
  bytes.push(...lineFeed(3));

  // Paper cut
  bytes.push(...paperCut(false)); // partial cut

  return new Uint8Array(bytes);
}

/**
 * Generate a simple test page for a thermal receipt printer.
 */
export function renderEscposTestPage(printerName: string): Uint8Array {
  return renderEscposReceipt({
    headerLines: ['=== PRUEBA DE IMPRESIÓN ==='],
    footerLines: ['Gracias por usar Farmacia POS', 'Ayuda: https://ayuda.farmacia.local/impresoras'],
    templateBody: [
      `Impresora: ${printerName}`,
      `Fecha: ${new Date().toLocaleString('es-CO')}`,
      '',
      'Si lee este texto,',
      'la impresora funciona correctamente.',
    ].join('\n'),
    showQrCode: false,
    qrCodeContent: 'NONE' as QRCodeContent,
    showLogo: false,
    context: {},
    paperSize: PaperSize.RECEIPT_80MM,
  });
}

/**
 * Generate a cash drawer open command (standard ESC/POS kick).
 */
export function renderDrawerKickCommand(): Uint8Array {
  return new Uint8Array(cashDrawerKick());
}
