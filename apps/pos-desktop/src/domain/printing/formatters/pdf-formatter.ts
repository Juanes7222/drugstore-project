/**
 * PDF formatter for laser/inkjet and letter/A4 document printing.
 *
 * Takes a receipt template with `templateFormat: PDF_TEMPLATE` or
 * `HTML_TEMPLATE` and a VariableContext, and produces a printable
 * document.
 *
 * - `PDF_TEMPLATE`: generates a PDF using `pdf-lib` (if available)
 *   or delegates to the existing fiscal PDF generation logic.
 * - `HTML_TEMPLATE`: renders an HTML document styled for the target
 *   paper size, which the Tauri webview converts to PDF via the OS
 *   print dialog or the Rust print_pdf command.
 */

import { PaperSize, TemplateFormat, type VariableContext } from '../printing-types';
import { resolveTemplateVariables, resolveHeaderLines, resolveFooterLines } from './template-engine';

// Paper dimensions in mm
const PAPER_DIMENSIONS: Record<string, { widthMm: number; heightMm: number }> = {
  LETTER: { widthMm: 215.9, heightMm: 279.4 },
  A4: { widthMm: 210, heightMm: 297 },
};

export interface PdfRenderInput {
  headerLines: string[];
  footerLines: string[];
  templateBody: string;
  templateFormat: TemplateFormat;
  paperSize: PaperSize;
  context: VariableContext;
  /** Optional document title for the PDF metadata. */
  title?: string;
  /** Whether to include page numbers. */
  showPageNumbers?: boolean;
  /** The pharmacy logo path for the document header. */
  logoPath?: string | null;
}

/**
 * Generate an HTML document styled for the given paper size.
 * The HTML can be:
 * - Printed via the Tauri webview's built-in print functionality
 * - Converted to PDF by the Rust `print_file` command
 * - Saved as a standalone HTML file
 *
 * @returns HTML string ready for print/PDF conversion.
 */
export function generatePdfHtml(input: PdfRenderInput): string {
  const dims = PAPER_DIMENSIONS[input.paperSize] ?? PAPER_DIMENSIONS.A4;

  const resolvedHeader = resolveHeaderLines(input.headerLines, input.context);
  const bodyText = resolveTemplateVariables(input.templateBody, input.context);
  const resolvedFooter = resolveFooterLines(input.footerLines, input.context);

  const showPageNumbers = input.showPageNumbers ?? true;
  const title = input.title ?? 'Documento';

  const headerHtml = resolvedHeader
    .map((line) => `<p class="header-line">${escapeHtml(line)}</p>`)
    .join('\n');

  const footerHtml = resolvedFooter
    .map((line) => `<p class="footer-line">${escapeHtml(line)}</p>`)
    .join('\n');

  // Render template body markdown-style formatting
  const bodyHtml = renderBodyToHtml(bodyText);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  @page {
    size: ${dims.widthMm}mm ${dims.heightMm}mm;
    margin: 15mm 15mm 20mm 15mm;
    ${showPageNumbers ? '@bottom-center { content: counter(page); font-size: 8pt; color: #999; }' : ''}
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', monospace;
    font-size: 10pt;
    line-height: 1.4;
    color: #000;
  }
  .document-header {
    text-align: center;
    margin-bottom: 10mm;
    padding-bottom: 5mm;
    border-bottom: 2px solid #000;
  }
  .header-line {
    font-size: 11pt;
    margin: 2px 0;
  }
  .header-line:first-child {
    font-size: 14pt;
    font-weight: bold;
  }
  .document-body {
    margin-bottom: 10mm;
  }
  .body-line {
    margin: 2px 0;
  }
  .body-line.section-title {
    font-size: 12pt;
    font-weight: bold;
    margin: 4mm 0 2mm 0;
    border-bottom: 1px solid #ccc;
    padding-bottom: 1mm;
  }
  .body-line.sub-section {
    font-weight: bold;
    margin: 2mm 0 1mm 0;
  }
  .body-line.divider {
    border-top: 1px dashed #999;
    margin: 3mm 0;
  }
  .body-line.right {
    text-align: right;
    font-weight: bold;
    font-size: 12pt;
  }
  .body-line.total {
    text-align: right;
    font-size: 14pt;
    font-weight: bold;
    margin-top: 3mm;
    border-top: 2px solid #000;
    padding-top: 1mm;
  }
  .body-line.item-row {
    display: flex;
    justify-content: space-between;
  }
  .document-footer {
    text-align: center;
    margin-top: 10mm;
    padding-top: 5mm;
    border-top: 1px solid #ccc;
    font-size: 9pt;
    color: #666;
  }
  .footer-line {
    margin: 1px 0;
  }
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin: 3mm 0;
  }
  table.items th {
    text-align: left;
    font-size: 9pt;
    border-bottom: 1px solid #000;
    padding: 1mm 0;
  }
  table.items td {
    padding: 0.5mm 0;
    font-size: 9pt;
  }
  table.items td.amount,
  table.items td.price,
  table.items td.total {
    text-align: right;
  }
  table.items td.qty {
    text-align: center;
  }
