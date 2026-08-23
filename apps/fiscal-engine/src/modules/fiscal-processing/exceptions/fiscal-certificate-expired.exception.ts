import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception';

/**
 * Thrown when the tenant's ACTIVE DIAN certificate has already expired at
 * transmission time. The document stays PENDING_SIGNATURE (the claim never
 * runs), so renewing the certificate via the POS lets BullMQ retries
 * transmit the queued documents without regeneration.
 */
export class FiscalCertificateExpiredException extends DomainException {
  constructor(alias: string, validTo: Date, subscriptionId: string) {
    super(
      'FISCAL_CERTIFICATE_EXPIRED',
      `Fiscal certificate "${alias}" expired on ${validTo.toISOString()} ` +
        `for subscription ${subscriptionId} — renew it from the POS ` +
        `(POST /fiscal-dian/certificates) before transmission can resume.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}