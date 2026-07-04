import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class ConcurrentStockModificationException extends DomainException {
  constructor(lotId: string) {
    super(
      'CONCURRENT_STOCK_MODIFICATION',
      `Concurrent modification detected for lot ${lotId}. Please retry the operation.`,
      HttpStatus.CONFLICT,
    );
  }
}
