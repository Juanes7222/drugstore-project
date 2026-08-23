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
  FiscalResolutionPayload,
  IssuerConfigPayload,
  IssuerConfigResponse,
  TaxLevelCode,
} from './company-profile.service';
export {
  DANE_DEPARTAMENTOS,
  findDaneDepartamento,
  findDaneMunicipio,
  findDaneMunicipioByName,
  isValidDaneDepartamentoCode,
  isValidDaneMunicipioCode,
  normalizeDaneName,
  resolveDaneMunicipioCode,
} from './dane-catalog';
export type { DaneDepartamento, DaneMunicipio } from './dane-catalog';
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
  InvalidMunicipioCodeException,
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