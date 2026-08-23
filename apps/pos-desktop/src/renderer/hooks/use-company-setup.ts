/**
 * useCompanySetup — React-facing wrapper over the company-setup domain.
 *
 * Contract for the company-setup wizard components (frontend-pos): exposes
 * the setup lifecycle status, the current/parsed drafts, RUT upload with
 * autofill, and profile submission.
 *
 * Owned by pos-local: wraps domain logic (RUT parsing, DV validation,
 * server submit) — components never touch the domain services directly.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { isValidNitDv } from '../../common/nit';
import { API_BASE_URL } from '../../infrastructure/config';
import { useLocalSessionStore } from '../../domain/auth/local-session.store';
import {
  CompanyProfileService,
  parseRutPdfText,
  useCompanySetupStore,
} from '../../domain/company';
import type {
  CompanyDraft,
  CompanySetupStatus,
  RutParseResult,
} from '../../domain/company';
import { extractRutPdfText } from '../services/rut-pdf-extractor';

// Re-exported so the wizard components import the contract types from this
// single module (their established import site).
export type {
  CompanyDraft,
  CompanySetupStatus,
  RutParseResult,
} from '../../domain/company';

/** Injectable text extractor (tests inject a fake; default is pdf.js). */
export type RutTextExtractor = (file: File | Blob) => Promise<string>;

export interface UseCompanySetupOptions {
  /** Server base URL override (defaults to the app config). */
  baseUrl?: string;
  /** Test seam — replaces the pdf.js extractor. */
  extractor?: RutTextExtractor;
}

export interface UseCompanySetupResult {
  status: CompanySetupStatus;
  /** Last complete draft (parsed or manually entered). */
  draft: CompanyDraft | null;
  /** Draft being reviewed right after a RUT parse. */
  parsedFromRut: CompanyDraft | null;
  isResolving: boolean;
  uploadRutFile(file: File): Promise<RutParseResult>;
  submitCompany(draft: CompanyDraft): Promise<void>;
  reset(): void;
}

export function useCompanySetup(
  options?: UseCompanySetupOptions,
): UseCompanySetupResult {
  const accessToken = useLocalSessionStore(
    (s) => s.session?.accessToken,
  );
  const workstationId = useLocalSessionStore(
    (s) => s.session?.workstationId,
  );

  const status = useSyncExternalStore(
    useCompanySetupStore.subscribe,
    () => useCompanySetupStore.getState().status,
  );
  const draft = useSyncExternalStore(
    useCompanySetupStore.subscribe,
    () => useCompanySetupStore.getState().draft,
  );
  const parsedFromRut = useSyncExternalStore(
    useCompanySetupStore.subscribe,
    () => useCompanySetupStore.getState().parsedFromRut,
  );

  const [isResolving, setIsResolving] = useState(false);

  const service = useMemo(
    () =>
      new CompanyProfileService({
        baseUrl: options?.baseUrl ?? API_BASE_URL,
        accessToken,
        workstationId,
      }),
    [accessToken, workstationId, options?.baseUrl],
  );

  // Resolve the setup status once at mount: fetch the server profile when
  // authenticated; otherwise fall back to the local seller identity.
  useEffect(() => {
    let cancelled = false;
    if (useCompanySetupStore.getState().status !== 'idle') return;

    setIsResolving(true);
    const resolve = async (): Promise<CompanySetupStatus> => {
      if (!accessToken) return service.resolveSetupStatus();
      const profile = await service.fetchCompanyProfile();
      if (profile) {
        useCompanySetupStore.getState().markComplete(profile);
        return 'complete';
      }
      return service.resolveSetupStatus();
    };

    resolve()
      .then((next) => {
        if (!cancelled) {
          useCompanySetupStore.getState().setStatus(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          useCompanySetupStore.getState().setStatus(
            service.resolveSetupStatus(),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsResolving(false);
      });

    return () => {
      cancelled = true;
    };
  }, [service, accessToken]);

  const extractor = options?.extractor ?? extractRutPdfText;

  /**
   * Parse a RUT PDF and validate it into an autofilled company draft.
   *
   * Result contract for the wizard: `ok: true` with the draft, or
   * `ok: false` with a stable error code the UI translates.
   */
  const uploadRutFile = useCallback(
    async (file: File): Promise<RutParseResult> => {
      try {
        const text = await extractor(file);
        const { fields } = parseRutPdfText(text);

        if (!fields.nit || !fields.dv || !fields.name) {
          return { ok: false, errorCode: 'UNPARSEABLE' };
        }
        if (!isValidNitDv(fields.nit, fields.dv)) {
          return { ok: false, errorCode: 'INVALID_NIT_DV' };
        }

        const draft: CompanyDraft = {
          nit: fields.nit,
          dv: fields.dv,
          name: fields.name,
          regimen: fields.regimen ?? '',
          organizationType: fields.organizationType,
          ciiu: fields.ciiu,
          municipio: fields.municipio,
          municipioCode: fields.municipioCode,
          departamento: fields.departamento,
          address: fields.address,
          phone: fields.phone,
          email: fields.email,
          resolutionNumber: null,
          resolutionDate: null,
          resolutionPrefix: 'FE',
          resolutionRangeStart: null,
          resolutionRangeEnd: null,
          softwareId: null,
        };

        useCompanySetupStore.getState().setParsedFromRut(draft);
        return { ok: true, draft };
      } catch {
        return { ok: false, errorCode: 'UNPARSEABLE' };
      }
    },
    [extractor],
  );

  /**
   * Validate + submit the company profile to the server. Resolves on
   * success (store flips to 'complete'); throws a domain exception the
   * caller can surface.
   */
  const submitCompany = useCallback(
    async (draft: CompanyDraft): Promise<void> => {
      await service.submitCompany(draft);
    },
    [service],
  );

  const reset = useCallback(() => {
    useCompanySetupStore.getState().reset();
  }, []);

  return {
    status,
    draft,
    parsedFromRut,
    isResolving,
    uploadRutFile,
    submitCompany,
    reset,
  };
}