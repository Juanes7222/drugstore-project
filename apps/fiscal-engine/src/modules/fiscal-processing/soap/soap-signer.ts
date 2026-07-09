import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { ExclusiveCanonicalization } from 'xml-crypto';
import * as crypto from 'node:crypto';
import { CertificateData } from '../signing/certificate.loader';
import {
  NS_SOAP_ENVELOPE,
  NS_DIAN_COLOMBIA,
  NS_XMLDSIG,
  NS_WSSEC,
  NS_WSSEC_UTILITY,
  NS_WSA,
  ALGO_EXC_C14N,
  ALGO_RSA_SHA256,
  ALGO_SHA256,
  TOKEN_X509V3,
  TOKEN_BASE64_BINARY,
} from '../signing/dian-constants';

/**
 * Applies WS-Security X.509 signing to a SOAP envelope for DIAN's WCF
 * service.
 *
 * The signer:
 *   1. Removes any existing soap:Header and rebuilds it from scratch.
 *   2. Adds WS-Addressing headers (Action, To with wsu:Id).
 *   3. Adds a wsu:Timestamp with Created and Expires.
 *   4. Adds a wsse:BinarySecurityToken containing the base64 X.509
 *      certificate.
 *   5. Computes an XMLDSig signature over the wsa:To element using
 *      exclusive canonicalisation (as required by DIAN's WCF stack).
 *   6. Adds ds:KeyInfo referencing the BinarySecurityToken.
 *
 * The SOAP Body is not signed — DIAN validates the UBL document's own
 * XAdES-EPES signature instead.
 *
 * NOTE: This class uses @xmldom/xmldom types internally. DOM nodes are
 * typed as `any` to avoid type conflicts between @xmldom/xmldom's custom
 * DOM implementation and lib.dom.d.ts.
 */
export class SoapSigner {
  /**
   * Signs an unsigned SOAP envelope string.
   *
   * @param unsignedSoap   The SOAP envelope XML (soap:Envelope with
   *                       soap:Body populated, soap:Header may be empty).
   * @param certData       Parsed PKCS#12 data.
   * @param action         WS-Addressing action URI (SOAP action).
   * @param toValue        WS-Addressing destination (DIAN endpoint URL).
   * @returns              The SOAP envelope with WS-Security applied.
   */
  sign(
    unsignedSoap: string,
    certData: CertificateData,
    action: string,
    toValue: string,
  ): string {
    const parser = new DOMParser();
    const serializer = new XMLSerializer();
    const doc: any = parser.parseFromString(unsignedSoap, 'text/xml');
    const envelope: any = doc.documentElement;

    if (!envelope) {
      throw new Error('Invalid SOAP envelope — root element not found');
    }

    // Remove any existing Header — we rebuild it entirely.
    this.removeExistingHeader(doc);

    // Generate unique IDs for this signing session.
    const ids = this.generateIds();

    // ── Build the Header ──
    const header = doc.createElement('soap:Header');
    envelope.insertBefore(header, envelope.firstChild);

    // WS-Addressing headers
    const wsaAction = doc.createElementNS(NS_WSA, 'wsa:Action');
    wsaAction.textContent = action;
    header.appendChild(wsaAction);

    const wsaTo = doc.createElementNS(NS_WSA, 'wsa:To');
    wsaTo.setAttributeNS(NS_WSSEC_UTILITY, 'wsu:Id', ids.wsuToId);
    wsaTo.textContent = toValue;
    header.appendChild(wsaTo);

    // Security header
    const security = doc.createElementNS(NS_WSSEC, 'wsse:Security');
    security.setAttribute('soap:mustUnderstand', 'true');
    header.appendChild(security);

    // WSU Timestamp
    const now = Math.floor(Date.now() / 1000);
    const timestamp = doc.createElementNS(NS_WSSEC_UTILITY, 'wsu:Timestamp');
    timestamp.setAttributeNS(NS_WSSEC_UTILITY, 'wsu:Id', ids.timestampId);
    security.appendChild(timestamp);

    const created = doc.createElementNS(NS_WSSEC_UTILITY, 'wsu:Created');
    created.textContent = new Date(now * 1000).toISOString();
    timestamp.appendChild(created);

    const expires = doc.createElementNS(NS_WSSEC_UTILITY, 'wsu:Expires');
    expires.textContent = new Date((now + 300) * 1000).toISOString();
    timestamp.appendChild(expires);

    // BinarySecurityToken (X.509 certificate)
    const token = doc.createElementNS(NS_WSSEC, 'wsse:BinarySecurityToken');
    token.setAttribute('EncodingType', TOKEN_BASE64_BINARY);
    token.setAttribute('ValueType', TOKEN_X509V3);
    token.setAttributeNS(NS_WSSEC_UTILITY, 'wsu:Id', ids.tokenId);
    token.textContent = certData.x509CertificateBase64;
    security.appendChild(token);

    // ── Build the XMLDSig signature ──
    const sig = doc.createElementNS(NS_XMLDSIG, 'ds:Signature');
    sig.setAttribute('Id', ids.signatureId);
    security.appendChild(sig);

    const signedInfo = doc.createElementNS(NS_XMLDSIG, 'ds:SignedInfo');
    sig.appendChild(signedInfo);

    const canonMethod = doc.createElementNS(NS_XMLDSIG, 'ds:CanonicalizationMethod');
    canonMethod.setAttribute('Algorithm', ALGO_EXC_C14N);
    const inclusiveNamespaces = doc.createElementNS(ALGO_EXC_C14N, 'ec:InclusiveNamespaces');
    inclusiveNamespaces.setAttribute('PrefixList', 'wsa soap wcf');
    canonMethod.appendChild(inclusiveNamespaces);
    signedInfo.appendChild(canonMethod);

    const sigMethod = doc.createElementNS(NS_XMLDSIG, 'ds:SignatureMethod');
    sigMethod.setAttribute('Algorithm', ALGO_RSA_SHA256);
    signedInfo.appendChild(sigMethod);

    // Reference to wsa:To
    const refTo = doc.createElementNS(NS_XMLDSIG, 'ds:Reference');
    refTo.setAttribute('URI', `#${ids.wsuToId}`);
    signedInfo.appendChild(refTo);

    const transformsTo = doc.createElementNS(NS_XMLDSIG, 'ds:Transforms');
    refTo.appendChild(transformsTo);
    const transformTo = doc.createElementNS(NS_XMLDSIG, 'ds:Transform');
    transformTo.setAttribute('Algorithm', ALGO_EXC_C14N);
    const incNsTo = doc.createElementNS(ALGO_EXC_C14N, 'ec:InclusiveNamespaces');
    incNsTo.setAttribute('PrefixList', 'soap wcf');
    transformTo.appendChild(incNsTo);
    transformsTo.appendChild(transformTo);

    const digestMethodTo = doc.createElementNS(NS_XMLDSIG, 'ds:DigestMethod');
    digestMethodTo.setAttribute('Algorithm', ALGO_SHA256);
    refTo.appendChild(digestMethodTo);

    // Compute digest for wsa:To
    const toDigestVal = doc.createElementNS(NS_XMLDSIG, 'ds:DigestValue');
    toDigestVal.textContent = this.computeToDigest(toValue, ids.wsuToId);
    refTo.appendChild(toDigestVal);

    // Compute SignatureValue over SignedInfo
    const sigVal = doc.createElementNS(NS_XMLDSIG, 'ds:SignatureValue');
    sigVal.textContent = this.computeSignatureValue(signedInfo, certData.privateKeyPem);
    sig.appendChild(sigVal);

    // KeyInfo referencing the BinarySecurityToken
    const keyInfo = doc.createElementNS(NS_XMLDSIG, 'ds:KeyInfo');
    keyInfo.setAttribute('Id', ids.keyInfoId);
    sig.appendChild(keyInfo);

    const secTokenRef = doc.createElementNS(NS_WSSEC, 'wsse:SecurityTokenReference');
    const refToken = doc.createElementNS(NS_WSSEC, 'wsse:Reference');
    refToken.setAttribute('URI', `#${ids.tokenId}`);
    refToken.setAttribute('ValueType', TOKEN_X509V3);
    secTokenRef.appendChild(refToken);
    keyInfo.appendChild(secTokenRef);

    return serializer.serializeToString(doc);
  }

