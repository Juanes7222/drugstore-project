import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class SupplierReturnNotDraftException extends DomainException {
  constructor(returnId: string, expectedState: string) {
    super(
      'SUPPLIER_RETURN_NOT_DRAFT',
      `Supplier return ${returnId} is not in ${expectedState} state.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
