import { XMLParser } from 'fast-xml-parser';
import { SoapEnvelopeBuilder } from './soap-envelope.builder';

function parseXml(xml: string): any {
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
  return parser.parse(xml);
}

describe('SoapEnvelopeBuilder', () => {
  let builder: SoapEnvelopeBuilder;

  beforeEach(() => {
    builder = new SoapEnvelopeBuilder();
  });

  describe('buildSendBillSync', () => {
    it('wraps the operation in a SOAP 1.2 envelope with an empty header', () => {
      const xml = builder.buildSendBillSync('FV-DEMO-001.xml', 'BASE64CONTENT');

      const parsed = parseXml(xml);
      expect(parsed['soap:Envelope']['@_xmlns:soap'])
        .toBe('http://www.w3.org/2003/05/soap-envelope');
      expect(parsed['soap:Envelope']['soap:Header']).toBe('');
      expect(parsed['soap:Envelope']['soap:Body']['wcf:SendBillSync'])
        .toEqual(expect.objectContaining({
          'wcf:fileName': 'FV-DEMO-001.xml',
          'wcf:contentFile': 'BASE64CONTENT',
        }));
    });

    it('escapes XML metacharacters in the file name', () => {
      const xml = builder.buildSendBillSync('FV-DEMO-<1>&"x".xml', 'C');

      const parsed = parseXml(xml);
      expect(parsed['soap:Envelope']['soap:Body']['wcf:SendBillSync']['wcf:fileName'])
        .toBe('FV-DEMO-<1>&"x".xml');
    });
  });

  describe('buildGetNumberingRangeByTaxId', () => {
    it('sends the taxpayer NIT in both account fields per Annex §7.15', () => {
      const xml = builder.buildGetNumberingRangeByTaxId('999690829', '999690829');

      const parsed = parseXml(xml);
      const op = parsed['soap:Envelope']['soap:Body']['wcf:GetNumberingRange'];
      expect(op['wcf:accountCode']).toBe('999690829');
      expect(op['wcf:accountCodeT']).toBe('999690829');
      expect(op['wcf:softwareCode']).toBe('');
    });

    it('carries an explicit software code when given', () => {
      const xml = builder.buildGetNumberingRangeByTaxId(
        '900123456',
        '900123456',
        'e26828e4-f284-4ed',
      );

      const parsed = parseXml(xml);
      const op = parsed['soap:Envelope']['soap:Body']['wcf:GetNumberingRange'];
      expect(op['wcf:softwareCode']).toBe('e26828e4-f284-4ed');
    });

    it('escapes XML metacharacters in the identifiers', () => {
      const xml = builder.buildGetNumberingRangeByTaxId('9<0&0>', '9<0&0>');

      const parsed = parseXml(xml);
      const op = parsed['soap:Envelope']['soap:Body']['wcf:GetNumberingRange'];
      expect(op['wcf:accountCode']).toBe('9<0&0>');
    });
  });

  describe('buildGetStatus', () => {
    it('places the track id in the body', () => {
      const xml = builder.buildGetStatus('cufe-track-id');

      const parsed = parseXml(xml);
      expect(parsed['soap:Envelope']['soap:Body']['wcf:GetStatus']['wcf:trackId'])
        .toBe('cufe-track-id');
    });
  });
});
