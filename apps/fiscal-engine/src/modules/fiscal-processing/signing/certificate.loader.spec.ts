import * as forge from 'node-forge';
import { CertificateLoader } from './certificate.loader';

// Dummy self-signed test certificate generated with node-forge itself —
// never a real DIAN certificate (see project testing rules).
function createDummyP12(password: string): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(2036, 0, 1);
  const attrs = [{ name: 'commonName', value: 'FARMACIA DEMO TEST' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [cert],
    password,
    { algorithm: '3des' },
  );
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}

describe('CertificateLoader', () => {
  let loader: CertificateLoader;

  beforeEach(() => {
    loader = new CertificateLoader();
  });

  describe('loadFromBuffer', () => {
    it('extracts the private key PEM, certificate PEM, and base64 DER from a p12 bundle', async () => {
      const password = 'test-password';
      const p12Buffer = createDummyP12(password);

      const result = await loader.loadFromBuffer(p12Buffer, password);

      expect(result.privateKeyPem).toContain('-----BEGIN RSA PRIVATE KEY-----');
      expect(result.publicKeyPem).toContain('-----BEGIN CERTIFICATE-----');
      // base64 DER: no PEM headers, no whitespace
      expect(result.x509CertificateBase64).not.toMatch(/-----|\\s/);
      expect(result.x509CertificateBase64.length).toBeGreaterThan(100);
    });

    it('fails with a password error for a wrong password', async () => {
      const p12Buffer = createDummyP12('right-password');

      await expect(loader.loadFromBuffer(p12Buffer, 'wrong-password')).rejects.toThrow(
        'Certificate password is incorrect',
      );
    });

    it('still reports a parse error for valid DER that is not a PKCS#12 bundle', async () => {
      // Valid DER (parses via asn1.fromDer) but not PKCS#12: must hit the
      // generic parse branch, not the wrong-password heuristic.
      const der = forge.asn1.toDer(
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
          forge.asn1.create(
            forge.asn1.Class.UNIVERSAL,
            forge.asn1.Type.INTEGER,
            false,
            '0',
          ),
        ]),
      );
      const p12Buffer = Buffer.from(der.getBytes(), 'binary');

      await expect(loader.loadFromBuffer(p12Buffer, 'any-password')).rejects.toThrow(
        'Failed to parse PKCS#12 bundle',
      );
    });

    it('rejects a buffer that is not a PKCS#12 bundle', async () => {
      await expect(
        loader.loadFromBuffer(Buffer.from('not a p12'), 'anything'),
      ).rejects.toThrow('Failed to parse PKCS#12 bundle');
    });

    it('rejects a PKCS#12 bundle whose key and certificate do not match', async () => {
      const keyA = forge.pki.rsa.generateKeyPair(1024);
      const keyB = forge.pki.rsa.generateKeyPair(1024);
      const certB = forge.pki.createCertificate();
      certB.publicKey = keyB.publicKey;
      certB.serialNumber = '03';
      certB.validity.notBefore = new Date();
      certB.validity.notAfter = new Date(2036, 0, 1);
      const attrs = [{ name: 'commonName', value: 'FARMACIA DEMO TEST' }];
      certB.setSubject(attrs);
      certB.setIssuer(attrs);
      certB.sign(keyB.privateKey, forge.md.sha256.create());

      // Bundle carries keyA but the only certificate is signed with keyB:
      // the modulus comparison finds no matching pair.
      const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
        keyA.privateKey,
        [certB],
        'test-password',
      );
      const p12Buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');

      await expect(loader.loadFromBuffer(p12Buffer, 'test-password')).rejects.toThrow(
        'No matching private-key / certificate pair found',
      );
    });

    it('rejects a PKCS#12 bundle that contains no private key bags', async () => {
      const keys = forge.pki.rsa.generateKeyPair(1024);
      const cert = forge.pki.createCertificate();
      cert.publicKey = keys.publicKey;
      cert.serialNumber = '02';
      cert.validity.notBefore = new Date();
      cert.validity.notAfter = new Date(2036, 0, 1);
      const attrs = [{ name: 'commonName', value: 'FARMACIA DEMO TEST' }];
      cert.setSubject(attrs);
      cert.setIssuer(attrs);
      cert.sign(keys.privateKey, forge.md.sha256.create());

      const p12Asn1 = forge.pkcs12.toPkcs12Asn1(null as any, [cert], 'test-password');
      const p12Buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');

      await expect(loader.loadFromBuffer(p12Buffer, 'test-password')).rejects.toThrow(
        'PKCS#12 bundle contains no private key bags',
      );
    });
  });
});
