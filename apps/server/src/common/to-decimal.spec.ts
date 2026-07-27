// Mock @pharmacy/database before any imports that depend on it.
// Mirrors the MockDecimal used in sync-operation-dispatcher.service.spec.ts
// and sales.service.spec.ts so the helper sees a decimal.js-like
// constructor (constructor(value) -> this.value) without pulling in the
// real @prisma/client runtime. The constructor mimics real decimal.js
// behavior for non-numeric input — it throws, which is the exact failure
// mode the toDecimal helper guards against.
jest.mock('@pharmacy/database', () => {
  class MockDecimal {
    constructor(public value: any) {
      if (typeof value === 'string' && value !== '' && Number.isNaN(Number(value))) {
        throw new Error(`[DecimalError] Invalid argument: ${value}`);
      }
    }
    toString() { return String(this.value); }
  }
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient, Prisma: { Decimal: MockDecimal } };
});

import { toDecimal } from './to-decimal';
import { Prisma } from '@pharmacy/database';

describe('toDecimal', () => {
  describe('valid inputs', () => {
    it('returns a Decimal equal to 123.45 for a string "123.45"', () => {
      const result = toDecimal('123.45', { fieldName: 'x' });

      expect(result).toBeInstanceOf(Prisma.Decimal);
      expect(result.value).toBe('123.45');
    });

    it('returns a Decimal equal to 0 for the number 0', () => {
      const result = toDecimal(0, { fieldName: 'x' });

      expect(result).toBeInstanceOf(Prisma.Decimal);
      expect(result.value).toBe(0);
    });
  });

  describe('missing values', () => {
    it('throws a domain exception carrying SYNC_PAYLOAD_VALIDATION when value is undefined', () => {
      let caught: unknown;
      try {
        toDecimal(undefined, { fieldName: 'x' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect((caught as any).errorCode).toBe('SYNC_PAYLOAD_VALIDATION');
      expect((caught as any).message).toContain('x');
    });

    it('throws the same domain exception when value is null', () => {
      let caught: unknown;
      try {
        toDecimal(null, { fieldName: 'x' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect((caught as any).errorCode).toBe('SYNC_PAYLOAD_VALIDATION');
      expect((caught as any).message).toContain('x');
    });

    it('returns a Decimal equal to 0 when value is undefined and allowMissing is true', () => {
      const result = toDecimal(undefined, { fieldName: 'x', allowMissing: true });

      expect(result).toBeInstanceOf(Prisma.Decimal);
      expect(result.value).toBe(0);
    });
  });

  describe('non-finite numbers', () => {
    it('throws the same domain exception when value is NaN', () => {
      let caught: unknown;
      try {
        toDecimal(NaN, { fieldName: 'x' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect((caught as any).errorCode).toBe('SYNC_PAYLOAD_VALIDATION');
      expect((caught as any).message).toContain('x');
    });
  });

  describe('non-numeric strings', () => {
    it('throws the same domain exception when value is a non-numeric string', () => {
      let caught: unknown;
      try {
        toDecimal('not a number', { fieldName: 'x' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect((caught as any).errorCode).toBe('SYNC_PAYLOAD_VALIDATION');
      expect((caught as any).message).toContain('x');
    });
  });
});
