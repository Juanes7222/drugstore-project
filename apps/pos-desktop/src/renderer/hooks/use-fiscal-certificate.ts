/**
 * useFiscalCertificate — React-facing wrapper over the certificate domain.
 *
 * Contract for the certificate components (frontend-pos): exposes the
 * certificate status, the upload lifecycle with stable error codes, and a
 * `needsCertificate` flag that gates the onboarding step and the persistent
 * banner for self-managed billing plans.
 *
 * Owned by pos-local: wraps domain logic (validation, upload, status
 * refresh) — components never touch the domain services directly, and the
 * certificate file/password never reach the UI layer beyond the one-shot
 * upload input.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { API_BASE_URL } from '../../infrastructure/config';
import { useLocalSessionStore } from '../../domain/auth/local-session.store';
import { useLicenseStore } from '../../domain/licensing/license.store';
import {
  FiscalCertificateService,
  useCertificateStore,
  type CertificateStatus,
  type CertificateUploadInput,
  type CertificateValidationCode,
} from '../../domain/fiscal';

export interface UseFiscalCertificateOptions {
  /** Server base URL override (defaults to the app config). */
  baseUrl?: string;
}

export interface UseFiscalCertificateResult {
  status: CertificateStatus;
  alias: string | null;
  subjectCn: string | null;
  validTo: string | null;
  lastCheckedAt: string | null;
  /** Transient client-side validation error code for the UI to translate. */
  uploadErrorCode: CertificateValidationCode | null;
  isUploading: boolean;
  /**
   * True when the subscription plan is CERTIFICATE and no certificate is
   * configured yet — drives the onboarding step and the warning banner.
   */
  needsCertificate: boolean;
  /**
   * Validate + upload. Resolves with true on success, false on a
   * client-side validation error (read `uploadErrorCode`). Throws a domain
   * exception on offline/server rejection — callers surface it.
   */
  upload(input: CertificateUploadInput): Promise<boolean>;
  /** Best-effort refresh of the certificate status from the server. */
  refresh(): Promise<void>;
  clearUploadError(): void;
}

export function useFiscalCertificate(
  options?: UseFiscalCertificateOptions,
): UseFiscalCertificateResult {
  const accessToken = useLocalSessionStore((s) => s.session?.accessToken);
  const billingMethod = useLicenseStore((s) => s.billingMethod);

  const status = useSyncExternalStore(
    useCertificateStore.subscribe,
    () => useCertificateStore.getState().status,
  );
  const alias = useSyncExternalStore(
    useCertificateStore.subscribe,
    () => useCertificateStore.getState().alias,
  );
  const subjectCn = useSyncExternalStore(
    useCertificateStore.subscribe,
    () => useCertificateStore.getState().subjectCn,
  );
  const validTo = useSyncExternalStore(
    useCertificateStore.subscribe,
    () => useCertificateStore.getState().validTo,
  );
  const lastCheckedAt = useSyncExternalStore(
    useCertificateStore.subscribe,
    () => useCertificateStore.getState().lastCheckedAt,
  );
  const uploadErrorCode = useSyncExternalStore(
    useCertificateStore.subscribe,
    () => useCertificateStore.getState().uploadErrorCode,
  );

  const [isUploading, setIsUploading] = useState(false);

  const service = useMemo(
    () =>
      new FiscalCertificateService({
        baseUrl: options?.baseUrl ?? API_BASE_URL,
        accessToken: accessToken ?? undefined,
      }),
    [accessToken, options?.baseUrl],
  );

  // Best-effort status refresh once when the component mounts (keeps the
  // persisted metadata in sync with the server, e.g. after a rotation).
  useEffect(() => {
    void service.refreshStatus();
  }, [service]);

  const needsCertificate =
    billingMethod === 'CERTIFICATE' && status === 'NONE';

  const upload = useCallback(
    async (input: CertificateUploadInput): Promise<boolean> => {
      // Client-side validation first — report stable codes without a round
      // trip; do not touch the network for obviously invalid input.
      const validation = service.validateInput(input);
      if (!validation.ok) {
        useCertificateStore.getState().setUploadError(validation.code);
        return false;
      }

      setIsUploading(true);
      try {
        await service.upload(input);
        return true;
      } finally {
        setIsUploading(false);
      }
    },
    [service],
  );

  const refresh = useCallback(async () => {
    await service.refreshStatus();
  }, [service]);

  const clearUploadError = useCallback(() => {
    useCertificateStore.getState().setUploadError(null);
  }, []);

  return {
    status,
    alias,
    subjectCn,
    validTo,
    lastCheckedAt,
    uploadErrorCode: uploadErrorCode as CertificateValidationCode | null,
    isUploading,
    needsCertificate,
    upload,
    refresh,
    clearUploadError,
  };
}