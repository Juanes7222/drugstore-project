/**
 * Zustand store for the DIAN digital certificate state of this workstation.
 *
 * SECURITY CONTRACT: this store persists METADATA ONLY — alias, subject CN,
 * validity window, derived status. The certificate file bytes and its
 * password NEVER enter this store (nor localStorage, nor any log). They
 * exist only in memory for the duration of an upload call.
 *
 * Persisted so the expiry warning survives app restarts; the source of
 * truth for the certificate itself remains the server.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CertificateStatus = 'NONE' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED';

/** Days before expiry after which the certificate is flagged as expiring. */
export const CERTIFICATE_EXPIRY_WARNING_DAYS = 30;

export interface CertificateSummary {
  alias: string;
  subjectCn: string;
  validFrom: string | null;
  validTo: string | null;
}

export interface CertificateState {
  status: CertificateStatus;
  /** Alias of the certificate currently active on the server. */
  alias: string | null;
  /** Subject CN of the certificate (the holder's identity). */
  subjectCn: string | null;
  /** ISO timestamp of the certificate validity end. */
  validTo: string | null;
  /** ISO timestamp of the last successful status refresh. */
  lastCheckedAt: string | null;
  /** Transient upload error code for the UI to translate. Not persisted. */
  uploadErrorCode: string | null;
}

interface CertificateActions {
  /** Record a successful upload or refresh from the server. */
  setCertificate: (summary: CertificateSummary) => void;
  /** Clear the local mirror (no certificate, or revoked/rotated). */
  clearCertificate: () => void;
  setUploadError: (code: string | null) => void;
  reset: () => void;
}

type CertificateStore = CertificateState & CertificateActions;

const initialState: CertificateState = {
  status: 'NONE',
  alias: null,
  subjectCn: null,
  validTo: null,
  lastCheckedAt: null,
  uploadErrorCode: null,
};

/** Derive the display status from the validity window. */
function deriveStatus(validTo: string): CertificateStatus {
  const validToMs = new Date(validTo).getTime();
  if (Number.isNaN(validToMs)) return 'EXPIRED';
  const now = Date.now();
  if (validToMs <= now) return 'EXPIRED';
  const warningWindowMs = CERTIFICATE_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
  if (validToMs - now <= warningWindowMs) return 'EXPIRING';
  return 'ACTIVE';
}

export const useCertificateStore = create<CertificateStore>()(
  persist(
    (set) => ({
      ...initialState,

      setCertificate: (summary) => set({
        status: summary.validTo ? deriveStatus(summary.validTo) : 'ACTIVE',
        alias: summary.alias,
        subjectCn: summary.subjectCn,
        validTo: summary.validTo,
        lastCheckedAt: new Date().toISOString(),
        uploadErrorCode: null,
      }),

      clearCertificate: () => set({
        status: 'NONE',
        alias: null,
        subjectCn: null,
        validTo: null,
        lastCheckedAt: new Date().toISOString(),
        uploadErrorCode: null,
      }),

      setUploadError: (code) => set({
        uploadErrorCode: code,
      }),

      reset: () => set(initialState),
    }),
    {
      name: 'pharmacy-fiscal-certificate-store',
      // Metadata only — never the certificate file or its password.
      partialize: (state) => ({
        status: state.status,
        alias: state.alias,
        subjectCn: state.subjectCn,
        validTo: state.validTo,
        lastCheckedAt: state.lastCheckedAt,
      }),
    },
  ),
);