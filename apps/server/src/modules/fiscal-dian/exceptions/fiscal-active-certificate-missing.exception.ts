import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when a flow requires the tenant's ACTIVE DIAN certificate
 * (e.g. numbering-range sync) but no ACTIVE FiscalCertificate row exists.
 * Distinct from FiscalCertificateNotFoundException, which refers to one
 * specific certificate id.
 */
export class FiscalActiveCertificateMissingException extends DomainException {
  constructor() {
    super(
      'FISCAL_ACTIVE_CERTIFICATE_MISSING',
      'No ACTIVE DIAN certificate uploaded — upload one via POST /fiscal-dian/certificates before syncing resolutions',
      HttpStatus.CONFLICT,
    );
  }
}
