import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class NoPendingDataSubjectRequestException extends DomainException {
  constructor(clientId: string) {
    super(
      'NO_PENDING_DATA_SUBJECT_REQUEST',
      `Client ${clientId} does not have a pending data subject request to resolve`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
