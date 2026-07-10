/**
 * Printable receipt generator for provisional fiscal documents.
 *
 * Generates an HTML document formatted for 80mm thermal receipt printers.
 * The HTML can be printed via the OS print dialog (`window.print()`) or sent
 * directly to a connected fiscal printer through the OS print pipeline.
 *
 * The generator runs entirely client-side — no server round-trip. PDF
 * generation uses the browser's built-in print-to-PDF capability.
 *
 * ## Receipt layout
 *
 * - Seller header (NIT, name, address, resolution)
 * - Invoice number with "CONTINGENCIA" marker when applicable
 * - Line items with prices and taxes
 * - Totals breakdown
 * - Payment methods
 * - Provisional CUFE with DIAN-pending label
 * - QR code (generated as inline SVG)
 * - Regulatory footer text
 */

import type { InvoiceFullData } from './fiscal-types';

/**
 * Generate a printable receipt HTML document for the given invoice.
 *
 * @returns The full HTML string for the receipt. Callers can create a blob
 *          URL from it and either open a new window for printing or pass it
 *          directly to the print dialog.
 */
export function generateReceiptHtml(invoice: {
  id: string;
  invoiceNumber: string;
  contingencyNumber: string | null;
  invoiceType: string;
  status: string;
  cufeProvisional: string;
  cufeOfficial: string | null;
  issuedAt: Date | string;
  fullData: unknown;
}): string {
  const data = invoice.fullData as InvoiceFullData | null;
  const isContingency = invoice.status === 'CONTINGENCY_PENDING_TRANSMISSION';
  const isCreditNote = invoice.invoiceType === 'CREDIT_NOTE';
  const isCancellation = invoice.invoiceType === 'CONTINGENCY_CANCELLATION';
  const cufeDisplay = invoice.cufeOfficial ?? invoice.cufeProvisional;

  const issuedDate = typeof invoice.issuedAt === 'string'
    ? invoice.issuedAt
    : invoice.issuedAt.toISOString();
  const formattedDate = formatDate(issuedDate);
  const formattedTime = formatTime(issuedDate);

  const seller = data?.seller;
  const buyer = data?.buyer;
  const taxSummaries = data?.taxSummaries ?? [];
  const payments = data?.payments ?? [];

  // ── Build document ───────────────────────────────────────────────────────

  const doc = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${isCreditNote ? 'Nota Crédito' : isCancellation ? 'Anulación' : 'Factura'} ${escapeHtml(invoice.invoiceNumber)}</title>
<style>
  @page { margin: 0; size: 80mm auto; }
  @media print { html, body { width: 80mm; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 10px;
    line-height: 1.3;
    color: #000;
    background: #fff;
    width: 72mm;
    padding: 2mm;
  }
  .header { text-align: center; margin-bottom: 3mm; }
  .header h1 { font-size: 12px; font-weight: bold; text-transform: uppercase; }
  .header .nit { font-size: 9px; }
  .header .resolution { font-size: 8px; color: #333; }

  ${isContingency ? '.contingency-badge { background: #000; color: #fff; text-align: center; padding: 1mm 0; font-weight: bold; font-size: 11px; margin: 2mm 0; letter-spacing: 1px; }' : ''}
  ${isCancellation ? '.cancellation-badge { background: #000; color: #fff; text-align: center; padding: 1mm 0; font-weight: bold; font-size: 11px; margin: 2mm 0; }' : ''}

  .invoice-meta { width: 100%; margin-bottom: 2mm; }
  .invoice-meta td { padding: 0.5mm 0; vertical-align: top; }
  .invoice-meta .label { font-weight: bold; white-space: nowrap; width: 30%; }
  .invoice-meta .value { width: 70%; }

  .separator { border-top: 1px dashed #000; margin: 2mm 0; }
  .dashed { border-top: 1px dashed #000; }

  table.items { width: 100%; border-collapse: collapse; margin-bottom: 2mm; }
  table.items .item td { padding: 0.5mm 0; vertical-align: top; }
  table.items .desc { width: 55%; }
  table.items .qty { width: 15%; text-align: center; }
  table.items .price { width: 30%; text-align: right; }

  table.totals { width: 100%; border-collapse: collapse; }
  table.totals .label { width: 70%; text-align: left; font-weight: bold; }
  table.totals .value { width: 30%; text-align: right; }
  table.totals .total { font-size: 12px; font-weight: bold; border-top: 1px solid #000; }

  .payments { margin-bottom: 2mm; }
  .payments td { padding: 0.5mm 0; }

  .cufe-section { margin: 3mm 0; padding: 1mm; border: 1px dashed #000; text-align: center; word-break: break-all; font-size: 8px; }
  .cufe-section .cufe-label { font-weight: bold; font-size: 9px; }
  ${!invoice.cufeOfficial ? '.cufe-section .cufe-pending { color: #c00; font-weight: bold; }' : ''}

  .qr-code { text-align: center; margin: 2mm 0; }
  .qr-code svg { width: 40mm; height: 40mm; }

  .footer { margin-top: 3mm; font-size: 8px; text-align: center; border-top: 1px solid #000; padding-top: 1mm; }

  .buyer-info { margin-bottom: 2mm; }
  .buyer-info .name { font-weight: bold; }

  .prescription-note { font-size: 8px; color: #666; text-align: center; margin: 1mm 0; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>

<div class="header">
  <h1>${escapeHtml(seller?.name ?? 'Farmacia')}</h1>
  <div class="nit">NIT: ${escapeHtml(seller?.nit ?? '000.000.000-0')}</div>
  ${seller?.address ? `<div>${escapeHtml(seller.address)}</div>` : ''}
  ${seller?.phone ? `<div>Tel: ${escapeHtml(seller.phone)}</div>` : ''}
  ${seller?.resolutionNumber
    ? `<div class="resolution">Res. DIAN: ${escapeHtml(seller.resolutionNumber)} ${seller.resolutionDate ? `del ${seller.resolutionDate}` : ''}</div>`
    : ''}
</div>

${isContingency ? '<div class="contingency-badge">*** CONTINGENCIA ***</div>' : ''}
${isCancellation ? '<div class="cancellation-badge">DOCUMENTO DE CONTINGENCIA - ANULACIÓN</div>' : ''}

${isCreditNote ? '<div class="contingency-badge" style="background:#666;">*** NOTA CRÉDITO ***</div>' : ''}

<table class="invoice-meta">
  <tr><td class="label">No.</td><td class="value">${escapeHtml(invoice.invoiceNumber)}</td></tr>
  ${invoice.contingencyNumber && invoice.contingencyNumber !== invoice.invoiceNumber
    ? `<tr><td class="label">Contingencia</td><td class="value">${escapeHtml(invoice.contingencyNumber)}</td></tr>`
    : ''}
  <tr><td class="label">Fecha</td><td class="value">${formattedDate}</td></tr>
  <tr><td class="label">Hora</td><td class="value">${formattedTime}</td></tr>
  ${data?.prescriptionNumber ? `<tr><td class="label">Rx</td><td class="value">${escapeHtml(data.prescriptionNumber)}</td></tr>` : ''}
</table>

<div class="dashed"></div>

${buyer ? `
<div class="buyer-info">
  <span class="name">${escapeHtml(buyer.name)}</span>
  ${buyer.identificationNumber ? `<br>${escapeHtml(buyer.identificationType ?? '')} ${escapeHtml(buyer.identificationNumber)}` : ''}
</div>
` : ''}

<div class="dashed"></div>

<table class="items">
  <thead>
    <tr><th class="desc">Producto</th><th class="qty">Cant</th><th class="price">Total</th></tr>
  </thead>
  <tbody>
    ${data?.lineItems?.map(item => `
      <tr class="item">
        <td class="desc">${escapeHtml(item.commercialName)}</td>
        <td class="qty">${item.quantity}</td>
        <td class="price">${formatCurrency(item.total)}</td>
      </tr>
    `).join('') ?? ''}
  </tbody>
</table>

<div class="dashed"></div>

<table class="totals">
  <tr><td class="label">Subtotal</td><td class="value">${formatCurrency(data?.subtotal ?? '0')}</td></tr>
  ${Number(data?.totalDiscount ?? 0) > 0 ? `<tr><td class="label">Descuento</td><td class="value">-${formatCurrency(data?.totalDiscount ?? '0')}</td></tr>` : ''}
  ${taxSummaries.map(t => `
    <tr><td class="label">${escapeHtml(t.scheme)} ${Number(t.rate) * 100}%</td><td class="value">${formatCurrency(t.taxAmount)}</td></tr>
  `).join('')}
  <tr class="total"><td class="label">TOTAL</td><td class="value">${formatCurrency(data?.totalAmount ?? '0')}</td></tr>
</table>

<div class="separator"></div>

${payments.length > 0 ? `
<table class="payments">
  <tr><td colspan="3" style="font-weight:bold;">Forma de pago</td></tr>
  ${payments.map(p => `
    <tr><td>${escapeHtml(p.paymentMethodName)}</td><td style="text-align:right;">${formatCurrency(p.amount)}</td></tr>
  `).join('')}
</table>
` : ''}

<div class="cufe-section">
  <div class="cufe-label">CUFE${!invoice.cufeOfficial ? ' PROVISIONAL' : ''}</div>
  <div style="font-size:7px;word-break:break-all;">${cufeDisplay}</div>
  ${!invoice.cufeOfficial ? '<div class="cufe-pending">PENDIENTE AUTORIZACIÓN DIAN</div>' : ''}
</div>

<div class="footer">
  Esta factura ser&aacute; transmitida a la DIAN dentro de las 48 horas siguientes.<br>
  Conserve este documento como comprobante provisional.<br><br>
  Generado: ${formattedDate} ${formattedTime}
</div>

</body>
</html>`;

  return doc;
}

/**
 * Escape HTML special characters in user-provided strings.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format a numeric string as COP currency (e.g. "12,500.00").
 */
function formatCurrency(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '$0';
  return `$${parsed.toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format an ISO-8601 date string to DD/MM/YYYY.
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Format an ISO-8601 date string to HH:MM:SS (24h).
 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Open a print dialog for the given HTML content.
 * Creates a temporary iframe, writes the HTML, and triggers print.
 */
export function printReceipt(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) {
    // Fallback: open a new window
    const win = window.open('', '_blank', 'width=400,height=600');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 500);
    }
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  iframe.onload = () => {
    iframe.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  };
}

/**
 * Create a blob URL from receipt HTML for download/save-as-PDF.
 */
export function createReceiptBlobUrl(html: string): string {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  return URL.createObjectURL(blob);
}
