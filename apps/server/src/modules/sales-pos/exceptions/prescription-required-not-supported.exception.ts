import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PrescriptionRequiredNotSupportedException extends DomainException {
  constructor(productId: string) {
    super(
      'PRESCRIPTION_REQUIRED_NOT_SUPPORTED',
      `Product ${productId} requires a prescription, which is not supported in this phase.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
