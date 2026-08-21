import * as forge from 'node-forge';
import { FiscalCertificateParser } from './fiscal-certificate.parser';

// Dummy self-signed test certificate generated with node-forge itself —
// never a real DIAN certificate (see project testing rules).
function createDummyP12(password: string): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(2026, 0, 1);
  cert.validity.notAfter = new Date(2036, 0, 1);
  const attrs = [{ name: 'commonName', value: 'FARMACIA DEMO TEST' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: '3des',
  });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}

describe('FiscalCertificateParser', () => {
  let parser: FiscalCertificateParser;

  beforeEach(() => {
    parser = new FiscalCertificateParser();
  });

  describe('parseMetadata', () => {
    it('extracts subject, issuer, serial number, and validity from a p12 bundle', () => {
      const p12Buffer = createDummyP12('test-password');

      const metadata = parser.parseMetadata(p12Buffer, 'test-password');

      expect(metadata.subjectCn).toBe('FARMACIA DEMO TEST');
      expect(metadata.issuerCn).toBe('FARMACIA DEMO TEST');
      expect(metadata.serialNumber).toBe('01');
      expect(metadata.validFrom).toEqual(new Date(2026, 0, 1));
      expect(metadata.validTo).toEqual(new Date(2036, 0, 1));
    });

    it('throws a password error for a wrong password', () => {
      const p12Buffer = createDummyP12('right-password');

      expect(() => parser.parseMetadata(p12Buffer, 'wrong-password')).toThrow(
        'Certificate password is incorrect',
      );
    });

    it('throws on a garbage buffer', () => {
      expect(() =>
        parser.parseMetadata(Buffer.from('not a p12 bundle'), 'anything'),
      ).toThrow('Failed to parse PKCS#12 bundle');
    });

    it('throws on valid DER that is not a PKCS#12 bundle', () => {
      const der = forge.asn1.toDer(
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.SEQUENCE,
          true,
          [
            forge.asn1.create(
              forge.asn1.Class.UNIVERSAL,
              forge.asn1.Type.INTEGER,
              false,
              '0',
            ),
          ],
        ),
      );

      expect(() =>
        parser.parseMetadata(
          Buffer.from(der.getBytes(), 'binary'),
          'any-password',
        ),
      ).toThrow('Failed to parse PKCS#12 bundle');
    });
  });
});
