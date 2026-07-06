import * as crypto from 'crypto';

/**
 * Computes the CUFE (CÃ³digo Ãnico de FacturaciÃ³n ElectrÃ³nica) for a fiscal
 * document using SHA-384. The exact concatenation formula must be verified
 * against the current DIAN technical annex.
 *
 * // VERIFY AGAINST CURRENT DIAN TECHNICAL ANNEX:
 * // The input string concatenation order, field selection, and separator
 * // characters are DIAN-versioned details. This baseline uses the fields
 * // known to be part of the CUFE formula as of Resolution 000042 of 2020
 * // with SHA-384, but any regulatory update may add, remove or reorder them.
 */
export class CufeCalculator {
  /**
   * Builds the pre-hash concatenated string and returns its SHA-384 hex digest.
   * Marked for verification: field order and separator must match the annex.
   */
  computeCufe(params: {
    documentType: string;
    fullNumber: string;
    issueDate: string;
    issuerNit: string;
    issuerVerificationDigit: string;
    subtotal: string;
    totalTax: string;
    totalAmount: string;
    softwareId: string;
  }): string {
    // VERIFY AGAINST CURRENT DIAN TECHNICAL ANNEX:
    // The concatenation template below is structured per the general DIAN
    // CUFE formula pattern but must be checked field-by-field.
    const cufeInput = [
      params.documentType === 'INVOICE' ? '01' : '02',
      params.fullNumber,
      params.issueDate,
      params.issuerNit + params.issuerVerificationDigit,
      params.softwareId,
      this.formatDecimal(params.subtotal),
      this.formatDecimal(params.totalTax),
      this.formatDecimal(params.totalAmount),
      'CUFE-SHA384',
    ].join('');

    return crypto.createHash('sha384').update(cufeInput).digest('hex');
  }

  /** Formats a decimal string to DIAN's required numeric format. */
  private formatDecimal(value: string): string {
    // Remove leading zeros and ensure numeric format
    const num = parseFloat(value);
    return isNaN(num) ? '0.00' : num.toFixed(2);
  }
}