/**
 * DIAN-specific constants for XAdES-EPES signing and SOAP WS-Security.
 *
 * These values come from the DIAN Technical Annex v1.9 and the published
 * WCF service contracts. They are replicated here rather than loaded
 * from configuration because they are part of the protocol contract,
 * not deployment-specific environment variables.
 */

// ── DIAN XAdES signature policy ──────────────────────────────────────
// The policy PDF lives at the URL below. Its SHA-256 digest is a known
// constant published by DIAN — if the policy document is ever updated,
// this hash must change accordingly.
export const SIGNATURE_POLICY_URL =
  'https://facturaelectronica.dian.gov.co/politicadefirma/v2/politicadefirmav2.pdf';
export const SIGNATURE_POLICY_HASH_BASE64 = 'dMoMvtcG5aIzgYo0tIsSQeVJBDnUnfSOfBpxXrmor0Y=';

// ── XML namespaces ───────────────────────────────────────────────────
export const NS_SOAP_ENVELOPE = 'http://www.w3.org/2003/05/soap-envelope';
export const NS_DIAN_COLOMBIA = 'http://wcf.dian.colombia';
export const NS_XMLDSIG = 'http://www.w3.org/2000/09/xmldsig#';
export const NS_WSSEC = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
export const NS_WSSEC_UTILITY = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
export const NS_WSA = 'http://www.w3.org/2005/08/addressing';
export const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';

export const ALGO_EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
export const ALGO_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
export const ALGO_ENVELOPED_SIG = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

export const ALGO_RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
export const ALGO_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';

export const TOKEN_X509V3 = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3';
export const TOKEN_BASE64_BINARY = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary';

// ── DIAN web service actions ─────────────────────────────────────────
export const SOAP_ACTION_SEND_BILL_SYNC =
  'http://wcf.dian.colombia/IWcfDianCustomerServices/SendBillSync';
export const SOAP_ACTION_GET_STATUS =
  'http://wcf.dian.colombia/IWcfDianCustomerServices/GetStatus';
export const SOAP_ACTION_GET_NUMBERING_RANGE =
  'http://wcf.dian.colombia/IWcfDianCustomerServices/GetNumberingRange';

// ── DIAN environment endpoints ───────────────────────────────────────
export const DIAN_ENDPOINTS: Record<string, string> = {
  '1': 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc?wsdl',
  '2': 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc?wsdl',
};
