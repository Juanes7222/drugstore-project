import * as crypto from 'node:crypto';

/**
 * Computes the CUFE (Código Único de Facturación Electrónica) per DIAN
 * Technical Annex v1.9 (Resolución 000165 de 2023), section 11.2.
 *
 * Formula (concatenation without separators):
 *   CUFE = SHA-384(
 *     NumFac + FecFac + HorFac + ValFac +
 *     "01" + ValImp1 + "04" + ValImp2 + "03" + ValImp3 +
 *     ValTot + NitOFE + NumAdq + ClTec + TipoAmbiente
 *   )
 *
 * All monetary values: decimal point, truncated (never rounded) to two
 * decimals, no thousands separator. NIT values without check digit.
 * Tax codes are concatenated in the fixed order 01 (IVA), 04 (INC),
 * 03 (ICA) regardless of which ones the document actually has — an
 * absent tax still contributes its literal code plus "0.00".
 */
export class CufeCalculator {
  /**
   * Computes the SHA-384 hex digest that is the CUFE.
   *
   * @param params.fullNumber   NumFac — the full document number (prefix + consecutive).
   * @param params.issueDate    FecFac — date in YYYY-MM-DD format.
   * @param params.issueTime    HorFac — time with GMT offset in HH:mm:ss±HH:mm format.
   * @param params.subtotal     ValFac — line extension amount (before tax).
   * @param params.taxAmounts   Tax breakdowns — array of { code, amount } in any order;
   *                            codes 01, 04, 03 are extracted and concatenated in that order.
   * @param params.totalAmount  ValTot — payable amount.
   * @param params.issuerNit    NitOFE — issuer NIT without check digit, without formatting.
   * @param params.customerId   NumAdq — acquirer PartyTaxScheme/CompanyID without check digit.
   * @param params.clTec        ClTec — technical key from GetNumberingRange WS.
   * @param params.environment  TipoAmbiente — "1" for production, "2" for habilitación.
   */
  computeCufe(params: {
    fullNumber: string;
    issueDate: string;
    issueTime: string;
    subtotal: string;
    taxAmounts: { code: string; amount: string }[];
    totalAmount: string;
    issuerNit: string;
    customerId: string;
    clTec: string;
    environment: string;
  }): string {
    // ── Build a lookup map for tax amounts ──
    const taxMap = new Map<string, string>();
    for (const t of params.taxAmounts) {
      taxMap.set(t.code, t.amount);
    }

    // ── Format each monetary value (truncate, never round) ──
    const valFac = this.truncateDecimal(params.subtotal);
    const tax01Amount = this.truncateDecimal(taxMap.get('01') ?? '0');
    const tax04Amount = this.truncateDecimal(taxMap.get('04') ?? '0');
    const tax03Amount = this.truncateDecimal(taxMap.get('03') ?? '0');
    const valTot = this.truncateDecimal(params.totalAmount);

    // ── Concatenation: no separators, fixed tax order 01 → 04 → 03 ──
    const input =
      params.fullNumber +
      params.issueDate +
      params.issueTime +
      valFac +
      '01' + tax01Amount +
      '04' + tax04Amount +
      '03' + tax03Amount +
      valTot +
      params.issuerNit +
      params.customerId +
      params.clTec +
      params.environment;

    return crypto.createHash('sha384').update(input).digest('hex');
  }

  /**
   * Formats a numeric string to two decimal places by truncation (never
   * rounding). Examples:
   *   "1500000.999" → "1500000.99"
   *   "1500000"     → "1500000.00"
   *   "0"           → "0.00"
   *   "285000.00"   → "285000.00"
   */
  private truncateDecimal(value: string): string {
    // Normalise: ensure there is a decimal point
    const normalised = value.includes('.') ? value : `${value}.00`;
    const dotIndex = normalised.indexOf('.');
    const intPart = normalised.slice(0, dotIndex);
    // Take at most 2 decimal digits (truncate, never round)
    const decPart = (normalised.slice(dotIndex + 1) + '00').slice(0, 2);
    return `${intPart}.${decPart}`;
  }
}
