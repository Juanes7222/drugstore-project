import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class ClientReturnNotDraftException extends DomainException {
  constructor(returnId: string) {
    super(
      'CLIENT_RETURN_NOT_DRAFT',
      `Client return ${returnId} is not in DRAFT or PENDING_PICKUP state.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
