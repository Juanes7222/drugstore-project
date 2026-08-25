import {
  parseNumberingRangeResult,
} from './numbering-range.parser';
import { DianNumberingRangeOperationException } from '../exceptions/dian-numbering-range-operation.exception';

/**
 * Response shape exactly as printed in DIAN's Technical Annex §7.15.3
 * (fast-xml-parser with removeNSPrefix produces this namespace-stripped form).
 */
const annexResult = {
  OperationCode: '100',
  OperationDescription: 'Acción completada OK.',
  ResponseList: {
    NumberRangeResponse: {
      ResolutionNumber: '9310000085419',
      Prefix: 'F002',
      FromNumber: '1',
      ToNumber: '99999999',
      ValidDateTimeFrom: '2017-10-02T00:00:00Z',
      ValidDateTimeTo: '2019-10-02T00:00:00Z',
      TechnicalKey: 'FC8EAC422EBA16E22FFD8C6F94B3F40A6E38162C',
    },
  },
};

describe('parseNumberingRangeResult', () => {
  it('parses the single-range Annex §7.15.3 response', () => {
    const ranges = parseNumberingRangeResult(annexResult);

    expect(ranges).toEqual([
      {
        resolutionNumber: '9310000085419',
        prefix: 'F002',
        fromNumber: 1,
        toNumber: 99999999,
        validFrom: '2017-10-02T00:00:00Z',
        validTo: '2019-10-02T00:00:00Z',
        technicalKey: 'FC8EAC422EBA16E22FFD8C6F94B3F40A6E38162C',
      },
    ]);
  });

  it('accepts a ResponseList that is already an array', () => {
    const ranges = parseNumberingRangeResult({
      OperationCode: '100',
      OperationDescription: 'Acción completada OK.',
      ResponseList: [
        { ResolutionNumber: 'R1', Prefix: 'FV1', FromNumber: '1', ToNumber: '5000', ValidDateFrom: '2030-01-01', ValidDateTo: '2032-01-01' },
        { ResolutionNumber: 'R2', Prefix: 'NS1', FromNumber: '1', ToNumber: '500', ValidDateFrom: '2030-01-01', ValidDateTo: '2032-01-01', TechnicalKey: 'K2' },
      ],
    });

    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ resolutionNumber: 'R1', prefix: 'FV1' });
    expect(ranges[1]).toMatchObject({ resolutionNumber: 'R2', technicalKey: 'K2' });
  });

  it('reads alternate field casings from other annex revisions', () => {
    const ranges = parseNumberingRangeResult({
      OperationCode: '100',
      OperationDescription: 'OK',
      ResponseList: [
        {
          resolutionNumber: 'r-lower',
          prefix: 'fv-low',
          fromNumber: '10',
          toNumber: '20',
          validDateFrom: '2030-05-05',
          validDateTo: '2033-05-05',
        },
      ],
    });

    expect(ranges).toEqual([
      expect.objectContaining({
        resolutionNumber: 'r-lower',
        prefix: 'fv-low',
        fromNumber: 10,
        toNumber: 20,
        validFrom: '2030-05-05',
        validTo: '2033-05-05',
      }),
    ]);
  });

  it('skips malformed entries while keeping the valid ones around them', () => {
    const ranges = parseNumberingRangeResult({
      OperationCode: '100',
      OperationDescription: 'OK',
      ResponseList: [
        { ResolutionNumber: 'BAD', FromNumber: '1', ToNumber: 'oops-not-a-number', ValidDateFrom: '2030-01-01', ValidDateTo: '2031-01-01' },
        { ResolutionNumber: 'GOOD', Prefix: 'F001', FromNumber: '1', ToNumber: '100', ValidDateFrom: '2030-01-01', ValidDateTo: '2031-01-01' },
        { Prefix: 'NO-NUMBER', FromNumber: '1', ToNumber: '100', ValidDateFrom: '2030-01-01', ValidDateTo: '2031-01-01' },
      ],
    });

    expect(ranges).toHaveLength(1);
    expect(ranges[0].resolutionNumber).toBe('GOOD');
  });

  it.each([
    ['301', 'No fue encontrado ningún rango de numeración'],
    ['302', 'No registra prefijos asociados al código de software'],
    ['303', 'El código del software no corresponde al NIT'],
    ['401', 'No autorizado'],
    ['500', 'Ha ocurrido un error con el servicio solicitado'],
  ])('throws carrying OperationCode %s for a non-OK response', (code, description) => {
    expect(() =>
      parseNumberingRangeResult({
        OperationCode: code,
        OperationDescription: description,
      }),
    ).toThrow(DianNumberingRangeOperationException);

    try {
      parseNumberingRangeResult({ OperationCode: code, OperationDescription: description });
    } catch (error) {
      expect((error as DianNumberingRangeOperationException).operationCode).toBe(code);
      expect((error as DianNumberingRangeOperationException).operationDescription).toBe(
        description,
      );
    }
  });

  it('treats a null result as an empty-response failure', () => {
    expect(() => parseNumberingRangeResult(null)).toThrow(
      DianNumberingRangeOperationException,
    );
  });

  it('returns an empty list for an OK response without ranges', () => {
    // OperationCode 100 with no ResponseList is legal when the taxpayer has
    // no ACTIVE prefixes — the not-habilitated signal is code 301 instead.
    const ranges = parseNumberingRangeResult({
      OperationCode: '100',
      OperationDescription: 'Acción completada OK.',
    });

    expect(ranges).toEqual([]);
  });
});
