import { createCipheriv } from 'node:crypto';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

// The Prisma 7 client is generated at build time; keep the real package out
// of the module graph so the spec can run without the generated client.
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { DbCertificateSecretReaderAdapter } from './db-certificate-secret-reader.adapter';
import { FiscalCertificateExpiredException } from '../exceptions/fiscal-certificate-expired.exception';

const KEK_ENV_VAR = 'FISCAL_CERTIFICATE_KEK_BASE64';

// Envelope format shared with apps/server's FiscalCertificateCryptoService:
// [iv(12) | authTag(16) | ciphertext] over JSON under AES-256-GCM. The test
// encrypts with node:crypto directly using the same env KEK the server uses.
function encryptBundleWithKek(bundle: {
  p12Base64: string;
  password: string;
  softwareSecurityCode: string;
}): Buffer {
  const kek = Buffer.from(process.env[KEK_ENV_VAR] as string, 'base64');
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(bundle), 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

const BUNDLE = {
  p12Base64: Buffer.from('fake-p12-bytes').toString('base64'),
  password: 'test-password',
  softwareSecurityCode: 'abcdef0123456789abcdef0123456789abcdef0123456789ab',
};

describe('DbCertificateSecretReaderAdapter', () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let adapter: DbCertificateSecretReaderAdapter;

  beforeAll(() => {
    process.env[KEK_ENV_VAR] = Buffer.alloc(32, 1).toString('base64');
  });

  afterAll(() => {
    delete process.env[KEK_ENV_VAR];
  });

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    adapter = new DbCertificateSecretReaderAdapter(prisma as any);
  });

  describe('readSecret', () => {
    it('reads the ACTIVE certificate for the subscription and decrypts its bundle', async () => {
      const encryptedBundle = encryptBundleWithKek(BUNDLE);
      (prisma.fiscalCertificate.findFirst as jest.Mock).mockResolvedValue({
        encryptedBundle,
        alias: 'DIAN Firma 2026',
        validTo: new Date('2027-01-01T00:00:00.000Z'),
      });

      const result = await adapter.readSecret('sub-1', 'file:ignored.json');

      expect(prisma.fiscalCertificate.findFirst).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1', status: 'ACTIVE' },
        orderBy: { validTo: 'desc' },
        select: {
          encryptedBundle: true,
          alias: true,
          validTo: true,
        },
      });
      expect(result).toEqual({
        certificate: Buffer.from('fake-p12-bytes'),
        password: 'test-password',
        softwareSecurityCode: BUNDLE.softwareSecurityCode,
      });
    });

    it('throws when no ACTIVE certificate exists for the subscription', async () => {
      (prisma.fiscalCertificate.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(adapter.readSecret('sub-1', 'file:ignored.json')).rejects.toThrow(
        'No ACTIVE fiscal certificate for subscription sub-1',
      );
    });

    it('throws FiscalCertificateExpiredException before decrypting when the ACTIVE certificate is expired', async () => {
      // Truncated bundle: if the expiry gate were missing, decryption would
      // throw 'Encrypted certificate bundle is truncated' instead.
      (prisma.fiscalCertificate.findFirst as jest.Mock).mockResolvedValue({
        encryptedBundle: Buffer.alloc(5),
        alias: 'DIAN Firma 2025',
        validTo: new Date('2025-01-01T00:00:00.000Z'),
      });

      await expect(adapter.readSecret('sub-1', 'file:ignored.json')).rejects.toThrow(
        FiscalCertificateExpiredException,
      );
    });

    it('throws when the certificate expires exactly at the moment of resolution', async () => {
      const expiredNow = new Date();
      (prisma.fiscalCertificate.findFirst as jest.Mock).mockResolvedValue({
        encryptedBundle: Buffer.alloc(5),
        alias: 'DIAN Firma 2025',
        validTo: expiredNow,
      });

      await expect(adapter.readSecret('sub-1', 'file:ignored.json')).rejects.toThrow(
        FiscalCertificateExpiredException,
      );
    });

    it('throws when the KEK env var is missing', async () => {
      const encryptedBundle = encryptBundleWithKek(BUNDLE);
      (prisma.fiscalCertificate.findFirst as jest.Mock).mockResolvedValue({
        encryptedBundle,
        alias: 'DIAN Firma 2026',
        validTo: new Date('2027-01-01T00:00:00.000Z'),
      });
      delete process.env[KEK_ENV_VAR];

      await expect(adapter.readSecret('sub-1', 'file:ignored.json')).rejects.toThrow(
        'Missing FISCAL_CERTIFICATE_KEK_BASE64',
      );
    });
  });
});