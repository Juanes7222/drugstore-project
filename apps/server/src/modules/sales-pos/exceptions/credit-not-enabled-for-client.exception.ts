import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class CreditNotEnabledForClientException extends DomainException {
  constructor(clientId: string) {
    super(
      'CREDIT_NOT_ENABLED_FOR_CLIENT',
      `Client ${clientId} has no credit limit configured.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
