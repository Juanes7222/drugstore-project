/**
 * Company-setup module barrel.
 *
 * Exports the profile service, the reactive store, and the shared types —
 * everything the renderer hook and wizard components consume.
 */

export {
  CompanyProfileService,
  CompanyProfileHttpError,
  formatNit,
  mapRegimenToTaxLevelCode,
  taxRegimeToLabel,
} from './company-profile.service';
export type {
  CompanyProfileConfig,
  CompanyProfileHttpClient,
  IssuerConfigPayload,
  TaxLevelCode,
} from './company-profile.service';
export { useCompanySetupStore } from './company.store';
export type { CompanySetupState } from './company.store';
export type {
  CompanyDraft,
  CompanySetupStatus,
  RutParseResult,
} from './company-types';
export {
  RutUnparseableException,
  InvalidNitDvException,
  CompanyNotConfiguredException,
  CompanySubmitOfflineException,
  CompanySubmitRejectedException,
} from './exceptions';
export { parseRutPdfText } from './rut-parser';
export type {
  RutExtractedFields,
  RutExtractedFieldKey,
  RutParseResult as RutParserResult,
} from './rut-parser';