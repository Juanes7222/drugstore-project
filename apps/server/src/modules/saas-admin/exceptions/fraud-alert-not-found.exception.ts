import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class FraudAlertNotFoundException extends DomainException {
  constructor(fraudAlertId: string) {
    super(
      'FRAUD_ALERT_NOT_FOUND',
      `Fraud alert with ID ${fraudAlertId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
