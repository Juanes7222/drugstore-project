import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception';

/**
 * Thrown when DIAN's GetNumberingRange responds with an OperationCode other
 * than 100 (Technical Annex §7.15.3): 301 no ranges for the NIT, 302/303
 * software-code mismatch, 401 not authorized, 500 service error. The
 * operationCode is carried structurally so the worker can translate it into
 * a stable NumberingRangeSyncErrorCode for the server.
 */
export class DianNumberingRangeOperationException extends DomainException {
  constructor(
    readonly operationCode: string,
    readonly operationDescription: string,
  ) {
    super(
      'DIAN_NUMBERING_RANGE_OPERATION_FAILED',
      `DIAN GetNumberingRange failed with OperationCode ${operationCode}: ${operationDescription}`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}
