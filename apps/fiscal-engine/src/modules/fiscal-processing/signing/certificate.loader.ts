import * as forge from 'node-forge';

/**
 * Parsed PKCS#12 certificate data, ready for XAdES signing and SOAP
 * WS-Security.
 *
 * All three fields are derived from a single .p12 / .pfx file.
 */
export interface CertificateData {
  /** Private key serialised to PEM (used by xml-crypto for signing). */
  privateKeyPem: string;

  /** Full certificate chain as PEM (used for XAdES issuer/serial). */
  publicKeyPem: string;

  /** X.509 certificate in base64 DER (no PEM headers, no whitespace). */
  x509CertificateBase64: string;
}

/**
 * Loads and parses a PKCS#12 (.p12 / .pfx) certificate bundle.
 *
 * Extracts the first matching private-key / certificate pair whose public
 * key modulus matches the private key's modulus. This avoids ambiguity
 * when a .p12 contains multiple keys or certificates.
 *
 * Throws on any failure — malformed input, wrong password, missing keys.
 */
export class CertificateLoader {
  /**
   * Parses a PKCS#12 buffer in memory.
   *
   * @param p12Buffer  Raw bytes of the .p12 / .pfx file.
   * @param password   Private-key password.
   */
  async loadFromBuffer(p12Buffer: Buffer, password: string): Promise<CertificateData> {
    let p12: forge.pkcs12.Pkcs12Pfx;

    try {
      const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
      // Second argument `false` enables non-strict parsing, which resolves
      // some ASN.1 parse errors produced by common Colombian certificate
      // authorities.
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('mac check failed')) {
        throw new Error(`Certificate password is incorrect: ${message}`);
      }
      throw new Error(`Failed to parse PKCS#12 bundle: ${message}`);
    }

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });

    const certList = certBags[forge.pki.oids.certBag] ?? [];
    const keyList = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];

    if (certList.length === 0) {
      throw new Error('PKCS#12 bundle contains no certificate bags');
    }
    if (keyList.length === 0) {
      throw new Error('PKCS#12 bundle contains no private key bags');
    }

    // Find the first matching key–certificate pair by comparing the RSA
    // modulus (n) of each key with the public key modulus of each cert.
    let matchedKey: forge.pki.PrivateKey | null = null;
    let matchedCert: forge.pki.Certificate | null = null;

    for (const certBag of certList) {
      const candidateCert = certBag.cert as forge.pki.Certificate;
      if (!candidateCert) continue;

      for (const keyBag of keyList) {
        const candidateKey = keyBag.key as forge.pki.PrivateKey | null;
        if (!candidateKey) continue;

        // `n` is forge's BigInteger for the RSA modulus — compare equality
        if ((candidateCert.publicKey as any).n?.equals((candidateKey as any).n)) {
          matchedKey = candidateKey;
          matchedCert = candidateCert;
          break;
        }
      }
      if (matchedKey && matchedCert) break;
    }

    if (!matchedKey || !matchedCert) {
      throw new Error(
        'No matching private-key / certificate pair found in the PKCS#12 bundle. ' +
        'The file may contain keys and certificates from different issuers.',
      );
    }

    const privateKeyPem = forge.pki.privateKeyToPem(matchedKey);
    const publicKeyPem = forge.pki.certificateToPem(matchedCert);
    const x509CertificateBase64 = publicKeyPem
      .replace(/-{5}(BEGIN|END)\s+CERTIFICATE-{5}/g, '')
      .replace(/\s/g, '');

    return { privateKeyPem, publicKeyPem, x509CertificateBase64 };
  }
}
