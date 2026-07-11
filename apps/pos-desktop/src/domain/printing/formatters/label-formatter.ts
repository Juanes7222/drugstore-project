/**
 * Label image formatter for thermal label printers.
 *
 * Generates product labels as PNG images sized for the configured label paper.
 * Each label includes: product name, price, barcode (Code 128 or EAN-13),
 * and an optional logo.
 *
 * The image is generated as an HTML string styled for the label dimensions,
 * which is then converted to a PNG by the Rust print_label_image command
 * (or a headless browser renderer).
 *
 * ## Label dimensions
 * - LABEL_50X25: 50mm × 25mm (~189 × 94 px at 96dpi)
 * - LABEL_62X29: 62mm × 29mm (~234 × 110 px at 96dpi)
 * - LABEL_OTHER: user-defined in PrinterConfig.customPaperWidthMm/HeightMm
 */

import { PaperSize, type VariableContext } from '../printing-types';
import { resolveTemplateVariables } from './template-engine';

// Label dimensions in mm converted to CSS pixels (1mm ≈ 3.78px at 96dpi)
const LABEL_DIMENSIONS: Record<string, { widthMm: number; heightMm: number; cssWidth: number; cssHeight: number }> = {
  LABEL_50X25: { widthMm: 50, heightMm: 25, cssWidth: 189, cssHeight: 95 },
  LABEL_62X29: { widthMm: 62, heightMm: 29, cssWidth: 234, cssHeight: 110 },
  LABEL_OTHER: { widthMm: 50, heightMm: 25, cssWidth: 189, cssHeight: 95 }, // fallback
  CUSTOM: { widthMm: 50, heightMm: 25, cssWidth: 189, cssHeight: 95 },
};

export interface LabelRenderInput {
  /** Product name (may wrap to 2 lines). */
  productName: string;
  /** Product display price. */
  price: number;
  /** Barcode data (EAN-13 or Code 128 value). */
  barcode: string;
  /** Barcode type for rendering. */
  barcodeType?: 'CODE128' | 'EAN13';
  /** Optional product code / SKU shown below the barcode. */
  productCode?: string;
  /** Label paper size. */
  paperSize: PaperSize;
  /** Custom dimensions when paperSize is CUSTOM or LABEL_OTHER. */
  customWidthMm?: number;
  customHeightMm?: number;
  /** Whether to show the pharmacy logo. */
  showLogo?: boolean;
  /** URL or path to the logo image. */
  logoPath?: string;
  /** Additional context for variable substitution. */
  context?: VariableContext;
}

/**
 * Generate an HTML document styled as a product label.
 * The HTML is rendered to a PNG via the Rust backend.
 *
 * @returns HTML string ready to be converted to an image.
 */
export function generateLabelHtml(input: LabelRenderInput): string {
  const dims = LABEL_DIMENSIONS[input.paperSize] ?? LABEL_DIMENSIONS.LABEL_50X25;
  const widthPx = input.customWidthMm
    ? Math.round(input.customWidthMm * 3.78)
    : dims.cssWidth;
  const heightPx = input.customHeightMm
    ? Math.round(input.customHeightMm * 3.78)
    : dims.cssHeight;

  const showLogo = input.showLogo ?? true;
  const logoHtml = showLogo && input.logoPath
    ? `<img src="${input.logoPath}" alt="Logo" class="logo" />`
    : '';

  const formattedPrice = input.price.toLocaleString('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${widthPx}px;
    height: ${heightPx}px;
    font-family: 'Arial', 'Helvetica', sans-serif;
    font-size: 8px;
    line-height: 1.1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2px;
    overflow: hidden;
    background: #fff;
  }
  .logo { max-height: ${Math.round(heightPx * 0.2)}px; margin-bottom: 1px; }
  .product-name {
    font-size: 9px;
    font-weight: bold;
    text-align: center;
    max-height: ${Math.round(heightPx * 0.3)}px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }
  .price {
    font-size: 14px;
    font-weight: bold;
    text-align: center;
    margin: 1px 0;
  }
  .barcode-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .barcode-img {
    max-width: ${widthPx - 8}px;
    height: ${Math.round(heightPx * 0.3)}px;
  }
  .sku {
    font-size: 6px;
    color: #666;
    margin-top: 1px;
  }
</style>
</head>
<body>
  ${logoHtml}
  <div class="product-name">${escapeHtml(input.productName)}</div>
  <div class="price">${formattedPrice}</div>
  <div class="barcode-wrap">
    <svg class="barcode-img"
      jsbarcode-value="${escapeHtml(input.barcode)}"
      jsbarcode-format="${input.barcodeType === 'EAN13' ? 'EAN13' : 'CODE128'}"
      jsbarcode-width="1"
      jsbarcode-height="${Math.round(heightPx * 0.25)}"
      jsbarcode-displayValue="false"
      jsbarcode-margin="0"
      jsbarcode-marginTop="0"
      jsbarcode-marginBottom="0"
      jsbarcode-marginLeft="0"
      jsbarcode-marginRight="0"
      jsbarcode-background="#ffffff"
      jsbarcode-lineColor="#000000">
    </svg>
    ${input.productCode ? `<div class="sku">${escapeHtml(input.productCode)}</div>` : ''}
  </div>
</body>
</html>`;
}

export interface LabelRenderBatchInput {
  products: LabelRenderInput[];
  paperSize: PaperSize;
  customWidthMm?: number;
  customHeightMm?: number;
  showLogo?: boolean;
  logoPath?: string;
}

/**
 * Generate labels for multiple products.
 * Each label is a separate full-width page in the output.
 */
export function generateBatchLabelHtml(input: LabelRenderBatchInput): string {
  const pages = input.products.map((product) =>
    generateLabelHtml({
      ...product,
      paperSize: input.paperSize,
      customWidthMm: input.customWidthMm,
      customHeightMm: input.customHeightMm,
      showLogo: input.showLogo ?? product.showLogo,
      logoPath: input.logoPath ?? product.logoPath,
    }),
  );

  // Combine labels with page breaks between them
  return pages.join('<div style="page-break-after: always;"></div>');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
