import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import * as forge from 'node-forge';
import { CertificateData } from './certificate.loader';
import {
  NS_XMLDSIG,
  NS_XADES,
  ALGO_C14N,
  ALGO_ENVELOPED_SIG,
  ALGO_RSA_SHA256,
  ALGO_SHA256,
  SIGNATURE_POLICY_URL,
  SIGNATURE_POLICY_HASH_BASE64,
} from './dian-constants';

/**
 * Applies a XAdES-EPES signature to an unsigned UBL 2.1 invoice XML.
 *
 * The unsigned XML must already contain an empty <ds:Signature> placeholder
 * inside the second <ext:UBLExtension>/<ext:ExtensionContent> element.
 * This signer replaces that placeholder with the full XAdES-EPES signature
 * including KeyInfo (with X.509 certificate) and QualifyingProperties
 * (SigningTime, SigningCertificate, SignaturePolicyIdentifier).
 *
 * The signing algorithm is RSA-SHA256 with XML canonicalisation C14N 1.0
 * (not exclusive C14N), per the DIAN technical annex requirements.
 *
 * NOTE: This class uses @xmldom/xmldom types internally. DOM nodes are
 * typed as `any` to avoid type conflicts between @xmldom/xmldom's custom
 * DOM implementation and lib.dom.d.ts. This is safe because all DOM
 * operations are confined to this class — the public API is string in,
 * string out.
 */
