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
import { isValidDaneMunicipioCode } from './dane-catalog';
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
  InvalidMunicipioCodeException,
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

/** Active numbering resolution returned alongside the issuer config. */
export interface FiscalResolutionPayload {
  id: string;
  resolutionNumber: string;
  documentType: string;
  prefix: string | null;
  rangeFrom: number;
  rangeTo: number;
  validFrom: string;
  validTo: string;
  state: string;
}

export type IssuerConfigResponse = IssuerConfigPayload & {
  /** Null when the contributor has no ACTIVE resolution yet. */
  resolution?: FiscalResolutionPayload | null;
};

export interface CompanyProfileHttpClient {
  get<T>(url: string, headers?: Record<string, string>): Promise<T>;
  patch<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T>;
  post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T>;
}

export interface CompanyProfileConfig {
  baseUrl: string;
  /** Optional override of the HTTP client (for tests). */
  httpClient?: CompanyProfileHttpClient;
  /** JWT for the protected issuer-config endpoint. */
  accessToken?: string;
  /** Workstation that will consume the resolution (for the allocation). */
  workstationId?: string;
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
  private readonly workstationId?: string;

  constructor(config: CompanyProfileConfig) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.workstationId = config.workstationId;
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
      const payload = await this.http.get<IssuerConfigResponse>(
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

    // Persist the numbering resolution on the server so the fiscal engine
    // can emit UBLs with it and the POS can auto-initialize its counters
    // via the config sync. Best effort: a failure here must not undo the
    // company profile submit — the owner can register the resolution from
    // the backoffice instead (an overlapping active resolution is the
    // normal case on re-edits, so it is explicitly swallowed).
    if (draft.resolutionNumber) {
      await this.pushResolution(draft);
    }
  }

  /**
   * Create the DIAN resolution + workstation allocation on the server.
   * Never throws: failures are logged and left to the backoffice flow.
   */
  private async pushResolution(draft: CompanyDraft): Promise<void> {
    try {
      const resolution = await this.http.post<{ id: string }>(
        `${this.baseUrl}/fiscal-dian/resolutions`,
        {
          resolutionNumber: draft.resolutionNumber,
          documentType: 'INVOICE',
          prefix: draft.resolutionPrefix || 'FE',
          rangeFrom: Number(draft.resolutionRangeStart),
          rangeTo: Number(draft.resolutionRangeEnd),
          validFrom: toIsoDate(draft.resolutionDate),
          validTo: toIsoDate(draft.resolutionValidTo ?? draft.resolutionDate),
        },
        this.buildAuthHeaders(),
      );

      if (this.workstationId) {
        await this.http.post(
          `${this.baseUrl}/fiscal-dian/resolution-allocations`,
          {
            resolutionId: resolution.id,
            workstationId: this.workstationId,
            rangeFrom: Number(draft.resolutionRangeStart),
            rangeTo: Number(draft.resolutionRangeEnd),
          },
          this.buildAuthHeaders(),
        );
      }
    } catch (error) {
      console.error(
        '[CompanyProfileService] Resolution registration failed (non-blocking):',
        error,
      );
    }
  }

