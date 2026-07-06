/**
 * Result returned by FiscalTransmissionPort.signAndSend.
 */
export interface SendResult {
  /** Whether DIAN considered the document structurally and cryptographically valid. */
  isValid: boolean;

  /** The CUFE / tracking key assigned by DIAN (null when IsValid is false). */
  xmlDocumentKey: string | null;

  /** The signed XML as returned by DIAN (null when the transmission failed before a response). */
  signedXml: string | null;

  /** Human-readable status message from DIAN (set on rejection or error). */
  statusMessage: string | null;

  /** DIAN numeric status code. */
  statusCode: string | null;
}

/**
 * Result returned by FiscalTransmissionPort.checkStatus.
 */
export interface StatusResult {
  /** Whether the document is currently considered valid by DIAN. */
  isValid: boolean;

  /** DIAN numeric status code. */
  statusCode: string | null;

  /** Human-readable status description. */
  statusDescription: string | null;
}
