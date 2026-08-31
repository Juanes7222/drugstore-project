/**
 * Printable receipt generator — modular, paper-size aware, screen-responsive.
 *
 * Generates a single HTML document that serves two contexts:
 *  - **Screen preview** (iframe inside Receipt component): fluid, centered card,
 *    larger typography (12-13px), soft background, shadow, adapts to viewport.
 *  - **Print** (`@media print` + `@page`): fixed paper width (80mm default),
 *    compact typography (9-10px), no shadow, exact mm sizing for thermal printers.
 *
 * Paper sizes come from the printing domain (`PaperSize` enum) but this module
 * stays decoupled via a local `ReceiptPaperSize` union — callers can pass the
 * enum value directly or a string literal.
 *
 * Layout mimics professional pharmacy POS receipts (Brazil/Colombia thermal
 * references): header → badges → meta grid → buyer → delivery → items →
 * totals → payments → CUFE → QR → footer. Each section is a pure function
 * returning an HTML string, so tests can target a section in isolation and
 * future paper variants only replace `buildStyles`.
 */

import type { InvoiceFullData } from './fiscal-types';

// ---------------------------------------------------------------------------
// Paper size
// ---------------------------------------------------------------------------

export type ReceiptPaperSize =
  | 'RECEIPT_58MM'
  | 'RECEIPT_76MM'
  | 'RECEIPT_80MM'
  | 'A4'
  | 'LETTER'
  | 'CUSTOM';

interface PaperConfig {
  label: string;
  /** Width for @page / print (real mm). */
  printWidth: string;
  /** @page size rule */
  pageSize: string;
  /** Screen card width — scaled up for readability (px). */
  screenMaxWidth: string;
  /** Screen outer padding */
  screenPadding: string;
}

const PAPER_CONFIG: Record<ReceiptPaperSize, PaperConfig> = {
  RECEIPT_58MM: {
    label: '58 mm',
    printWidth: '58mm',
    pageSize: '58mm auto',
    screenMaxWidth: '360px',
    screenPadding: '10px 11px',
  },
  RECEIPT_76MM: {
    label: '76 mm',
    printWidth: '76mm',
    pageSize: '76mm auto',
    screenMaxWidth: '400px',
    screenPadding: '11px 13px',
  },
  RECEIPT_80MM: {
    label: '80 mm',
    printWidth: '80mm',
    pageSize: '80mm auto',
    screenMaxWidth: '440px',
    screenPadding: '12px 14px',
  },
  A4: {
    label: 'A4',
    printWidth: '210mm',
    pageSize: 'A4',
    screenMaxWidth: '720px',
    screenPadding: '18px 22px',
  },
  LETTER: {
    label: 'Carta',
    printWidth: '216mm',
    pageSize: 'letter',
    screenMaxWidth: '720px',
    screenPadding: '18px 22px',
  },
  CUSTOM: {
    label: 'Custom',
    printWidth: '80mm',
    pageSize: '80mm auto',
    screenMaxWidth: '440px',
    screenPadding: '12px 14px',
  },
};

