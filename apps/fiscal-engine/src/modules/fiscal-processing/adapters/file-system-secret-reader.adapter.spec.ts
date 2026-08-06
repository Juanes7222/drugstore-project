import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemSecretReaderAdapter } from './file-system-secret-reader.adapter';

const VALID_SECRET = {
  certificate: Buffer.from('fake-p12-bytes').toString('base64'),
  password: 'test-password',
  softwareSecurityCode: 'abcdef0123456789abcdef0123456789abcdef0123456789ab',
};

describe('FileSystemSecretReaderAdapter', () => {
  let baseDir: string;
  let adapter: FileSystemSecretReaderAdapter;
  let mockConfig: { getOrThrow: jest.Mock };

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'fiscal-engine-secrets-'));
    mockConfig = { getOrThrow: jest.fn().mockReturnValue(baseDir) };
    adapter = new FileSystemSecretReaderAdapter(mockConfig as any);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  describe('readSecret', () => {
    it('reads a file: reference relative to CERTIFICATE_BASE_DIR and decodes the certificate', async () => {
      await writeFile(
        join(baseDir, 'test-cert.json'),
        JSON.stringify(VALID_SECRET),
        'utf-8',
      );

      const result = await adapter.readSecret('file:test-cert.json');

      expect(result.certificate).toEqual(Buffer.from('fake-p12-bytes'));
      expect(result.password).toBe('test-password');
      expect(result.softwareSecurityCode).toBe(VALID_SECRET.softwareSecurityCode);
    });

    it('throws for references that are not file:-prefixed', async () => {
      await expect(adapter.readSecret('vault:secret/dian/cert')).rejects.toThrow(
        'only supports "file:"-prefixed references',
      );
    });

    it('throws when the referenced file is not valid JSON', async () => {
      await writeFile(join(baseDir, 'broken.json'), 'not json', 'utf-8');

      await expect(adapter.readSecret('file:broken.json')).rejects.toThrow(
        'is not valid JSON',
      );
    });

    it('throws when the certificate field is missing', async () => {
      await writeFile(
        join(baseDir, 'no-cert.json'),
        JSON.stringify({ password: 'x', softwareSecurityCode: 'y' }),
        'utf-8',
      );

      await expect(adapter.readSecret('file:no-cert.json')).rejects.toThrow(
        'invalid "certificate" field',
      );
    });

    it('throws when the password field is missing', async () => {
      await writeFile(
        join(baseDir, 'no-pass.json'),
        JSON.stringify({ certificate: 'aGk=', softwareSecurityCode: 'y' }),
        'utf-8',
      );

      await expect(adapter.readSecret('file:no-pass.json')).rejects.toThrow(
        'invalid "password" field',
      );
    });

    it('throws when the softwareSecurityCode field is missing', async () => {
      await writeFile(
        join(baseDir, 'no-code.json'),
        JSON.stringify({ certificate: 'aGk=', password: 'x' }),
        'utf-8',
      );

      await expect(adapter.readSecret('file:no-code.json')).rejects.toThrow(
        'invalid "softwareSecurityCode" field',
      );
    });
  });
});
