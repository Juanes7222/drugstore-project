import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class SupplierReturnLotCostUnavailableException extends DomainException {
  constructor(lotId: string) {
    super(
      'SUPPLIER_RETURN_LOT_COST_UNAVAILABLE',
      `Cannot determine unit cost for lot ${lotId}. No purchase reception item with cost information found.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
