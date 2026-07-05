import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when a sync operation's computed payload hash does not match the
 * `payloadHash` declared by the client, indicating corruption or tampering.
 */
export class PayloadHashMismatchException extends DomainException {
  constructor(operationUuid: string) {
    super(
      'PAYLOAD_HASH_MISMATCH',
      `Payload hash mismatch for operation "${operationUuid}"`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
