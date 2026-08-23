/**
 * Fiscal certificate service — client of the server's
 * `fiscal-dian/certificates` endpoints.
 *
 * Owns the business rules for uploading the pharmacy's DIAN digital
 * certificate (self-managed billing plan) and for reading its status:
 *
 * 1. Validates the input client-side (file type, size, password, software
 *    security code) so obvious mistakes never leave the terminal.
 * 2. Reads the PKCS#12 file into base64 and posts it to the server with
 *    the certificate password and the DIAN software security code.
 * 3. Mirrors ONLY the resulting metadata (alias, subject, validity) into
 *    the certificate store — never the file bytes, never the password.
 *
 * SECURITY: the certificate file and password exist only as local values
 * scoped to a single upload call. They are never persisted, never logged,
 * and never written to any store.
 */

import { isOnline } from '../../common/is-online';
import { useCertificateStore } from './certificate.store';
import {
  CertificateInvalidFileException,
  CertificateUploadOfflineException,
  CertificateUploadRejectedException,
  type CertificateValidationCode,
} from './exceptions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata of a stored certificate, mirroring the server's list payload. */
export interface FiscalCertificateSummary {
  id: string;
  alias: string;
  subjectCn: string;
  issuerCn: string;
  validFrom: string | null;
  validTo: string | null;
  status: string;
  activatedAt: string | null;
  rotatedAt: string | null;
}

/** User-supplied material for an upload. Never persisted by this service. */
export interface CertificateUploadInput {
  /** PKCS#12 file (.pfx / .p12) as picked by the user. */
  file: File;
  /** Password that unlocks the PKCS#12 bundle. */
  password: string;
  /** DIAN software security code (habilitación de software). */
  softwareSecurityCode: string;
  /** Human-friendly alias; defaults to "Principal" on the server. */
  alias?: string;
}

/** One stable error code per client-side validation rule. */
export type CertificateValidationResult =
  | { ok: true }
  | { ok: false; code: CertificateValidationCode };

export interface FiscalCertificateHttpClient {
  get<T>(url: string, headers?: Record<string, string>): Promise<T>;
  post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T>;
}

export interface FiscalCertificateServiceConfig {
  baseUrl: string;
  /** JWT for the protected certificates endpoint. */
  accessToken?: string;
  /** Optional override of the HTTP client (for tests). */
  httpClient?: FiscalCertificateHttpClient;
}

// ---------------------------------------------------------------------------
// Limits (mirror the server DTO: 4 MB base64 ≈ 3 MB decoded)
// ---------------------------------------------------------------------------

export const MAX_CERTIFICATE_FILE_BYTES = 3 * 1024 * 1024;
export const MIN_SECURITY_CODE_LENGTH = 10;

const CERTIFICATE_EXTENSIONS = new Set(['pfx', 'p12']);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Non-2xx response from the certificates endpoint. */
export class FiscalCertificateHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(url: string, statusCode: number, responseBody: string) {
    super(`Fiscal certificate HTTP error ${statusCode} for ${url}`);
    this.name = 'FiscalCertificateHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class FiscalCertificateService {
  private readonly http: FiscalCertificateHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;

  constructor(config: FiscalCertificateServiceConfig) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
  }

  /**
   * Validate the upload input without touching the network.
   * Returns a stable error code the UI can translate.
   */
  validateInput(input: CertificateUploadInput): CertificateValidationResult {
    const extension = input.file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!CERTIFICATE_EXTENSIONS.has(extension)) {
      return { ok: false, code: 'INVALID_FILE_TYPE' };
    }
    if (input.file.size > MAX_CERTIFICATE_FILE_BYTES) {
      return { ok: false, code: 'FILE_TOO_LARGE' };
    }
    if (!input.password) {
      return { ok: false, code: 'PASSWORD_REQUIRED' };
    }
    if (input.softwareSecurityCode.trim().length < MIN_SECURITY_CODE_LENGTH) {
      return { ok: false, code: 'SECURITY_CODE_TOO_SHORT' };
    }
    return { ok: true };
  }

  /**
   * Upload the certificate to the server.
   *
   * Throws a module exception on validation failure, offline, or server
   * rejection. On success the certificate store is updated with the
   * metadata only.
   */
  async upload(input: CertificateUploadInput): Promise<FiscalCertificateSummary> {
    const validation = this.validateInput(input);
    if (!validation.ok) {
      throw new CertificateInvalidFileException(validation.code);
    }

    if (!isOnline() || !this.accessToken) {
      throw new CertificateUploadOfflineException();
    }

    const certificateBase64 = await readFileAsBase64(input.file);

    let summary: FiscalCertificateSummary;
    try {
      summary = await this.http.post<FiscalCertificateSummary>(
        `${this.baseUrl}/fiscal-dian/certificates`,
        {
          alias: input.alias?.trim() || 'Principal',
          certificateBase64,
          password: input.password,
          softwareSecurityCode: input.softwareSecurityCode.trim(),
        },
        this.buildAuthHeaders(),
      );
    } catch (error) {
      if (error instanceof FiscalCertificateHttpError) {
        throw new CertificateUploadRejectedException(
          error.statusCode,
          error.responseBody,
        );
      }
      throw error;
    }

    // Mirror metadata only — the file bytes and password stay out of every
    // store and are discarded when this call returns.
    useCertificateStore.getState().setCertificate(summary);

    return summary;
  }

  /**
   * Fetch the tenant's certificate list and mirror the ACTIVE certificate
   * (or the most recent one) into the store. Resolves with null when the
   * tenant has no certificate.
   */
  async refreshStatus(): Promise<FiscalCertificateSummary | null> {
    if (!isOnline() || !this.accessToken) return null;

    let certificates: FiscalCertificateSummary[];
    try {
      const payload = await this.http.get<unknown>(
        `${this.baseUrl}/fiscal-dian/certificates`,
        this.buildAuthHeaders(),
      );
      // Best-effort status refresh must never reject: a malformed payload
      // is treated like a failed refresh, not an error state.
      if (!Array.isArray(payload)) return null;
      certificates = payload as FiscalCertificateSummary[];
    } catch {
      // Network failure or unexpected status — the persisted metadata keeps
      // working offline; a failed refresh is not an error state.
      return null;
    }

    const active =
      certificates.find((c) => c.status === 'ACTIVE') ??
      certificates[0] ??
      null;

    if (active) {
      useCertificateStore.getState().setCertificate({
        alias: active.alias,
        subjectCn: active.subjectCn,
        validFrom: active.validFrom,
        validTo: active.validTo,
      });
    } else if (certificates.length === 0) {
      useCertificateStore.getState().clearCertificate();
    }

    return active;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildAuthHeaders(): Record<string, string> {
    if (this.accessToken) {
      return { Authorization: `Bearer ${this.accessToken}` };
    }
    return {};
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a File into a plain base64 string (data-URL prefix stripped).
 * The result is scoped to the caller and garbage-collected after upload.
 */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const commaIndex = dataUrl.indexOf(',');
      resolve(commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Default HTTP client
// ---------------------------------------------------------------------------

const defaultHttpClient: FiscalCertificateHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new FiscalCertificateHttpError(
        url,
        response.status,
        await response.text(),
      );
    }
    return response.json() as Promise<T>;
  },

  post: async <T>(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<T> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new FiscalCertificateHttpError(
        url,
        response.status,
        await response.text(),
      );
    }
    return response.json() as Promise<T>;
  },
};