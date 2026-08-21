import { FiscalCertificateCryptoService } from './fiscal-certificate-crypto.service';
import {
  FISCAL_CERTIFICATE_KEK_ENV,
  CURRENT_KEK_VERSION,
} from './fiscal-certificate-crypto.service';

const BUNDLE = {
  p12Base64: Buffer.from('fake-p12-bytes').toString('base64'),
  password: 'test-password',
  softwareSecurityCode: 'abcdef0123456789abcdef0123456789abcdef0123456789ab',
};

describe('FiscalCertificateCryptoService', () => {
  let service: FiscalCertificateCryptoService;

  beforeEach(() => {
    process.env[FISCAL_CERTIFICATE_KEK_ENV] = Buffer.alloc(32, 1).toString(
      'base64',
    );
    service = new FiscalCertificateCryptoService();
  });

  afterEach(() => {
    delete process.env[FISCAL_CERTIFICATE_KEK_ENV];
  });

  describe('encryptBundle / decryptBundle', () => {
    it('round-trips an identical bundle', () => {
      const { encryptedBundle } = service.encryptBundle(BUNDLE);

      expect(service.decryptBundle(encryptedBundle)).toEqual(BUNDLE);
    });

    it('returns a different ciphertext on every encryption of the same bundle', () => {
      const first = service.encryptBundle(BUNDLE);
      const second = service.encryptBundle(BUNDLE);

      expect(first.encryptedBundle).not.toEqual(second.encryptedBundle);
      expect(service.decryptBundle(second.encryptedBundle)).toEqual(BUNDLE);
    });

    it('reports keyVersion v1', () => {
      const { keyVersion } = service.encryptBundle(BUNDLE);

      expect(keyVersion).toBe(CURRENT_KEK_VERSION);
      expect(keyVersion).toBe('v1');
    });
  });

  describe('KEK handling', () => {
    it('throws when FISCAL_CERTIFICATE_KEK_BASE64 is missing', () => {
      delete process.env[FISCAL_CERTIFICATE_KEK_ENV];

      expect(() => service.encryptBundle(BUNDLE)).toThrow(
        'Missing FISCAL_CERTIFICATE_KEK_BASE64',
      );
      expect(() => service.decryptBundle(Buffer.alloc(64))).toThrow(
        'Missing FISCAL_CERTIFICATE_KEK_BASE64',
      );
    });

    it('throws when the KEK does not decode to 32 bytes', () => {
      process.env[FISCAL_CERTIFICATE_KEK_ENV] = Buffer.alloc(16, 2).toString(
        'base64',
      );

      expect(() => service.encryptBundle(BUNDLE)).toThrow(
        'must decode to exactly 32 bytes',
      );
    });
  });

  describe('decryptBundle tampering', () => {
    it('throws on a truncated ciphertext', () => {
      expect(() => service.decryptBundle(Buffer.from('too-short'))).toThrow(
        'Encrypted certificate bundle is truncated',
      );
    });

    it('throws on a forged ciphertext byte', () => {
      const { encryptedBundle } = service.encryptBundle(BUNDLE);
      const tampered = Buffer.from(encryptedBundle);
      tampered[tampered.length - 1] ^= 0xff;

      expect(() => service.decryptBundle(tampered)).toThrow();
    });

    it('throws on a forged auth tag', () => {
      const { encryptedBundle } = service.encryptBundle(BUNDLE);
      const tampered = Buffer.from(encryptedBundle);
      tampered[16] ^= 0x01;

      expect(() => service.decryptBundle(tampered)).toThrow();
    });
  });
});
