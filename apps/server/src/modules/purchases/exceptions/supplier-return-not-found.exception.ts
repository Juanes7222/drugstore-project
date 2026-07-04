import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class SupplierReturnNotFoundException extends DomainException {
  constructor(returnId: string) {
    super(
      'SUPPLIER_RETURN_NOT_FOUND',
      `Supplier return with ID ${returnId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
