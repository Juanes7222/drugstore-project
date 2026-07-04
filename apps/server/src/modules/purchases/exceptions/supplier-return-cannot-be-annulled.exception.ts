import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class SupplierReturnCannotBeAnnulledException extends DomainException {
  constructor(returnId: string) {
    super(
      'SUPPLIER_RETURN_CANNOT_BE_ANNULLED',
      `Supplier return ${returnId} cannot be annulled because stock has already left. Only DRAFT returns can be annulled.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
