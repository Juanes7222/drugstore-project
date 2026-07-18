import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';
import { PurchaseReceptionNotConfirmedException } from './purchase-reception-not-confirmed.exception';

describe('PurchaseReceptionNotConfirmedException', () => {
  it('extends DomainException', () => {
    const exception = new PurchaseReceptionNotConfirmedException('pr-1');

    expect(exception).toBeInstanceOf(DomainException);
  });

  it('has PURCHASE_RECEPTION_NOT_CONFIRMED error code and BAD_REQUEST status', () => {
    const exception = new PurchaseReceptionNotConfirmedException('pr-1');

    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(exception.message).toContain('pr-1');
    expect(exception.message).toContain('not in CONFIRMED');
  });

  it('includes the reception id in the message', () => {
    const exception = new PurchaseReceptionNotConfirmedException('my-reception-99');

    expect(exception.message).toContain('my-reception-99');
    expect(exception.message).toContain('cannot be annulled');
  });
});
