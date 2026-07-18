import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';
import { FiscalDocumentNotFoundException } from './fiscal-document-not-found.exception';

describe('FiscalDocumentNotFoundException', () => {
  it('extends DomainException', () => {
    const exception = new FiscalDocumentNotFoundException('fd-1');

    expect(exception).toBeInstanceOf(DomainException);
  });

  it('has FISCAL_DOCUMENT_NOT_FOUND error code and NOT_FOUND status', () => {
    const exception = new FiscalDocumentNotFoundException('fd-1');

    expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(exception.message).toContain('fd-1');
    expect(exception.message).toContain('not found');
  });

  it('includes the document id in the message', () => {
    const exception = new FiscalDocumentNotFoundException('custom-id-42');

    expect(exception.message).toContain('custom-id-42');
  });
});