export class XadesSigner {
  /**
   * Signs the given unsigned UBL XML with XAdES-EPES.
   *
   * @param unsignedXml    The UBL 2.1 invoice XML string (without the
   *                       digital signature filled in).
   * @param certData       Parsed PKCS#12 data (private key PEM + certificate).
   * @returns              The XML string with the XAdES-EPES signature
   *                       embedded in the second ext:UBLExtension.
   */
  sign(unsignedXml: string, certData: CertificateData): string {
    const parser = new DOMParser();
    const unsignedDoc: any = parser.parseFromString(unsignedXml, 'text/xml');

    // ── Step 1: xml-crypto computes the enveloped signature ──
    const sig = new SignedXml();
    sig.signatureAlgorithm = ALGO_RSA_SHA256;
    sig.canonicalizationAlgorithm = ALGO_C14N;
    sig.privateKey = certData.privateKeyPem;

    sig.addReference({
      xpath: '/*',
      digestAlgorithm: ALGO_SHA256,
      transforms: [ALGO_ENVELOPED_SIG, ALGO_C14N],
    });

    const preSignedXml = new XMLSerializer().serializeToString(unsignedDoc);
    sig.computeSignature(preSignedXml, {
      prefix: 'ds',
      location: {
        reference: "(//*[local-name()='ExtensionContent'])[2]",
        action: 'append',
      },
    });

    // ── Step 2: Parse the signed result and locate the signature node ──
    const signedDoc: any = parser.parseFromString(sig.getSignedXml(), 'text/xml');

    // Find the ds:Signature element appended by xml-crypto
    const sigs = signedDoc.getElementsByTagNameNS(NS_XMLDSIG, 'Signature');
    const signatureNode: any = sigs.item(sigs.length - 1);
    if (!signatureNode) {
      throw new Error('xml-crypto did not produce a ds:Signature element');
    }

    // ── Step 3: Inject <ds:KeyInfo> with the X.509 certificate ──
    this.injectKeyInfo(signatureNode, certData.x509CertificateBase64);

    // ── Step 4: Inject XAdES <ds:Object> with QualifyingProperties ──
    this.injectXadesObject(signatureNode, certData.publicKeyPem);

    // ── Step 5: Remove the empty placeholder signature if it still exists ──
    this.removePlaceholderSignatures(signedDoc, signatureNode);

    return new XMLSerializer().serializeToString(signedDoc);
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Builds and appends:
   *   <ds:KeyInfo>
   *     <ds:X509Data>
   *       <ds:X509Certificate>base64</ds:X509Certificate>
   *     </ds:X509Data>
   *   </ds:KeyInfo>
   */
  private injectKeyInfo(signatureNode: any, x509Base64: string): void {
    const doc = signatureNode.ownerDocument;
    const keyInfo = doc.createElementNS(NS_XMLDSIG, 'ds:KeyInfo');
    const x509Data = doc.createElementNS(NS_XMLDSIG, 'ds:X509Data');
    const x509Cert = doc.createElementNS(NS_XMLDSIG, 'ds:X509Certificate');

    x509Cert.textContent = x509Base64;
    x509Data.appendChild(x509Cert);
    keyInfo.appendChild(x509Data);
    signatureNode.appendChild(keyInfo);
  }

  /**
   * Builds and appends the XAdES <ds:Object> element with:
   *   <xades:QualifyingProperties>
   *     <xades:SignedProperties>
   *       <xades:SignedSignatureProperties>
   *         <xades:SigningTime/>
   *         <xades:SigningCertificate/>
   *         <xades:SignaturePolicyIdentifier>
   *           <xades:SignaturePolicyId>...
   */
  private injectXadesObject(signatureNode: any, certPem: string): void {
    const doc: any = signatureNode.ownerDocument;

    // Determine the signature's own Id — xml-crypto generates one.
    const signatureId =
      signatureNode.getAttribute('Id') ||
      `xmldsig-${this.generateShortId()}`;

    // Parse the certificate to extract issuer name and serial number.
    const forgeCert = forge.pki.certificateFromPem(certPem);
    const issuerName = this.formatIssuerName(forgeCert.issuer.attributes);
    const serialNumber = forgeCert.serialNumber as string;

    // Compute the certificate digest (SHA-256 of the public key fingerprint).
    const sha256 = forge.md.sha256.create();
    const certDigest = forge.util.encode64(
      forge.pki.getPublicKeyFingerprint(forgeCert.publicKey, {
        md: sha256,
        encoding: 'binary',
      }),
    );

    const signedPropsId = `xmldsig-signedprops-${this.generateShortId()}`;
    const signingTime = new Date().toISOString();

    // ── Build the XAdES XML tree using DOM APIs ──
    const objectEl = doc.createElementNS(NS_XMLDSIG, 'ds:Object');
    const qualifyingProps = doc.createElementNS(NS_XADES, 'xades:QualifyingProperties');
    qualifyingProps.setAttribute('Target', `#${signatureId}`);

    const signedProps = doc.createElementNS(NS_XADES, 'xades:SignedProperties');
    signedProps.setAttribute('Id', signedPropsId);

    const signedSigProps = doc.createElementNS(NS_XADES, 'xades:SignedSignatureProperties');

    // SigningTime
    const signingTimeEl = doc.createElementNS(NS_XADES, 'xades:SigningTime');
    signingTimeEl.textContent = signingTime;
    signedSigProps.appendChild(signingTimeEl);

    // SigningCertificate
    const signingCertEl = doc.createElementNS(NS_XADES, 'xades:SigningCertificate');
    const certEl = doc.createElementNS(NS_XADES, 'xades:Cert');

    const certDigestEl = doc.createElementNS(NS_XADES, 'xades:CertDigest');
    const digestMethod = doc.createElementNS(NS_XMLDSIG, 'ds:DigestMethod');
    digestMethod.setAttribute('Algorithm', ALGO_SHA256);
    certDigestEl.appendChild(digestMethod);
    const digestValue = doc.createElementNS(NS_XMLDSIG, 'ds:DigestValue');
    digestValue.textContent = certDigest;
    certDigestEl.appendChild(digestValue);
    certEl.appendChild(certDigestEl);

    const issuerSerialEl = doc.createElementNS(NS_XADES, 'xades:IssuerSerial');
    const x509IssuerName = doc.createElementNS(NS_XMLDSIG, 'ds:X509IssuerName');
    x509IssuerName.textContent = issuerName;
    issuerSerialEl.appendChild(x509IssuerName);
    const x509SerialNumber = doc.createElementNS(NS_XMLDSIG, 'ds:X509SerialNumber');
    x509SerialNumber.textContent = serialNumber;
    issuerSerialEl.appendChild(x509SerialNumber);
    certEl.appendChild(issuerSerialEl);

    signingCertEl.appendChild(certEl);
    signedSigProps.appendChild(signingCertEl);

    // SignaturePolicyIdentifier
    const policyIdEl = doc.createElementNS(NS_XADES, 'xades:SignaturePolicyIdentifier');
    const sigPolicyIdEl = doc.createElementNS(NS_XADES, 'xades:SignaturePolicyId');

    const sigPolicyIdInner = doc.createElementNS(NS_XADES, 'xades:SigPolicyId');
    const identifierEl = doc.createElementNS(NS_XADES, 'xades:Identifier');
    identifierEl.textContent = SIGNATURE_POLICY_URL;
    sigPolicyIdInner.appendChild(identifierEl);
    sigPolicyIdEl.appendChild(sigPolicyIdInner);

    const sigPolicyHashEl = doc.createElementNS(NS_XADES, 'xades:SigPolicyHash');
    const policyDigestMethod = doc.createElementNS(NS_XMLDSIG, 'ds:DigestMethod');
    policyDigestMethod.setAttribute('Algorithm', ALGO_SHA256);
    sigPolicyHashEl.appendChild(policyDigestMethod);
    const policyDigestValue = doc.createElementNS(NS_XMLDSIG, 'ds:DigestValue');
    policyDigestValue.textContent = SIGNATURE_POLICY_HASH_BASE64;
    sigPolicyHashEl.appendChild(policyDigestValue);
    sigPolicyIdEl.appendChild(sigPolicyHashEl);

    policyIdEl.appendChild(sigPolicyIdEl);
    signedSigProps.appendChild(policyIdEl);

    signedProps.appendChild(signedSigProps);
    qualifyingProps.appendChild(signedProps);
    objectEl.appendChild(qualifyingProps);
    signatureNode.appendChild(objectEl);
  }

  /**
   * Formats an X.509 issuer name in the RFC 2253 format expected by
   * ds:X509IssuerName, e.g. "CN=..., O=..., C=CO".
   */
  private formatIssuerName(
    attributes: forge.pki.CertificateField[],
  ): string {
    const nameMap: Record<string, string> = {
      C: 'C',
      O: 'O',
      OU: 'OU',
      CN: 'CN',
      ST: 'ST',
      L: 'L',
      STREET: 'STREET',
      DC: 'DC',
      UID: 'UID',
    };
    return [...attributes]
      .reverse()
      .map((attr) => {
        const shortName = attr.shortName ?? 'UNKNOWN';
        const key = nameMap[shortName] ?? shortName;
        return `${key}=${attr.value}`;
      })
      .join(', ');
  }

  /**
   * Removes any empty placeholder <ds:Signature> elements, keeping only
   * the real signature that was injected by xml-crypto and augmented by
   * injectKeyInfo / injectXadesObject.
   */
  private removePlaceholderSignatures(doc: any, realSignatureNode: any): void {
    const allSigs = doc.getElementsByTagNameNS(NS_XMLDSIG, 'Signature');
    // Work backwards so index changes don't shift positions
    for (let i = allSigs.length - 1; i >= 0; i--) {
      const candidate: any = allSigs.item(i);
      if (candidate !== realSignatureNode) {
        candidate.parentNode?.removeChild(candidate);
      }
    }
  }

  private generateShortId(): string {
    return Math.random().toString(36).substring(2, 11);
  }
}
