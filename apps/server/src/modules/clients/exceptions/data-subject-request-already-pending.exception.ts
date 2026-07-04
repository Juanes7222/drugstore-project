import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class DataSubjectRequestAlreadyPendingException extends DomainException {
  constructor(clientId: string) {
    super(
      'DATA_SUBJECT_REQUEST_ALREADY_PENDING',
      `Client ${clientId} already has a pending data subject request`,
      HttpStatus.CONFLICT,
    );
  }
}
