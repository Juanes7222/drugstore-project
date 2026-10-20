import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { SignatureService } from './signature.service';

const TELEMETRY_SECRET = 'telemetry-secret-value-with-32-chars-min';
const BINARY_SECRET = 'binary-secret-value-with-32-chars-min!!';

function buildService(binarySecret = BINARY_SECRET): SignatureService {
  const configService = {
    getOrThrow: (key: string) => {
      if (key === 'UPDATE_TELEMETRY_HMAC_SECRET') return TELEMETRY_SECRET;
      if (key === 'UPDATE_BINARY_SIGNING_SECRET') return binarySecret;
      throw new Error(`Unexpected config key: ${key}`);
    },
  } as unknown as ConfigService;

  return new SignatureService(configService);
}

describe('SignatureService (update binaries)', () => {
  describe('computeBinarySignature', () => {
    it('returns the HMAC-SHA256 of the content under the binary secret', () => {
      const service = buildService();

      const signature = service.computeBinarySignature(Buffer.from('installer-bytes'));

      const expected = createHmac('sha256', BINARY_SECRET)
        .update('installer-bytes')
        .digest('hex');
      expect(signature).toBe(expected);
    });

    it('is stable for the same content and secret', () => {
      const service = buildService();

      const first = service.computeBinarySignature(Buffer.from('same'));
      const second = service.computeBinarySignature(Buffer.from('same'));

      expect(first).toBe(second);
    });

    it('changes when the content changes', () => {
      const service = buildService();

      const original = service.computeBinarySignature(Buffer.from('original'));
      const tampered = service.computeBinarySignature(Buffer.from('tampered'));

      expect(original).not.toBe(tampered);
    });

    it('changes when the secret changes', () => {
      const original = buildService('secret-a-value-with-32-chars-min!!')
        .computeBinarySignature(Buffer.from('same'));
      const other = buildService('secret-b-value-with-32-chars-min!!')
        .computeBinarySignature(Buffer.from('same'));

      expect(original).not.toBe(other);
    });
  });

  describe('computeBinarySignatureFromStream', () => {
    it('matches the signature computed over the same bytes', async () => {
      const service = buildService();
      const payload = Buffer.from('a'.repeat(1000) + 'installer-bytes');

      const streamed = await service.computeBinarySignatureFromStream(
        Readable.from([payload.subarray(0, 400), payload.subarray(400)]),
      );

      expect(streamed).toBe(service.computeBinarySignature(payload));
    });
  });

  describe('matchesBinarySignature', () => {
    it('accepts two identical signatures', () => {
      const service = buildService();
      const signature = service.computeBinarySignature(Buffer.from('x'));

      expect(service.matchesBinarySignature(signature, signature)).toBe(true);
    });

    it('rejects a different signature', () => {
      const service = buildService();
      const signature = service.computeBinarySignature(Buffer.from('x'));
      const other = service.computeBinarySignature(Buffer.from('y'));

      expect(service.matchesBinarySignature(signature, other)).toBe(false);
    });

    it('rejects a malformed signature instead of throwing', () => {
      const service = buildService();
      const signature = service.computeBinarySignature(Buffer.from('x'));

      expect(service.matchesBinarySignature(signature, 'not-hex')).toBe(false);
    });
  });
});
