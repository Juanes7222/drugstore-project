/**
 * Company-profile types shared across the company-setup module, the
 * renderer hook, and the wizard components.
 */

/**
 * Complete company/issuer profile the pharmacy must provide before any
 * electronic invoice can be issued. Mirrors the server's
 * `UpsertFiscalIssuerConfigDto` contract (plus the resolution range, which
 * lives on the separate FiscalResolution entity server-side).
 */
export interface CompanyDraft {
  /** NIT digits only, 8-15 digits. */
  nit: string;
  /** DIAN verification digit (single digit). */
  dv: string;
  /** Razón social (legal entity) or full name (natural person). */
  name: string;
  /** Raw regimen text as shown on the RUT ("RÉGIMEN COMÚN", ...). */
  regimen: string;
  /** "PERSONA JURÍDICA" | "PERSONA NATURAL" | null. */
  organizationType: string | null;
  /** CIIU economic-activity code (4 digits). */
  ciiu: string | null;
  /** Municipio name as shown on the RUT. */
  municipio: string | null;
  /** DANE municipality code (5 digits). */
  municipioCode: string | null;
  /** Department name as shown on the RUT. */
  departamento: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** DIAN numbering resolution — never present on the RUT, entered manually. */
  resolutionNumber: string | null;
  /** ISO date of the resolution. */
  resolutionDate: string | null;
  /** Invoice prefix authorized by the resolution (e.g. "FE"). */
  resolutionPrefix: string;
  /** First authorized invoice number (resolution range start). */
  resolutionRangeStart: string | null;
  /** Last authorized invoice number (resolution range end). */
  resolutionRangeEnd: string | null;
  /** ISO date when the resolution's validity ends (required with the rest). */
  resolutionValidTo?: string | null;
  /**
   * DIAN software habilitación ID for this NIT (assigned by DIAN when the
   * software is registered against the contributor). Optional — the
   * software provider configures it when the habilitación is complete.
   */
  softwareId?: string | null;
}

/** Result of uploading a RUT file, as consumed by the wizard components. */
export type RutParseResult =
  | { ok: true; draft: CompanyDraft }
  | { ok: false; errorCode: 'UNPARSEABLE' | 'INVALID_NIT_DV' };

/** Setup lifecycle states surfaced to the UI. */
export type CompanySetupStatus = 'idle' | 'needs-setup' | 'complete';