import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class DuplicateBarcodeException extends DomainException {
  constructor(barcode: string) {
    super(
      'DUPLICATE_BARCODE',
      `Barcode "${barcode}" already exists in the system`,
      HttpStatus.CONFLICT,
    );
  }
}
