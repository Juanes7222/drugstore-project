import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when an uploaded certificate bundle cannot be parsed or does not
 * pass the PKCS#12 integrity check (wrong password, corrupt file, missing
 * key pair). The bundle is rejected before anything touches the database.
 */
export class FiscalCertificateInvalidException extends DomainException {
  constructor(reason: string) {
    super(
      'FISCAL_CERTIFICATE_INVALID',
      `Fiscal certificate is invalid: ${reason}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
