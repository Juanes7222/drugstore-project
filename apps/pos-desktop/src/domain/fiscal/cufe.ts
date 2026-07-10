/**
 * Provisional CUFE (Código Único de Facturación Electrónica) calculator.
 *
 * DIAN Resolución 000042 de 2020 defines CUFE as a SHA-384 hash over a
 * canonical concatenation of mandatory invoice fields followed by the
 * technical key. The server-side fiscal engine computes the official CUFE
 * when the document is transmitted to DIAN. This module computes the
 * *provisional* CUFE used while the terminal is offline, substituting the
 * workstation-local contingency technical key for DIAN's official key.
 *
 * The exact field order below mirrors the DIAN Anexo Técnico sequence for
 * a factura electrónica de venta:
 *
 *   1. NIT del emisor (sellerNit)
 *   2. Tipo de documento (invoiceType)
 *   3. Número de documento (invoiceNumber)
 *   4. Fecha y hora de emisión (issuedAt as ISO-8601 without separators)
 *   5. Subtotal (subtotal)
 *   6. Total impuestos (totalTax)
 *   7. Valor total (totalAmount)
 *   8. Detalle de impuestos, in order: IVA, INC, RETEFUENTE, RETEICA,
 *      IMPOCONSUMO, EXENTO (only taxes present in the document are included;
 *      missing schemes contribute an empty segment so the position is stable)
 *   9. Identificación del adquirente (buyerIdentification)
 *  10. Nombre del adquirente (buyerName)
 *  11. Clave técnica (techKey)
 *
 * Segments are joined with the pipe character "|". Decimal values are
 * written with a fixed two-digit fractional part and no thousands separator.
 * The resulting string is hashed with SHA-384 and returned as an uppercase
 * hexadecimal string.
 */

import type { CufeInvoiceData } from './fiscal-types';

const TAX_ORDER = [
  'IVA',
  'INC',
  'RETEFUENTE',
  'RETEICA',
  'IMPOCONSUMO',
  'EXENTO',
] as const;

/**
 * Calculate the provisional CUFE for the given invoice data and technical key.
 *
 * @param invoice  Canonical invoice data (must already be rounded to the
 *                 correct decimal places).
 * @param techKey  The workstation-local contingency technical key.
 */
export async function calculateProvisionalCufe(
  invoice: CufeInvoiceData,
  techKey: string,
): Promise<string> {
  const taxMap = new Map<string, string>();
  for (const tax of invoice.taxSummaries) {
    taxMap.set(tax.scheme, formatDecimal(tax.taxAmount));
  }

  const taxSegments = TAX_ORDER.map((scheme) => taxMap.get(scheme) ?? '');

  const canonical = [
    invoice.sellerNit,
    invoice.invoiceType,
    invoice.invoiceNumber,
    normalizeDateTime(invoice.issuedAt),
    formatDecimal(invoice.subtotal),
    formatDecimal(invoice.totalTax),
    formatDecimal(invoice.totalAmount),
    ...taxSegments,
    invoice.buyerIdentification,
    invoice.buyerName,
    techKey,
  ].join('|');

  const hashBuffer = await globalThis.crypto.subtle.digest(
    'SHA-384',
    new TextEncoder().encode(canonical),
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Format a numeric string as a fixed two-decimal string without thousands
 * separators. Non-numeric values fall back to "0.00".
 */
function formatDecimal(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0.00';
  return parsed.toFixed(2);
}

/**
 * Normalize an ISO-8601 datetime into a compact form: YYYYMMDDHHMMSS.
 * This matches the DIAN CUFE canonical date-time representation.
 */
function normalizeDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString.replace(/\D/g, '');

  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}
