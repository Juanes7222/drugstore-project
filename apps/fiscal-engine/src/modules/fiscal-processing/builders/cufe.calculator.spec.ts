import * as crypto from 'node:crypto';
import { CufeCalculator } from './cufe.calculator';

const GOLDEN_CUFE = 'fca8593be49fe25a3a2bdc099c33775a30ddf2f7c477f9263a4c41903c5856f4858ecc7ca18a256276f8f28df938f708';

// The CUFE is SHA-384 over a documented concatenation (DIAN Technical
// Annex v1.9, section 11.2). The reference input below is built from
// the same published formula independently of the implementation, so the
// golden value guards against formula drift in CufeCalculator.
const REFERENCE_INPUT =
  'FV-DEMO-000001' +
  '2026-08-05' +
  '10:53:10-05:00' +
  '1000000.00' +
  '01' + '190000.00' +
  '04' + '0.00' +
  '03' + '0.00' +
  '1190000.00' +
  '800197268' +
  '222222222222' +
  'CLTEC-ABC-123' +
  '2';

describe('CufeCalculator', () => {
  let calculator: CufeCalculator;

  beforeEach(() => {
    calculator = new CufeCalculator();
  });

  describe('computeCufe', () => {
    it('matches the independently computed golden CUFE for a fixed document', () => {
      const cufe = calculator.computeCufe({
        fullNumber: 'FV-DEMO-000001',
        issueDate: '2026-08-05',
        issueTime: '10:53:10-05:00',
        subtotal: '1000000.00',
        taxAmounts: [
          { code: '01', amount: '190000.00' },
          { code: '04', amount: '0.00' },
          { code: '03', amount: '0.00' },
        ],
        totalAmount: '1190000.00',
        issuerNit: '800197268',
        customerId: '222222222222',
        clTec: 'CLTEC-ABC-123',
        environment: '2',
      });

      expect(cufe).toBe(GOLDEN_CUFE);
    });

    it('equals SHA-384 of the documented concatenation', () => {
      const cufe = calculator.computeCufe({
        fullNumber: 'FV-DEMO-000001',
        issueDate: '2026-08-05',
        issueTime: '10:53:10-05:00',
        subtotal: '1000000.00',
        taxAmounts: [
          { code: '01', amount: '190000.00' },
          { code: '04', amount: '0.00' },
          { code: '03', amount: '0.00' },
        ],
        totalAmount: '1190000.00',
        issuerNit: '800197268',
        customerId: '222222222222',
        clTec: 'CLTEC-ABC-123',
        environment: '2',
      });

      const expected = crypto.createHash('sha384').update(REFERENCE_INPUT).digest('hex');
      expect(cufe).toBe(expected);
    });

    it('concatenates absent taxes as their literal code plus 0.00 in fixed order 01, 04, 03', () => {
      // Only IVA is present; INC (04) and ICA (03) still contribute their
      // code literals with 0.00.
      const cufe = calculator.computeCufe({
        fullNumber: 'N1',
        issueDate: '2026-01-01',
        issueTime: '08:00:00-05:00',
        subtotal: '500000',
        taxAmounts: [{ code: '01', amount: '95000' }],
        totalAmount: '595000',
        issuerNit: '900123456',
        customerId: '900654321',
        clTec: 'K',
        environment: '2',
      });

      const input =
        'N1' + '2026-01-01' + '08:00:00-05:00' + '500000.00' +
        '01' + '95000.00' +
        '04' + '0.00' +
        '03' + '0.00' +
        '595000.00' +
        '900123456' + '900654321' + 'K' + '2';
      expect(cufe).toBe(crypto.createHash('sha384').update(input).digest('hex'));
    });

    it('accepts tax breakdowns in any order and reorders them by code', () => {
      const cufe = calculator.computeCufe({
        fullNumber: 'N1',
        issueDate: '2026-01-01',
        issueTime: '08:00:00-05:00',
        subtotal: '1000',
        taxAmounts: [
          { code: '03', amount: '10' },
          { code: '01', amount: '190' },
        ],
        totalAmount: '1200',
        issuerNit: '900123456',
        customerId: '222222222222',
        clTec: 'K',
        environment: '1',
      });

      const input =
        'N1' + '2026-01-01' + '08:00:00-05:00' + '1000.00' +
        '01' + '190.00' +
        '04' + '0.00' +
        '03' + '10.00' +
        '1200.00' +
        '900123456' + '222222222222' + 'K' + '1';
      expect(cufe).toBe(crypto.createHash('sha384').update(input).digest('hex'));
    });
  });

  describe('monetary formatting (truncate, never round)', () => {
    it('truncates more than two decimals instead of rounding', () => {
      const cufe = calculator.computeCufe({
        fullNumber: 'N1',
        issueDate: '2026-01-01',
        issueTime: '08:00:00-05:00',
        subtotal: '1500000.999',
        taxAmounts: [{ code: '01', amount: '285000.999' }],
        totalAmount: '1785000.999',
        issuerNit: '900123456',
        customerId: '222222222222',
        clTec: 'K',
        environment: '2',
      });

      const input =
        'N1' + '2026-01-01' + '08:00:00-05:00' + '1500000.99' +
        '01' + '285000.99' +
        '04' + '0.00' +
        '03' + '0.00' +
        '1785000.99' +
        '900123456' + '222222222222' + 'K' + '2';
      expect(cufe).toBe(crypto.createHash('sha384').update(input).digest('hex'));
    });

    it('pads integer values to two decimals', () => {
      const cufe = calculator.computeCufe({
        fullNumber: 'N1',
        issueDate: '2026-01-01',
        issueTime: '08:00:00-05:00',
        subtotal: '500000',
        taxAmounts: [],
        totalAmount: '500000',
        issuerNit: '900123456',
        customerId: '222222222222',
        clTec: 'K',
        environment: '2',
      });

      const input =
        'N1' + '2026-01-01' + '08:00:00-05:00' + '500000.00' +
        '01' + '0.00' +
        '04' + '0.00' +
        '03' + '0.00' +
        '500000.00' +
        '900123456' + '222222222222' + 'K' + '2';
      expect(cufe).toBe(crypto.createHash('sha384').update(input).digest('hex'));
    });
  });
});
