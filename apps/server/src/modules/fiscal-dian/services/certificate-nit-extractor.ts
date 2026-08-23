/**
 * Extracts the NIT from a DIAN certificate's subject CN or serial number.
 *
 * DIAN certificates embed the taxpayer NIT in the subject CN — either as a
 * labeled value ("NIT 900.123.456-7", "NIT9001234567") or as a bare digit
 * string with or without the verification digit ("900.123.456-7",
 * "9001234567"). Thousands separators (dots) and spaces are tolerated.
 *
 * The extraction is intentionally strict: a certificate whose identity
 * cannot be recognized is rejected at upload time so the system never
 * signs documents with a certificate that cannot be verified against the
 * tenant's configured issuer NIT.
 */
export class CertificateNitExtractor {
  /**
   * Returns the NIT digit run from the first source that yields a
   * recognizable one, or null when neither contains one. The verification
   * digit may be included depending on the certificate format; use
   * {@link matches} for comparison instead of string equality.
   */
  extract(subjectCn: string, serialNumber: string): string | null {
    for (const source of [subjectCn, serialNumber]) {
      const nit = this.extractFromSource(source);
      if (nit) {
        return nit;
      }
    }
    return null;
  }

  /**
   * True when the certificate NIT matches the issuer NIT. Handles the
   * certificate carrying the verification digit while the issuer config
   * stores the base NIT (or vice versa): exact match, or the longer string
   * starting with the shorter one with at most two extra digits.
   */
  matches(certificateNit: string, issuerNit: string): boolean {
    const certificate = certificateNit.replace(/\D/g, '');
    const issuer = issuerNit.replace(/\D/g, '');
    if (certificate === issuer) {
      return true;
    }
    const [longer, shorter] =
      certificate.length >= issuer.length ? [certificate, issuer] : [issuer, certificate];
    return longer.startsWith(shorter) && longer.length - shorter.length <= 2;
  }

  private extractFromSource(source: string): string | null {
    // Drop thousands separators and spaces, keep the DV hyphen.
    const normalized = source.replace(/[.\s]/g, '');
    const labeled = /NIT\s*(\d{6,15})(?:-\d{1,2})?/i.exec(normalized);
    if (labeled) {
      return labeled[1];
    }
    if (/^\d{6,15}(?:-\d{1,2})?$/.test(normalized)) {
      return normalized.replace(/-\d{1,2}$/, '');
    }
    return null;
  }
}