/**
 * Company-profile service — the client side of the fiscal issuer setup.
 *
 * Owns the business rules for capturing and submitting the pharmacy's
 * fiscal identity (the DIAN emitter):
 *
 * 1. Validates the draft (NIT/DV consistency + required DIAN fields).
 * 2. Submits it to the server's `fiscal-dian/issuer-config` endpoint.
 * 3. Mirrors the result into the local config store (receipts/invoices
 *    read seller identity from there) and the company-setup store.
 *
 * Offline-first: the draft is always kept locally; only the server push
 * requires connectivity.
 */

import { isOnline } from '../../common/is-online';
import { isValidNitDv } from '../../common/nit';
import {
  DEFAULT_SELLER_INFO,
  getTenantInfo,
  useLocalConfigStore,
} from '../configuration/local-config.store';
import { useCompanySetupStore } from './company.store';
import type {
  CompanyDraft,
  CompanySetupStatus,
} from './company-types';
import {
  CompanyNotConfiguredException,
  CompanySubmitOfflineException,
  CompanySubmitRejectedException,
  InvalidNitDvException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Contract types (server `fiscal-dian/issuer-config`)
// ---------------------------------------------------------------------------

/** DIAN TaxLevelCode catalog values accepted by the server schema. */
export type TaxLevelCode =
  | 'R-99-PN'
  | 'R-99-PJ'
  | 'R-99-PN-ENT'
  | 'R-99-PN-SIM'
  | 'O-99';

export interface IssuerConfigPayload {
  nit: string;
  verificationDigit: string;
  businessName: string;
  commercialName?: string | null;
  organizationType?: string | null;
  taxRegime: TaxLevelCode;
  taxResponsibilities?: string | null;
  address?: string | null;
  municipality?: string | null;
  municipioCode?: string | null;
  department?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  ciiu?: string | null;
  softwareId?: string | null;
}

export interface CompanyProfileHttpClient {
  get<T>(url: string, headers?: Record<string, string>): Promise<T>;
  patch<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T>;
}

export interface CompanyProfileConfig {
  baseUrl: string;
  /** Optional override of the HTTP client (for tests). */
  httpClient?: CompanyProfileHttpClient;
  /** JWT for the protected issuer-config endpoint. */
  accessToken?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Non-2xx response from the issuer-config endpoint. */
export class CompanyProfileHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(url: string, statusCode: number, responseBody: string) {
    super(`Company profile HTTP error ${statusCode} for ${url}: ${responseBody}`);
    this.name = 'CompanyProfileHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CompanyProfileService {
  private readonly http: CompanyProfileHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;

  constructor(config: CompanyProfileConfig) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
  }

  /**
   * Resolve whether the company profile still needs to be captured.
   *
   * The company-setup store wins when it already knows (a submit happened
   * or the server profile was fetched); otherwise fall back to the local
   * seller identity — the placeholder NIT means a fresh install.
   */
  resolveSetupStatus(): CompanySetupStatus {
    const storeStatus = useCompanySetupStore.getState().status;
    if (storeStatus === 'complete') return 'complete';
    const seller = getTenantInfo();
    return seller.nit === DEFAULT_SELLER_INFO.nit ? 'needs-setup' : 'complete';
  }

  /**
   * Fetch the server-side issuer profile, if one exists.
   *
   * Returns null when the server has no profile yet (404 / not-set) or
   * when offline — callers treat both as "needs setup".
   */
  async fetchCompanyProfile(): Promise<CompanyDraft | null> {
    if (!isOnline() || !this.accessToken) return null;
    try {
      const payload = await this.http.get<IssuerConfigPayload>(
        `${this.baseUrl}/fiscal-dian/issuer-config`,
        this.buildAuthHeaders(),
      );
      return mapIssuerConfigToDraft(payload);
    } catch (error) {
      if (error instanceof CompanyProfileHttpError && error.statusCode === 404) {
        return null;
      }
      // Network failure or unexpected status — do not block onboarding on
      // the server; the local store decides.
      return null;
    }
  }

  /**
   * Validate and submit the company profile.
   *
   * Throws a module exception on validation failure, offline, or server
   * rejection. On success the local config store and the company-setup
   * store are updated so invoices and the wizard reflect the new state.
   */
  async submitCompany(draft: CompanyDraft): Promise<void> {
    this.validateDraft(draft);

    if (!isOnline() || !this.accessToken) {
      throw new CompanySubmitOfflineException();
    }

    const payload = mapDraftToIssuerConfig(draft);
    try {
      await this.http.patch(
        `${this.baseUrl}/fiscal-dian/issuer-config`,
        payload,
        this.buildAuthHeaders(),
      );
    } catch {
      throw new CompanySubmitRejectedException();
    }

    // Mirror into the local config store — receipts and invoices read
    // seller identity from there (TenantInfo shape).
    useLocalConfigStore.getState().updateSellerInfo({
      nit: formatNit(draft.nit),
      name: draft.name,
      address: draft.address,
      phone: draft.phone,
      resolutionNumber: draft.resolutionNumber,
      resolutionDate: draft.resolutionDate,
      resolutionPrefix: draft.resolutionPrefix || 'FE',
    });

    useCompanySetupStore.getState().markComplete(draft);
  }

  /**
   * Validate that a draft satisfies the DIAN minimum for invoicing.
   */
  validateDraft(draft: CompanyDraft): void {
    if (!isValidNitDv(draft.nit, draft.dv)) {
      throw new InvalidNitDvException();
    }

    const required: Array<keyof CompanyDraft> = [
      'name',
      'regimen',
      'address',
      'municipio',
      'departamento',
      'ciiu',
      'resolutionNumber',
      'resolutionRangeStart',
      'resolutionRangeEnd',
    ];

    for (const key of required) {
      const value = draft[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new CompanyNotConfiguredException();
      }
    }

    if (!draft.resolutionPrefix?.trim()) {
      throw new CompanyNotConfiguredException();
    }
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
// Mappers
// ---------------------------------------------------------------------------

/** Render a NIT in the canonical "000.000.000-0" display form. */
export function formatNit(nit: string): string {
  const digits = nit.replace(/\D/g, '');
  if (digits.length <= 9) {
    return digits.replace(/(\d{3})(\d{3})(\d+)/, '$1.$2.$3');
  }
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d+)/, '$1.$2.$3.$4');
}

/**
 * Map the DIAN TaxLevelCode catalog onto a human-readable regimen label.
 */
export function taxRegimeToLabel(code: TaxLevelCode): string {
  switch (code) {
    case 'R-99-PN':
      return 'RÉGIMEN COMÚN - PERSONA NATURAL';
    case 'R-99-PJ':
      return 'RÉGIMEN COMÚN - PERSONA JURÍDICA';
    case 'R-99-PN-ENT':
      return 'ENTIDAD SIN ÁNIMO DE LUCRO';
    case 'R-99-PN-SIM':
      return 'RÉGIMEN SIMPLIFICADO';
    case 'O-99':
      return 'OTRO';
  }
}

/**
 * Map a draft regimen/organization-type pair onto the DIAN catalog.
 * Best effort — the wizard's free-text regimen comes from the RUT.
 */
export function mapRegimenToTaxLevelCode(
  regimen: string,
  organizationType: string | null,
): TaxLevelCode {
  const regimenUpper = regimen.toUpperCase();
  if (regimenUpper.includes('SIMPLIFICADO')) return 'R-99-PN-SIM';
  if (regimenUpper.includes('SIN ÁNIMO') || regimenUpper.includes('SIN ANIMO')) {
    return 'R-99-PN-ENT';
  }
  if (organizationType?.toUpperCase().includes('JUR')) return 'R-99-PJ';
  return 'R-99-PN';
}

function mapDraftToIssuerConfig(draft: CompanyDraft): IssuerConfigPayload {
  return {
    nit: draft.nit,
    verificationDigit: draft.dv,
    businessName: draft.name,
    organizationType: draft.organizationType ?? null,
    taxRegime: mapRegimenToTaxLevelCode(draft.regimen, draft.organizationType),
    address: draft.address ?? null,
    municipality: draft.municipio ?? null,
    municipioCode: draft.municipioCode ?? null,
    department: draft.departamento ?? null,
    phone: draft.phone ?? null,
    email: draft.email ?? null,
    ciiu: draft.ciiu ?? null,
  };
}

function mapIssuerConfigToDraft(payload: IssuerConfigPayload): CompanyDraft {
  const dv = payload.verificationDigit;
  const nit = payload.nit.replace(/\D/g, '');
  return {
    nit,
    dv,
    name: payload.businessName,
    regimen: taxRegimeToLabel(payload.taxRegime),
    organizationType: payload.organizationType ?? null,
    ciiu: payload.ciiu ?? null,
    municipio: payload.municipality ?? null,
    municipioCode: payload.municipioCode ?? null,
    departamento: payload.department ?? null,
    address: payload.address ?? null,
    phone: payload.phone ?? null,
    email: payload.email ?? null,
    resolutionNumber: null,
    resolutionDate: null,
    resolutionPrefix: 'FE',
    resolutionRangeStart: null,
    resolutionRangeEnd: null,
  };
}

// ---------------------------------------------------------------------------
// Default HTTP client
// ---------------------------------------------------------------------------

const defaultHttpClient: CompanyProfileHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new CompanyProfileHttpError(
        url,
        response.status,
        await response.text(),
      );
    }
    return response.json() as Promise<T>;
  },

  patch: async <T>(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<T> => {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new CompanyProfileHttpError(
        url,
        response.status,
        await response.text(),
      );
    }
    return response.json() as Promise<T>;
  },
};