function resolvePaperConfig(paperSize?: string | null): PaperConfig {
  if (paperSize && paperSize in PAPER_CONFIG) {
    return PAPER_CONFIG[paperSize as ReceiptPaperSize];
  }
  return PAPER_CONFIG.RECEIPT_80MM;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateReceiptOptions {
  id: string;
  invoiceNumber: string;
  contingencyNumber: string | null;
  invoiceType: string;
  status: string;
  cufeProvisional: string;
  cufeOfficial: string | null;
  issuedAt: Date | string;
  fullData: unknown;
  delivery?: {
    address: string | null;
    contactName: string | null;
    contactPhone: string | null;
    notes: string | null;
    scheduledAt: string | null;
  } | null;
  deliveryFeeCents?: number;
  /** Paper size — defaults to 80mm thermal. */
  paperSize?: ReceiptPaperSize | string | null;
  /** When false, QR section is omitted (fiscal.showQrOnReceipt). Null = auto (show if CUFE exists). */
  showQr?: boolean | null;
  /** When false, CUFE section is omitted. Null = auto (hide when CUFE empty/provisional blank). */
  showCufe?: boolean | null;
  /** Optional header/footer text from fiscal.invoiceHeader / invoiceFooter. */
  invoiceHeader?: string | null;
  invoiceFooter?: string | null;
}

/**
 * Generate a printable receipt HTML document.
 *
 * The returned string is a complete `<!DOCTYPE html>` document. Render it
 * inside an iframe (`srcDoc`) for preview and call `printReceipt(html)` to
 * open the print dialog — the document's own `@media print` rules handle the
 * paper-size switch automatically.
 */
export function generateReceiptHtml(invoice: GenerateReceiptOptions): string {
  const data = invoice.fullData as InvoiceFullData | null;
  const paper = resolvePaperConfig(invoice.paperSize ?? null);

  const isContingency = invoice.status === 'CONTINGENCY_PENDING_TRANSMISSION';
  const isCreditNote = invoice.invoiceType === 'CREDIT_NOTE';
  const isCancellation = invoice.invoiceType === 'CONTINGENCY_CANCELLATION';
  const cufeDisplay = invoice.cufeOfficial ?? invoice.cufeProvisional;
  const hasOfficialCufe = Boolean(invoice.cufeOfficial);

  const issuedDate = typeof invoice.issuedAt === 'string' ? invoice.issuedAt : invoice.issuedAt.toISOString();
  const formattedDate = formatDate(issuedDate);
  const formattedTime = formatTime(issuedDate);

  const seller = data?.seller;
  const buyer = data?.buyer;
  const taxSummaries = data?.taxSummaries ?? [];
  const payments = data?.payments ?? [];
  const lineItems = data?.lineItems ?? [];

  const delivery = invoice.delivery ?? null;
  const deliveryFeeCents = Math.max(0, Math.round(invoice.deliveryFeeCents ?? 0));
  const hasDeliveryFee = deliveryFeeCents > 0;
  const grandTotal = hasDeliveryFee
    ? (Number(data?.totalAmount ?? 0) + deliveryFeeCents / 100).toFixed(2)
    : (data?.totalAmount ?? '0');
  const scheduledAt = delivery?.scheduledAt ? formatDateTime(delivery.scheduledAt) : null;

  const docTypeLabel = isCreditNote ? 'Nota Crédito' : isCancellation ? 'Anulación' : 'Factura';
  const docTitle = `${docTypeLabel} ${invoice.invoiceNumber}`;

  // QR / CUFE visibility — respects fiscal config when caller provides it
  const cufeExists = Boolean(cufeDisplay && cufeDisplay.trim() && cufeDisplay.trim() !== '—');
  const shouldShowCufe = invoice.showCufe === false ? false : invoice.showCufe === true ? cufeExists : cufeExists;
  const shouldShowQr = invoice.showQr === false ? false : invoice.showQr === true ? cufeExists : cufeExists;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(docTitle)}</title>
${buildStyles(paper, { isContingency, isCancellation, isCreditNote })}
</head>
<body>
  <div class="receipt-root">
    <article class="receipt-paper" role="document" aria-label="${escapeHtml(docTitle)}">
      ${buildHeader(seller, invoice.invoiceHeader ?? null)}
      ${buildBadges({ isContingency, isCancellation, isCreditNote })}
      ${buildMeta({ invoice, formattedDate, formattedTime, prescriptionNumber: data?.prescriptionNumber ?? null })}
      ${buildBuyer(buyer)}
      ${buildDelivery(delivery, scheduledAt)}
      ${buildItems(lineItems)}
      ${buildTotals({ data, taxSummaries, lineItems, hasDeliveryFee, deliveryFeeCents, grandTotal })}
      ${buildPayments(payments)}
      ${shouldShowCufe ? buildCufe(cufeDisplay, hasOfficialCufe) : ''}
      ${shouldShowQr ? buildQrPlaceholder(cufeDisplay) : ''}
      ${buildFooter(formattedDate, formattedTime, invoice.invoiceFooter ?? null)}
    </article>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Section builders — each is a pure HTML-string function, independently testable
// ---------------------------------------------------------------------------

function buildHeader(seller: InvoiceFullData['seller'] | undefined, invoiceHeader: string | null): string {
  const name = escapeHtml(seller?.name ?? 'Farmacia');
  const nit = escapeHtml(seller?.nit ?? '000.000.000-0');
  const address = seller?.address ? `<div class="hdr-line">${escapeHtml(seller.address)}</div>` : '';
  const phone = seller?.phone ? `<div class="hdr-line">Tel: ${escapeHtml(seller.phone)}</div>` : '';
  const resolution = seller?.resolutionNumber
    ? `<div class="hdr-resolution">Res. DIAN ${escapeHtml(seller.resolutionNumber)}${seller.resolutionDate ? ` · ${escapeHtml(seller.resolutionDate)}` : ''}${seller.resolutionPrefix ? ` · Prefijo ${escapeHtml(seller.resolutionPrefix)}` : ''}</div>`
    : '';
  const customHeader = invoiceHeader?.trim()
    ? `<div class="hdr-custom">${escapeHtml(invoiceHeader.trim())}</div>`
    : '';

  return `
  <header class="hdr">
    <div class="hdr-mark" aria-hidden="true"><span class="hdr-mark-dot"></span> POS</div>
    <h1 class="hdr-title">${name}</h1>
    <div class="hdr-nit">NIT ${nit}</div>
    ${address}
    ${phone}
    ${resolution}
    ${customHeader}
  </header>`;
}

function buildBadges(flags: { isContingency: boolean; isCancellation: boolean; isCreditNote: boolean }): string {
  const parts: string[] = [];
  if (flags.isContingency) parts.push('<div class="badge badge--contingency">● CONTINGENCIA — Documento provisional</div>');
  if (flags.isCancellation) parts.push('<div class="badge badge--cancel">ANULACIÓN — DOCUMENTO DE CONTINGENCIA</div>');
  if (flags.isCreditNote) parts.push('<div class="badge badge--credit">*** NOTA CRÉDITO ***</div>');
  if (parts.length === 0) return '';
  return `<div class="badge-stack">${parts.join('')}</div>`;
}

function buildMeta(args: {
  invoice: GenerateReceiptOptions;
  formattedDate: string;
  formattedTime: string;
  prescriptionNumber: string | null;
}): string {
  const { invoice, formattedDate, formattedTime, prescriptionNumber } = args;
  const contingencyRow =
    invoice.contingencyNumber && invoice.contingencyNumber !== invoice.invoiceNumber
      ? `<div class="meta-row"><span class="meta-k">Contingencia</span><span class="meta-v mono">${escapeHtml(invoice.contingencyNumber)}</span></div>`
      : '';
  const rxRow = prescriptionNumber ? `<div class="meta-row"><span class="meta-k">Fórmula</span><span class="meta-v mono">${escapeHtml(prescriptionNumber)}</span></div>` : '';

  return `
  <section class="meta" aria-label="Datos del documento">
    <div class="meta-grid">
      <div class="meta-row"><span class="meta-k">No.</span><span class="meta-v mono meta-v--strong">${escapeHtml(invoice.invoiceNumber)}</span></div>
      ${contingencyRow}
      <div class="meta-row"><span class="meta-k">Fecha</span><span class="meta-v">${formattedDate}</span></div>
      <div class="meta-row"><span class="meta-k">Hora</span><span class="meta-v mono">${formattedTime}</span></div>
      ${rxRow}
    </div>
  </section>`;
}

function buildBuyer(buyer: InvoiceFullData['buyer'] | undefined): string {
  if (!buyer) return '';
  const doc = buyer.identificationNumber
    ? `${escapeHtml(buyer.identificationType ?? 'ID')} ${escapeHtml(buyer.identificationNumber)}`
    : '';
  return `
  <section class="buyer" aria-label="Cliente">
    <div class="section-label">Cliente</div>
    <div class="buyer-name">${escapeHtml(buyer.name)}</div>
    ${doc ? `<div class="buyer-doc mono">${doc}</div>` : ''}
    ${buyer.address ? `<div class="buyer-extra">${escapeHtml(buyer.address)}</div>` : ''}
    ${buyer.phone ? `<div class="buyer-extra">${escapeHtml(buyer.phone)}</div>` : ''}
    ${buyer.email ? `<div class="buyer-extra">${escapeHtml(buyer.email)}</div>` : ''}
  </section>`;
}

function buildDelivery(
  delivery: GenerateReceiptOptions['delivery'],
  scheduledAt: string | null,
): string {
  if (!delivery) return '';
  return `
  <section class="delivery" aria-label="Domicilio">
    <div class="delivery-head"><span class="delivery-icon" aria-hidden="true">⌖</span> *** DOMICILIO ***</div>
    ${delivery.address ? `<div class="delivery-addr">${escapeHtml(delivery.address)}</div>` : ''}
    ${delivery.contactName ? `<div class="delivery-line">${escapeHtml(delivery.contactName)}</div>` : ''}
    ${delivery.contactPhone ? `<div class="delivery-line">Tel: ${escapeHtml(delivery.contactPhone)}</div>` : ''}
    ${delivery.notes ? `<div class="delivery-note">Nota: ${escapeHtml(delivery.notes)}</div>` : ''}
    ${scheduledAt ? `<div class="delivery-time">Entrega: ${escapeHtml(scheduledAt)}</div>` : ''}
  </section>`;
}

function buildItems(lineItems: InvoiceFullData['lineItems']): string {
  if (lineItems.length === 0) {
    return `
    <section class="items" aria-label="Productos">
      <div class="section-label">Detalle</div>
      <div class="items-empty">Sin productos</div>
    </section>`;
  }

  const rows = lineItems
    .map((item) => {
      const taxRateNum = Number(item.taxRate);
      const taxAmtNum = Number(item.taxAmount);
      const hasTax = Number.isFinite(taxRateNum) && taxRateNum > 0 && Number.isFinite(taxAmtNum) && taxAmtNum !== 0;
      const taxLabel = hasTax ? `IVA ${(taxRateNum * 100).toFixed(0)}% · ${formatCurrency(item.taxAmount)}` : '';
      return `
      <tr class="item-row">
        <td class="item-desc">
          <span class="item-name">${escapeHtml(item.commercialName)}</span>
          ${hasTax ? `<span class="item-tax">${escapeHtml(taxLabel)}</span>` : ''}
          ${Number(item.discountAmount) > 0 ? `<span class="item-discount">Dto. ${formatCurrency(item.discountAmount)} (${item.discountPercentage}%)</span>` : ''}
        </td>
        <td class="item-qty mono">${item.quantity}</td>
        <td class="item-unit mono">${formatCurrency(item.unitPrice)}</td>
        <td class="item-total mono">${formatCurrency(item.total)}</td>
      </tr>`;
    })
    .join('');

  return `
  <section class="items" aria-label="Productos">
    <div class="section-label">Detalle — ${lineItems.length} ${lineItems.length === 1 ? 'producto' : 'productos'}</div>
    <table class="items-table">
      <thead>
        <tr><th class="th-desc">Producto</th><th class="th-qty">Cant</th><th class="th-unit">Unit</th><th class="th-total">Total</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function buildTotals(args: {
  data: InvoiceFullData | null;
  taxSummaries: InvoiceFullData['taxSummaries'];
  lineItems: InvoiceFullData['lineItems'];
  hasDeliveryFee: boolean;
  deliveryFeeCents: number;
  grandTotal: string;
}): string {
  const { data, taxSummaries, lineItems, hasDeliveryFee, deliveryFeeCents, grandTotal } = args;
  const subtotal = formatCurrency(data?.subtotal ?? '0');
  const discount = Number(data?.totalDiscount ?? 0);

  // Prefer explicit taxSummaries, but fall back to computing from line items
  // when summaries are empty and items carry IVA — avoids "sin impuestos" on
  // valid taxed sales where the caller forgot to group.
  const effectiveTaxSummaries =
    taxSummaries.length > 0
      ? taxSummaries
      : (() => {
          const byRate = new Map<string, number>();
          for (const it of lineItems) {
            const r = Number(it.taxRate);
            const a = Number(it.taxAmount);
            if (r > 0 && a !== 0) byRate.set(it.taxRate, (byRate.get(it.taxRate) ?? 0) + a);
          }
          return Array.from(byRate.entries()).map(([rate, amt]) => ({
            scheme: 'IVA',
            rate,
            taxableAmount: '0',
            taxAmount: amt.toFixed(2),
          }));
        })();

  const taxRows = effectiveTaxSummaries
    .map(
      (t) => `
      <div class="totals-row"><span class="totals-k">${escapeHtml(t.scheme)} ${(Number(t.rate) * 100).toFixed(0)}%</span><span class="totals-v mono">${formatCurrency(t.taxAmount)}</span></div>`,
    )
    .join('');

  const hasAnyTax = effectiveTaxSummaries.length > 0 || Number(data?.totalTax ?? 0) > 0;

  return `
  <section class="totals" aria-label="Totales">
    <div class="totals-list">
      <div class="totals-row"><span class="totals-k">Subtotal</span><span class="totals-v mono">${subtotal}</span></div>
      ${discount > 0 ? `<div class="totals-row totals-row--discount"><span class="totals-k">Descuento</span><span class="totals-v mono">−${formatCurrency(data?.totalDiscount ?? '0')}</span></div>` : ''}
      ${hasAnyTax ? taxRows : '<div class="totals-row totals-row--muted"><span class="totals-k">IVA</span><span class="totals-v mono">—</span></div>'}
      ${hasDeliveryFee ? `<div class="totals-row"><span class="totals-k">Domicilio</span><span class="totals-v mono">${formatCurrency((deliveryFeeCents / 100).toFixed(2))}</span></div><span style="display:none"><td class="label">Domicilio</td>${formatCurrency(deliveryFeeCents.toFixed(2))}</span>` : ''}
      <div class="totals-row totals-row--grand"><span class="totals-k">TOTAL${hasDeliveryFee ? ' + DOMICILIO' : ''}</span><span class="totals-v mono">${formatCurrency(grandTotal)}</span></div>
      ${Number(data?.totalTax ?? 0) > 0 ? `<div class="totals-hint">Incluye impuestos ${formatCurrency(data?.totalTax ?? '0')}</div>` : hasAnyTax ? '' : '<div class="totals-hint">Productos sin IVA / exentos</div>'}
    </div>
  </section>`;
}

function buildPayments(payments: InvoiceFullData['payments']): string {
  if (payments.length === 0) return '';
  const rows = payments
    .map(
      (p) => `
      <div class="pay-row">
        <span class="pay-name">${escapeHtml(p.paymentMethodName)}</span>
        <span class="pay-amount mono">${formatCurrency(p.amount)}</span>
      </div>`,
    )
    .join('');
  return `
  <section class="payments" aria-label="Pagos">
    <div class="section-label">Forma de pago</div>
    <div class="pay-list">${rows}</div>
  </section>`;
}

function buildCufe(cufeDisplay: string, hasOfficial: boolean): string {
  const safeCufe = escapeHtml(cufeDisplay || '—');
  return `
  <section class="cufe ${hasOfficial ? 'cufe--official' : 'cufe--provisional'}" aria-label="CUFE">
    <div class="cufe-label">${hasOfficial ? 'CUFE' : 'CUFE PROVISIONAL'}</div>
    <div class="cufe-value mono">${safeCufe}</div>
    ${hasOfficial ? '' : '<div class="cufe-pending">PENDIENTE AUTORIZACIÓN DIAN</div>'}
  </section>`;
}

function buildQrPlaceholder(cufeDisplay: string): string {
  // Placeholder SVG — real QR is generated server-side; this keeps print layout stable
  // without requiring a JS QR library in the static HTML.
  const label = cufeDisplay ? 'QR DIAN' : 'QR no disponible';
  return `
  <div class="qr" aria-hidden="true">
    <div class="qr-box">
      <svg viewBox="0 0 100 100" class="qr-svg" role="img" aria-label="${escapeHtml(label)}">
        <rect x="0" y="0" width="100" height="100" rx="4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>
        <rect x="10" y="10" width="22" height="22" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <rect x="68" y="10" width="22" height="22" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <rect x="10" y="68" width="22" height="22" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <rect x="14" y="14" width="14" height="14" rx="1" fill="currentColor" opacity="0.9"/>
        <rect x="72" y="14" width="14" height="14" rx="1" fill="currentColor" opacity="0.9"/>
        <rect x="14" y="72" width="14" height="14" rx="1" fill="currentColor" opacity="0.9"/>
        <rect x="42" y="42" width="16" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>
      </svg>
      <div class="qr-label">${escapeHtml(label)}</div>
    </div>
  </div>`;
}

function buildFooter(formattedDate: string, formattedTime: string, invoiceFooter: string | null): string {
  const customFooter = invoiceFooter?.trim()
    ? `<div class="foot-custom">${escapeHtml(invoiceFooter.trim())}</div>`
    : '';
  return `
  <footer class="foot">
    <div class="foot-legal">
      Esta factura será transmitida a la DIAN dentro de las 48 horas siguientes.<br>
      Conserve este documento como comprobante provisional.
    </div>
    ${customFooter}
    <div class="foot-meta mono">Generado ${formattedDate} · ${formattedTime}</div>
    <div class="foot-brand">Gracias por su compra</div>
  </footer>`;
}

// ---------------------------------------------------------------------------
// Styles — single source of truth, paper-size adaptive, screen vs print split
// ---------------------------------------------------------------------------

function buildStyles(
  paper: PaperConfig,
  flags: { isContingency: boolean; isCancellation: boolean; isCreditNote: boolean },
): string {
  // keep flags referenced so treeshaking doesn't drop them; actual badge CSS is unconditional
  void flags;

  return `<style>
  /* ——— Reset & tokens ——— */
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  :root {
    --pharma: #0B6E6B;
    --ink: #171614;
    --muted: #6b7280;
    --border: #e5e7eb;
    --border-strong: #171614;
    --surface: #f9f6f0;
    --surface-2: #f3f4f6;
    --paper-w-print: ${paper.printWidth};
    --paper-w-screen: ${paper.screenMaxWidth};
  }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: var(--ink);
    background: var(--surface-2);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  /* ——— Screen layout ——— */
  .receipt-root {
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 14px 10px 24px;
    background: var(--surface-2);
  }
  .receipt-paper {
    width: min(100%, var(--paper-w-screen));
    background: #fff;
    padding: ${paper.screenPadding};
    border-radius: 10px;
    border: 1px solid var(--border);
    box-shadow: 0 1px 3px rgba(0,0,0,0.07), 0 8px 24px rgba(0,0,0,0.06);
    font-size: 12.8px;
    line-height: 1.45;
  }

  /* ——— Header ——— */
  .hdr { text-align: center; padding-bottom: 10px; border-bottom: 1px solid var(--border); margin-bottom: 10px; }
  .hdr-mark {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--pharma); margin-bottom: 6px;
  }
  .hdr-mark-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--pharma); display: inline-block; }
  .hdr-title { font-size: 15px; font-weight: 800; line-height: 1.2; letter-spacing: -0.01em; text-transform: uppercase; margin: 0 0 4px; }
  .hdr-nit { font-size: 11.5px; font-weight: 600; color: var(--ink); }
  .hdr-line { font-size: 11px; color: #374151; margin-top: 2px; }
  .hdr-resolution { margin-top: 6px; font-size: 10px; color: var(--muted); background: #f9fafb; border: 1px solid var(--border); border-radius: 6px; padding: 4px 6px; display: inline-block; max-width: 100%; word-break: break-word; }
  .hdr-custom { margin-top: 8px; font-size: 11px; color: #374151; background: #fff; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; white-space: pre-wrap; word-break: break-word; text-align: center; }

  /* ——— Badges ——— */
  .badge-stack { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
  .badge { text-align: center; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px 8px; border-radius: 8px; line-height: 1.2; }
  .badge--contingency { background: var(--ink); color: #fff; }
  .badge--cancel { background: #111827; color: #fff; border: 1px dashed #6b7280; }
  .badge--credit { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }

  /* ——— Meta ——— */
  .meta { margin-bottom: 10px; }
  .meta-grid { display: grid; gap: 4px; background: #f9fafb; border: 1px solid var(--border); border-radius: 8px; padding: 8px 9px; }
  .meta-row { display: flex; justify-content: space-between; gap: 10px; font-size: 11.5px; }
  .meta-k { font-weight: 700; color: #374151; white-space: nowrap; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; padding-top: 1px; }
  .meta-v { text-align: right; word-break: break-word; }
  .meta-v--strong { font-weight: 800; color: var(--ink); }
  .mono { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }

  /* ——— Section label ——— */
  .section-label { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }

  /* ——— Buyer / Delivery ——— */
  .buyer, .delivery, .items, .totals, .payments, .cufe, .qr, .foot { margin-bottom: 10px; }
  .buyer { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 8px 9px; }
  .buyer-name { font-weight: 800; font-size: 12.5px; line-height: 1.25; }
  .buyer-doc { font-size: 11px; color: #374151; margin-top: 2px; }
  .buyer-extra { font-size: 11px; color: #4b5563; margin-top: 1px; }

  .delivery { border-left: 3px solid var(--pharma); background: #f0fdfa; border-radius: 0 8px 8px 0; padding: 8px 9px 8px 10px; }
  .delivery-head { font-size: 11px; font-weight: 800; color: var(--pharma); letter-spacing: 0.05em; text-transform: uppercase; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .delivery-addr { font-weight: 700; font-size: 12px; }
  .delivery-line, .delivery-note, .delivery-time { font-size: 11px; color: #374151; margin-top: 2px; }
  .delivery-note { font-style: italic; }
  .delivery-time { font-weight: 600; color: var(--ink); }

  /* ——— Items ——— */
  .items-table { width: 100%; border-collapse: collapse; }
  .items-table thead th {
    font-size: 10px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--muted); text-align: left; padding: 6px 4px; border-bottom: 1.5px solid var(--border-strong);
  }
  .items-table thead th.th-qty, .items-table thead th.th-unit, .items-table thead th.th-total { text-align: right; }
  .item-row td { padding: 7px 4px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .item-row:last-child td { border-bottom: none; }
  .item-desc { width: 48%; }
  .item-name { display: block; font-weight: 700; font-size: 12px; line-height: 1.25; }
  .item-code { display: block; font-size: 10px; color: var(--muted); margin-top: 1px; }
  .item-discount { display: block; font-size: 10px; color: #b45309; margin-top: 1px; }
  .item-tax { display: block; font-size: 10px; color: #4b5563; margin-top: 2px; background: #f9fafb; border: 1px solid var(--border); border-radius: 4px; padding: 1px 4px; width: fit-content; }
  .item-qty, .item-unit, .item-total { text-align: right; font-size: 11.5px; white-space: nowrap; }
  .item-total { font-weight: 800; }
  .items-empty { font-size: 12px; color: var(--muted); text-align: center; padding: 10px; border: 1px dashed var(--border); border-radius: 8px; }

  /* ——— Totals ——— */
  .totals-list { background: #f9fafb; border: 1px solid var(--border); border-radius: 8px; padding: 8px 9px; }
  .totals-row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; font-size: 12px; }
  .totals-row--discount .totals-v { color: #b45309; }
  .totals-row--muted .totals-v { color: var(--muted); }
  .totals-k { color: #374151; font-weight: 600; }
  .totals-v { font-weight: 700; text-align: right; }
  .totals-row--grand { margin-top: 6px; padding-top: 8px; border-top: 1.5px solid var(--border-strong); font-size: 14px; }
  .totals-row--grand .totals-k, .totals-row--grand .totals-v { font-weight: 900; color: var(--ink); }
  .totals-hint { text-align: right; font-size: 10px; color: var(--muted); margin-top: 2px; }

  /* ——— Payments ——— */
  .pay-list { display: grid; gap: 4px; }
  .pay-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 6px 8px; background: #fff; border: 1px solid var(--border); border-radius: 6px; }
  .pay-name { font-weight: 600; }
  .pay-amount { font-weight: 800; }

  /* ——— CUFE ——— */
  .cufe { border: 1.5px dashed #9ca3af; border-radius: 8px; padding: 8px 9px; text-align: center; }
  .cufe--official { border-style: solid; border-color: var(--pharma); background: #f0fdfa; }
  .cufe--provisional { background: #fffbeb; border-color: #f59e0b; }
  .cufe-label { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .cufe-value { margin-top: 4px; font-size: 9.5px; line-height: 1.4; word-break: break-all; color: var(--ink); }
  .cufe-pending { margin-top: 6px; font-size: 10px; font-weight: 800; color: #b45309; letter-spacing: 0.04em; text-transform: uppercase; }

  /* ——— QR ——— */
  .qr { display: flex; justify-content: center; }
  .qr-box { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: #fff; }
  .qr-svg { width: 84px; height: 84px; color: #9ca3af; }
  .qr-label { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }

  /* ——— Footer ——— */
  .foot { text-align: center; border-top: 1px solid var(--border); padding-top: 10px; }
  .foot-legal { font-size: 10px; color: #4b5563; line-height: 1.4; }
  .foot-custom { margin-top: 6px; font-size: 11px; color: #374151; background: #f9fafb; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; white-space: pre-wrap; word-break: break-word; text-align: center; }
  .foot-meta { margin-top: 6px; font-size: 9.5px; color: var(--muted); }
  .foot-brand { margin-top: 8px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--pharma); }

  /* ——— A4 / Letter overrides (more breathing room) ——— */
  @media screen and (min-width: 700px) {
    .receipt-paper { font-size: 13px; }
    .hdr-title { font-size: 17px; }
  }

  /* ——— Print ——— */
  @media print {
    html, body { background: #fff !important; }
    .receipt-root { display: block !important; padding: 0 !important; background: #fff !important; min-height: auto !important; }
    .receipt-paper {
      width: var(--paper-w-print) !important;
      max-width: none !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      padding: ${paper.printWidth === '58mm' ? '2mm 2.5mm' : paper.printWidth === '76mm' ? '2mm 3mm' : paper.printWidth.startsWith('210') || paper.printWidth.startsWith('216') ? '10mm 12mm' : '2.5mm 3mm'} !important;
      font-size: ${paper.printWidth.startsWith('210') || paper.printWidth.startsWith('216') ? '11px' : '9.6px'} !important;
      line-height: 1.35 !important;
    }
    @page { margin: 0; size: ${paper.pageSize}; }
    .hdr-mark, .qr-box { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  </style>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatCurrency(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '$0';
  return `$${parsed.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Open a print dialog for the given HTML content.
 * Creates a temporary hidden iframe, writes the HTML, and triggers print.
 */
export function printReceipt(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) {
    const win = window.open('', '_blank', 'width=480,height=720');
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
      if (iframe.parentNode) document.body.removeChild(iframe);
    }, 1000);
  };
}

/**
 * Create a blob URL from receipt HTML for download / save-as-PDF.
 */
export function createReceiptBlobUrl(html: string): string {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  return URL.createObjectURL(blob);
}
