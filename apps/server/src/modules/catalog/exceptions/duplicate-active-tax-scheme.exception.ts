import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class DuplicateActiveTaxSchemeException extends DomainException {
  constructor(code: string, rate: string) {
    super(
      'DUPLICATE_ACTIVE_TAX_SCHEME',
      `An active tax scheme already exists for code "${code}" with rate ${rate}`,
      HttpStatus.CONFLICT,
    );
  }
}
