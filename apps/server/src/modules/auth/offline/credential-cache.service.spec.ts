import { CredentialCacheService, DecryptedCredentialBlob } from './credential-cache.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGenerateCvkParams(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-uuid-1',
    passwordHash: '$argon2id$v=19$hashvalue123',
    pinHash: '$argon2id$v=19$pinvalue456',
    workstationFingerprint: 'fp-abc123def456',
    expiresAt: new Date('2026-12-31T23:59:59Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CredentialCacheService', () => {
  let service: CredentialCacheService;

  beforeEach(() => {
    service = new CredentialCacheService();
  });

  // -----------------------------------------------------------------------
  // generateCvk
  // -----------------------------------------------------------------------
  describe('generateCvk', () => {
    it('returns an encrypted blob with correct structure', async () => {
      const params = buildGenerateCvkParams();
      const result = await service.generateCvk(params);

      expect(result).toMatchObject({
        encryptedBlob: expect.any(String),
        keyFingerprint: expect.any(String),
        version: 1,
      });

      // Blob format: keyIv:keyCiphertext:keyTag:payloadIv:payloadCiphertext:payloadTag
      const parts = result.encryptedBlob.split(':');
      expect(parts).toHaveLength(6);
      // All parts should be non-empty base64
      for (const part of parts) {
        expect(part).toMatch(/^[A-Za-z0-9+/=]+$/);
      }
    });

    it('returns unique blobs for different workstations', async () => {
      const params = buildGenerateCvkParams();
      const result1 = await service.generateCvk(params);
      const result2 = await service.generateCvk({
        ...params,
        workstationFingerprint: 'fp-xyz789ghi012',
      });

      expect(result1.encryptedBlob).not.toBe(result2.encryptedBlob);
      expect(result1.keyFingerprint).not.toBe(result2.keyFingerprint);
    });

    it('returns unique blobs for the same workstation (randomized ephemeral key)', async () => {
      const params = buildGenerateCvkParams();
      const result1 = await service.generateCvk(params);
      const result2 = await service.generateCvk(params);

      // Ephemeral key is random each time, so blobs should differ
      expect(result1.encryptedBlob).not.toBe(result2.encryptedBlob);
      expect(result1.keyFingerprint).not.toBe(result2.keyFingerprint);
    });

    it('has the correct version number', async () => {
      const result = await service.generateCvk(buildGenerateCvkParams());

      expect(result.version).toBe(1);
    });

    it('works with null passwordHash (PIN-only user)', async () => {
      const params = buildGenerateCvkParams({ passwordHash: null });
      const result = await service.generateCvk(params);

      expect(result.encryptedBlob).toBeTruthy();
      expect(result.version).toBe(1);
    });

    it('works with null pinHash (password-only user)', async () => {
      const params = buildGenerateCvkParams({ pinHash: null });
      const result = await service.generateCvk(params);

      expect(result.encryptedBlob).toBeTruthy();
    });

    it('includes expiresAt in the encrypted payload', async () => {
      const expiresAt = new Date('2027-06-15T12:00:00Z');
      const params = buildGenerateCvkParams({ expiresAt });
      const result = await service.generateCvk(params);

      // Decrypt to verify expiresAt is preserved
      const decrypted = service.decryptCvk(
        result.encryptedBlob,
        params.workstationFingerprint,
      );

      expect(decrypted).not.toBeNull();
      expect(decrypted!.expiresAt).toBe(expiresAt.toISOString());
    });
  });

  // -----------------------------------------------------------------------
  // decryptCvk
  // -----------------------------------------------------------------------
  describe('decryptCvk', () => {
    it('correctly decrypts a CVK blob', async () => {
      const params = buildGenerateCvkParams();
      const generated = await service.generateCvk(params);

      const decrypted = service.decryptCvk(
        generated.encryptedBlob,
        params.workstationFingerprint,
      );

      expect(decrypted).not.toBeNull();
      expect(decrypted!.userId).toBe(params.userId);
      expect(decrypted!.passwordHash).toBe(params.passwordHash);
      expect(decrypted!.pinHash).toBe(params.pinHash);
      expect(decrypted!.version).toBe(1);
      expect(decrypted!.expiresAt).toBe(params.expiresAt.toISOString());
    });

    it('returns null for wrong workstation fingerprint', async () => {
      const params = buildGenerateCvkParams();
      const generated = await service.generateCvk(params);

      const decrypted = service.decryptCvk(
        generated.encryptedBlob,
        'wrong-fingerprint',
      );

      expect(decrypted).toBeNull();
    });

    it('returns null for tampered blob (modified ciphertext)', async () => {
      const params = buildGenerateCvkParams();
      const generated = await service.generateCvk(params);

      // Tamper with the payload ciphertext part
      const parts = generated.encryptedBlob.split(':');
      parts[4] = parts[4].replace(/^.{4}/, 'AAAA'); // Corrupt payload ciphertext
      const tamperedBlob = parts.join(':');

      const decrypted = service.decryptCvk(tamperedBlob, params.workstationFingerprint);

      expect(decrypted).toBeNull();
    });

    it('returns null for invalid format (too few parts)', () => {
      const result = service.decryptCvk('too:few:parts', 'fp-anything');
      expect(result).toBeNull();
    });

    it('returns null for totally invalid string', () => {
      const result = service.decryptCvk('not-a-valid-blob-at-all', 'fp-anything');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = service.decryptCvk('', 'fp-anything');
      expect(result).toBeNull();
    });

    it('returns null when the encryptedKey parts are tampered', async () => {
      const params = buildGenerateCvkParams();
      const generated = await service.generateCvk(params);

      // Tamper with the key ciphertext
      const parts = generated.encryptedBlob.split(':');
      parts[1] = parts[1].replace(/^.{4}/, 'BBBB'); // Corrupt key ciphertext

      // The auth tag will also be invalid after this change
      const tamperedBlob = parts.join(':');

      const decrypted = service.decryptCvk(tamperedBlob, params.workstationFingerprint);

      expect(decrypted).toBeNull();
    });

    it('returns null when auth tag is modified', async () => {
      const params = buildGenerateCvkParams();
      const generated = await service.generateCvk(params);

      // Tamper with the payload auth tag
      const parts = generated.encryptedBlob.split(':');
      parts[5] = parts[5].replace(/^.{4}/, 'CCCC'); // Corrupt payload tag
      const tamperedBlob = parts.join(':');

      const decrypted = service.decryptCvk(tamperedBlob, params.workstationFingerprint);

      expect(decrypted).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getCurrentVersion
  // -----------------------------------------------------------------------
  describe('getCurrentVersion', () => {
    it('returns the current version number', () => {
      expect(service.getCurrentVersion()).toBe(1);
    });
  });
});
