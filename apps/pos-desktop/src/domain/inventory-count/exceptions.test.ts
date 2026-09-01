import { describe, expect, it } from 'vitest';
import {
  InventoryCountAlreadyExistsException,
  InventoryCountLineNotFoundException,
  InventoryCountNoLinesException,
  InventoryCountNotFoundException,
  InventoryCountNotReadyToCloseException,
  InventoryCountStateException,
} from './exceptions';
import { DomainError } from '../../common/domain-error';

describe('InventoryCountNotFoundException', () => {
  it('carries INVENTORY_COUNT_NOT_FOUND errorCode', () => {
    const e = new InventoryCountNotFoundException('sess-1');

    expect(e).toBeInstanceOf(DomainError);
    expect(e.errorCode).toBe('INVENTORY_COUNT_NOT_FOUND');
  });

  it('includes the session id in the message', () => {
    const e = new InventoryCountNotFoundException('sess-123');

    expect(e.message).toContain('sess-123');
  });
});

describe('InventoryCountStateException', () => {
  it('carries INVENTORY_COUNT_STATE_INVALID errorCode', () => {
    const e = new InventoryCountStateException('sess-1', 'DRAFT', 'IN_PROGRESS');

    expect(e.errorCode).toBe('INVENTORY_COUNT_STATE_INVALID');
  });

  it('includes session id, current and expected states', () => {
    const e = new InventoryCountStateException('sess-99', 'CLOSED', 'IN_REVIEW');

    expect(e.message).toContain('sess-99');
    expect(e.message).toContain('CLOSED');
    expect(e.message).toContain('IN_REVIEW');
  });
});

describe('InventoryCountLineNotFoundException', () => {
  it('carries INVENTORY_COUNT_LINE_NOT_FOUND errorCode', () => {
    const e = new InventoryCountLineNotFoundException('line-1');

    expect(e.errorCode).toBe('INVENTORY_COUNT_LINE_NOT_FOUND');
  });

  it('includes the line id', () => {
    const e = new InventoryCountLineNotFoundException('line-abc');

    expect(e.message).toContain('line-abc');
  });
});

describe('InventoryCountAlreadyExistsException', () => {
  it('carries INVENTORY_COUNT_ALREADY_ACTIVE errorCode', () => {
    const e = new InventoryCountAlreadyExistsException();

    expect(e.errorCode).toBe('INVENTORY_COUNT_ALREADY_ACTIVE');
  });

  it('mentions active count already in progress', () => {
    const e = new InventoryCountAlreadyExistsException();

    expect(e.message).toMatch(/already in progress/i);
  });
});

describe('InventoryCountNoLinesException', () => {
  it('carries INVENTORY_COUNT_NO_LINES errorCode', () => {
    const e = new InventoryCountNoLinesException();

    expect(e.errorCode).toBe('INVENTORY_COUNT_NO_LINES');
  });

  it('mentions snapshot is empty / check scope filters', () => {
    const e = new InventoryCountNoLinesException();

    expect(e.message).toMatch(/snapshot is empty/i);
  });
});

describe('InventoryCountNotReadyToCloseException', () => {
  it('carries INVENTORY_COUNT_NOT_READY_TO_CLOSE errorCode', () => {
    const e = new InventoryCountNotReadyToCloseException('some reason');

    expect(e.errorCode).toBe('INVENTORY_COUNT_NOT_READY_TO_CLOSE');
  });

  it('preserves the reason as message', () => {
    const reason = '3 line(s) still pending';
    const e = new InventoryCountNotReadyToCloseException(reason);

    expect(e.message).toBe(reason);
  });

  it('is instance of DomainError', () => {
    const e = new InventoryCountNotReadyToCloseException('reason');

    expect(e).toBeInstanceOf(DomainError);
  });
});