</style>
</head>
<body>
  <div class="document-header">
    ${headerHtml}
  </div>

  <div class="document-body">
    ${bodyHtml}
  </div>

  <div class="document-footer">
    ${footerHtml}
  </div>
</body>
</html>`;
}

/**
 * Convert a simple markdown-like template body to HTML.
 * Supports: ## sections, # subsections, --- dividers, | value | for right-align.
 */
function renderBodyToHtml(text: string): string {
  const lines = text.split('\n');
  const htmlLines: string[] = [];
  let inTable = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('## ')) {
      if (inTable) { htmlLines.push('</table>'); inTable = false; }
      htmlLines.push(`<div class="body-line section-title">${escapeHtml(line.slice(3).trim())}</div>`);
    } else if (line.startsWith('# ')) {
      if (inTable) { htmlLines.push('</table>'); inTable = false; }
      htmlLines.push(`<div class="body-line sub-section">${escapeHtml(line.slice(2).trim())}</div>`);
    } else if (line.startsWith('| ') && line.endsWith(' |')) {
      if (inTable) { htmlLines.push('</table>'); inTable = false; }
      const content = line.slice(2, -2).trim();
      htmlLines.push(`<div class="body-line total">${escapeHtml(content)}</div>`);
    } else if (line.trim() === '---') {
      if (inTable) { htmlLines.push('</table>'); inTable = false; }
      htmlLines.push('<div class="body-line divider"></div>');
    } else if (line.startsWith('>> ')) {
      if (inTable) { htmlLines.push('</table>'); inTable = false; }
      htmlLines.push(`<div class="body-line right">${escapeHtml(line.slice(3).trim())}</div>`);
    } else if (line.startsWith('| ') && line.includes(' | ') && line.includes(' |')) {
      // Table row
      if (!inTable) {
        htmlLines.push('<table class="items">');
        inTable = true;
      }
      const cells = line.split('|').filter(Boolean).map((c) => c.trim());
      // Determine if it's a header (first row after ---)
      if (cells.length >= 3) {
        htmlLines.push('<tr>');
        htmlLines.push(`<td class="qty">${escapeHtml(cells[0])}</td>`);
        htmlLines.push(`<td>${escapeHtml(cells[1])}</td>`);
        if (cells[2]) htmlLines.push(`<td class="price">${escapeHtml(cells[2])}</td>`);
        if (cells[3]) htmlLines.push(`<td class="total">${escapeHtml(cells[3])}</td>`);
        htmlLines.push('</tr>');
      }
    } else {
      if (inTable) { htmlLines.push('</table>'); inTable = false; }
      htmlLines.push(`<div class="body-line">${escapeHtml(line) || '&nbsp;'}</div>`);
    }
  }

  if (inTable) htmlLines.push('</table>');

  return htmlLines.join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
