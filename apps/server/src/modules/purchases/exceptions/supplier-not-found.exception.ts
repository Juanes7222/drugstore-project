import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class SupplierNotFoundException extends DomainException {
  constructor(supplierId: string) {
    super(
      'SUPPLIER_NOT_FOUND',
      `Supplier with ID ${supplierId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
