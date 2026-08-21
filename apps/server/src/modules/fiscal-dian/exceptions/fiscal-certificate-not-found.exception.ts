import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when a fiscal certificate id does not exist in the tenant.
 */
export class FiscalCertificateNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'FISCAL_CERTIFICATE_NOT_FOUND',
      `Fiscal certificate ${id} was not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