  /**
   * Validate that a draft satisfies the minimum to register the company.
   *
   * Deliberately minimal: the numbering resolution is NOT required here —
   * electronic invoicing obtains its range automatically once the
   * contributor is habilitated with DIAN (certificate loaded), and a
   * physical paper/thermal resolution can be added later from the
   * backoffice or the edit flow. The user's job at onboarding is only to
   * confirm their identity data.
   */
  validateDraft(draft: CompanyDraft): void {
    if (!isValidNitDv(draft.nit, draft.dv)) {
      throw new InvalidNitDvException();
    }

    const required: Array<keyof CompanyDraft> = [
      'name',
      'address',
      'municipio',
      'departamento',
    ];

    for (const key of required) {
      const value = draft[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new CompanyNotConfiguredException();
      }
    }

    // A municipio code that does not exist in the DANE catalog would reach
    // DIAN as an invalid address code — reject it at the source.
    if (draft.municipioCode && !isValidDaneMunicipioCode(draft.municipioCode)) {
      throw new InvalidMunicipioCodeException();
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

/** Convert a 'YYYY-MM-DD' date into an ISO datetime string for the server. */
function toIsoDate(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/**
 * Map the DIAN TaxLevelCode catalog onto a human-readable regimen label.
 *
 * O-99 previously returned "OTRO" (generic server fallback). Now returns
 * "NO RESPONSABLE" so the fiscal tab and product form show a coherent
 * regime/rate pair (0% IVA) and the round-trip
 * taxRegimeToLabel(O-99) → mapRegimenToTaxLevelCode(...) stays O-99
 * instead of degrading to R-99-PN (19%).
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
      return 'NO RESPONSABLE';
  }
}

/**
 * Map a draft regimen/organization-type pair onto the DIAN catalog.
 * Best effort — the wizard's free-text regimen comes from the RUT.
 *
 * Order matters: exempt / non-responsible regimes must be caught before
 * the generic R-99-PN fallback, otherwise "NO RESPONSABLE DE IVA" would
 * incorrectly map to R-99-PN (19%). SIMPLE covers "RÉGIMEN SIMPLE" and
 * also matches "SIMPLIFICADO" (both → R-99-PN-SIM); kept as separate
 * checks to preserve explicit intent.
 */
export function mapRegimenToTaxLevelCode(
  regimen: string,
  organizationType: string | null,
): TaxLevelCode {
  const regimenUpper = regimen.toUpperCase();
  // 0% IVA — non-responsible / exempt / excluded. Must be first.
  if (
    regimenUpper.includes('NO RESPONSABLE') ||
    regimenUpper.includes('NO_RESPONSABLE') ||
    regimenUpper.includes('EXENTO') ||
    regimenUpper.includes('EXCLUIDO') ||
    // Legacy label for O-99 was "OTRO" — keep mapping for stored drafts
    regimenUpper.includes('OTRO')
  ) {
    return 'O-99';
  }
  // Both map to the same DIAN code; keep separate checks for explicit intent.
  // SIMPLIFICADO first so the SIMPLE substring check does not shadow it
  // (dead-code) — outcome is identical either way.
  if (regimenUpper.includes('SIMPLIFICADO')) return 'R-99-PN-SIM';
  if (regimenUpper.includes('SIMPLE')) return 'R-99-PN-SIM';
  if (
    regimenUpper.includes('SIN ÁNIMO') ||
    regimenUpper.includes('SIN ANIMO')
  ) {
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
    organizationType:
      draft.organizationType ??
      // Server requires a non-empty type; infer it from the mapped regime.
      (mapRegimenToTaxLevelCode(draft.regimen, null) === 'R-99-PJ'
        ? 'PERSONA JURIDICA'
        : 'PERSONA NATURAL'),
    taxRegime: mapRegimenToTaxLevelCode(draft.regimen, draft.organizationType),
    address: draft.address ?? null,
    municipality: draft.municipio ?? null,
    municipioCode: draft.municipioCode ?? null,
    department: draft.departamento ?? null,
    phone: draft.phone ?? null,
    email: draft.email ?? null,
    ciiu: draft.ciiu ?? null,
    softwareId: draft.softwareId ?? null,
  };
}

function mapIssuerConfigToDraft(
  payload: IssuerConfigResponse,
): CompanyDraft {
  const dv = payload.verificationDigit;
  const nit = payload.nit.replace(/\D/g, '');
  const resolution = payload.resolution ?? null;
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
    resolutionNumber: resolution?.resolutionNumber ?? null,
    resolutionDate: resolution?.validFrom ?? null,
    resolutionPrefix: resolution?.prefix ?? 'FE',
    resolutionRangeStart: resolution ? String(resolution.rangeFrom) : null,
    resolutionRangeEnd: resolution ? String(resolution.rangeTo) : null,
    softwareId: payload.softwareId ?? null,
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
      throw new CompanyProfileHttpError(
        url,
        response.status,
        await response.text(),
      );
    }
    return response.json() as Promise<T>;
  },
};