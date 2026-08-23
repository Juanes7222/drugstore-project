/**
 * Company-setup module exceptions.
 *
 * Every exception carries a stable `errorCode` the renderer branches on
 * (the RUT upload flow maps these to user-facing i18n messages).
 */

import { DomainError } from '../../common/domain-error';

/** RUT file could not be parsed into usable company fields. */
export class RutUnparseableException extends DomainError {
  constructor() {
    super('RUT_UNPARSEABLE', 'RUT text could not be parsed.');
  }
}

/** RUT was parsed, but its NIT does not match its verification digit. */
export class InvalidNitDvException extends DomainError {
  constructor() {
    super('INVALID_NIT_DV', 'NIT and verification digit do not match.');
  }
}

/** Company profile is required before fiscal operations can run. */
export class CompanyNotConfiguredException extends DomainError {
  constructor() {
    super(
      'COMPANY_NOT_CONFIGURED',
      'Company profile is required before fiscal operations can run.',
    );
  }
}

/** Submit failed because the terminal is offline. */
export class CompanySubmitOfflineException extends DomainError {
  constructor() {
    super('COMPANY_SUBMIT_OFFLINE', 'Company submit requires connectivity.');
  }
}

/** Server rejected the company profile payload (validation or conflict). */
export class CompanySubmitRejectedException extends DomainError {
  constructor() {
    super('COMPANY_SUBMIT_REJECTED', 'Server rejected the company profile.');
  }
}

/** A DANE municipio code was provided but does not exist in the catalog. */
export class InvalidMunicipioCodeException extends DomainError {
  constructor() {
    super(
      'MUNICIPIO_CODE_INVALID',
      'The DANE municipio code is not a valid code.',
    );
  }
}