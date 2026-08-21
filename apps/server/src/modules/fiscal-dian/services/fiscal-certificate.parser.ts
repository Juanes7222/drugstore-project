import * as forge from 'node-forge';

/**
 * Non-secret metadata extracted from a DIAN PKCS#12 bundle. The private key
 * never leaves this class — the engine's CertificateLoader performs the
 * actual signing; this server-side parser only validates the bundle and
 * extracts the fields the certificate list/expiry UI needs.
 */
export interface FiscalCertificateMetadata {
  subjectCn: string;
  issuerCn: string;
  serialNumber: string;
  validFrom: Date;
  validTo: Date;
}

/**
 * Parses a PKCS#12 (.p12 / .pfx) bundle for metadata extraction and
 * password validation. Mirrors the engine-side CertificateLoader's parse
 * behaviour (non-strict ASN.1, wrong-password detection) so a certificate
 * that uploads successfully here is guaranteed to sign successfully there.
 */
export class FiscalCertificateParser {
  parseMetadata(
    p12Buffer: Buffer,
    password: string,
  ): FiscalCertificateMetadata {
    let p12: forge.pkcs12.Pkcs12Pfx;

    try {
      const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
      // Non-strict parsing resolves ASN.1 quirks of common Colombian CAs.
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.toLowerCase().includes('mac check failed') ||
        message.includes('PKCS#12 MAC could not be verified')
      ) {
        throw new Error('Certificate password is incorrect', { cause: error });
      }
      throw new Error(`Failed to parse PKCS#12 bundle: ${message}`, {
        cause: error,
      });
    }

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certList = certBags[forge.pki.oids.certBag] ?? [];

    if (certList.length === 0) {
      throw new Error('PKCS#12 bundle contains no certificate bags');
    }

    const cert = certList[0].cert as forge.pki.Certificate | null;
    if (!cert) {
      throw new Error('PKCS#12 bundle contains no usable certificate');
    }

    const subjectCn = this.readCommonName(cert.subject);
    const issuerCn = this.readCommonName(cert.issuer);

    if (!subjectCn || !issuerCn) {
      throw new Error('Certificate is missing a CN in its subject or issuer');
    }

    return {
      subjectCn,
      issuerCn,
      serialNumber: cert.serialNumber,
      validFrom: cert.validity.notBefore,
      validTo: cert.validity.notAfter,
    };
  }

  private readCommonName(attributes: {
    attributes: forge.pki.CertificateField[];
  }): string {
    const cn = attributes.attributes.find((attr) => attr.name === 'commonName');
    return cn ? String(cn.value) : '';
  }
}