  // ── Private helpers ────────────────────────────────────────────────

  private removeExistingHeader(doc: any): void {
    const headers = doc.getElementsByTagNameNS(NS_SOAP_ENVELOPE, 'Header');
    while (headers.length > 0) {
      const h: any = headers.item(0);
      h?.parentNode?.removeChild(h);
    }
  }

  private generateIds(): {
    tokenId: string;
    signatureId: string;
    timestampId: string;
    keyInfoId: string;
    wsuToId: string;
  } {
    const shortId = () =>
      crypto.createHash('sha1').update(crypto.randomBytes(16)).digest('hex').toUpperCase();
    const base = shortId();
    return {
      tokenId: `X509-${base}`,
      signatureId: `SIG-${base}`,
      timestampId: `TS-${base}`,
      keyInfoId: `KI-${base}`,
      wsuToId: `id-${base}`,
    };
  }

  /**
   * Computes the SHA-256 digest of the exclusive-canonicalised wsa:To
   * element, namespaced exactly as DIAN's WCF expects.
   */
  private computeToDigest(toValue: string, wsuToId: string): string {
    const toXml =
      `<wsa:To xmlns:soap="${NS_SOAP_ENVELOPE}" xmlns:wcf="${NS_DIAN_COLOMBIA}" xmlns:wsa="${NS_WSA}" xmlns:wsu="${NS_WSSEC_UTILITY}" wsu:Id="${wsuToId}">` +
      `${this.escapeXml(toValue)}` +
      `</wsa:To>`;

    const parser = new DOMParser();
    const tempDoc: any = parser.parseFromString(toXml, 'text/xml');
    const toNode: any = tempDoc.documentElement;

    const c14n = new ExclusiveCanonicalization();
    const canonicalized = c14n.process(toNode, { inclusiveNamespacesPrefixList: 'soap wcf' } as any);

    return crypto.createHash('sha256').update(canonicalized, 'utf-8').digest('base64');
  }

  /**
   * Computes the RSA-SHA256 signature over the exclusive-canonicalised
   * ds:SignedInfo element, with namespaces injected for DIAN's WCF stack.
   */
  private computeSignatureValue(
    signedInfoNode: any,
    privateKeyPem: string,
  ): string {
    const serializer = new XMLSerializer();
    const signedInfoStr = serializer.serializeToString(signedInfoNode);

    // Inject the required namespaces that DIAN's WCF canonicalisation
    // expects to find on the SignedInfo element.
    const nsInjected = signedInfoStr.replace(
      '<ds:SignedInfo',
      `<ds:SignedInfo xmlns:ds="${NS_XMLDSIG}" xmlns:wsa="${NS_WSA}" xmlns:soap="${NS_SOAP_ENVELOPE}" xmlns:wcf="${NS_DIAN_COLOMBIA}"`,
    );

    const parser = new DOMParser();
    const tempDoc: any = parser.parseFromString(nsInjected, 'text/xml');
    const c14n = new ExclusiveCanonicalization();
    const canonicalized: string = c14n.process(tempDoc.documentElement, {});

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(canonicalized);
    return signer.sign(privateKeyPem, 'base64');
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
