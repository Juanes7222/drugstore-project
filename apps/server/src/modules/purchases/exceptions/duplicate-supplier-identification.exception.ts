import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class DuplicateSupplierIdentificationException extends DomainException {
  constructor(identificationType: string, identificationNumber: string) {
    super(
      'DUPLICATE_SUPPLIER_IDENTIFICATION',
      `Supplier with identification type ${identificationType} and number ${identificationNumber} already exists.`,
      HttpStatus.CONFLICT,
    );
  }
}
