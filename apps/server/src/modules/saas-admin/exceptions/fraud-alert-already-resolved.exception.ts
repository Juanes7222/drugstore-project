import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class FraudAlertAlreadyResolvedException extends DomainException {
  constructor(fraudAlertId: string) {
    super(
      'FRAUD_ALERT_ALREADY_RESOLVED',
      `Fraud alert with ID ${fraudAlertId} is already resolved`,
      HttpStatus.CONFLICT,
    );
  }
}
