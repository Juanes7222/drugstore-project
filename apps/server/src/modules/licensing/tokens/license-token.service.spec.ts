// Set env before any module evaluation — the constructor reads these at instantiation time
process.env.LICENSE_TOKEN_SECRET = 'test-secret-that-is-at-least-32-characters-long!!';
process.env.LICENSE_TOKEN_TTL_SECONDS = '604800';

import * as jwt from 'jsonwebtoken';
import { LicenseTokenService } from './license-token.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-secret-that-is-at-least-32-characters-long!!';
const VALID_PAYLOAD = {
  subscriptionId: 'sub-uuid-1',
  subscriptionStatus: 'ACTIVE',
  planId: 'plan-uuid-1',
  planFeatures: ['unlimited_sales', 'inventory_management'],
  locationId: 'loc-uuid-1',
  locationName: 'Main Store',
  workstationId: 'ws-uuid-1',
  hardwareFingerprint: 'fp-abc123def456',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildExpectedTokenClaims() {
  return {
    sub: VALID_PAYLOAD.workstationId,
    subscriptionId: VALID_PAYLOAD.subscriptionId,
    subscriptionStatus: VALID_PAYLOAD.subscriptionStatus,
    planId: VALID_PAYLOAD.planId,
    planFeatures: VALID_PAYLOAD.planFeatures,
    locationId: VALID_PAYLOAD.locationId,
    locationName: VALID_PAYLOAD.locationName,
    workstationId: VALID_PAYLOAD.workstationId,
    hardwareFingerprint: VALID_PAYLOAD.hardwareFingerprint,
    iss: 'pharmacy-licensing',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LicenseTokenService', () => {
  let service: LicenseTokenService;

  beforeAll(() => {
    // Ensure env is set for any fresh instantiation
    process.env.LICENSE_TOKEN_SECRET = TEST_SECRET;
    process.env.LICENSE_TOKEN_TTL_SECONDS = '604800';
  });

  beforeEach(() => {
    service = new LicenseTokenService();
  });

  // -----------------------------------------------------------------------
  // generateToken
  // -----------------------------------------------------------------------
  describe('generateToken', () => {
    it('generates a valid JWT with correct claims', () => {
      const result = service.generateToken(VALID_PAYLOAD);

      expect(result.token).toBeTruthy();
      expect(typeof result.token).toBe('string');
      // Verify the token is a valid JWT (3 dot-separated base64 segments)
      expect(result.token.split('.')).toHaveLength(3);
    });

    it('token has proper expiration', () => {
      const result = service.generateToken(VALID_PAYLOAD);
      const expiresAt = new Date(result.expiresAt);

      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
      // Default TTL is 604800 seconds (7 days)
      const expectedExpiry = Math.floor(Date.now() / 1000) + 604800;
      const actualExpiry = Math.floor(expiresAt.getTime() / 1000);
      expect(Math.abs(actualExpiry - expectedExpiry)).toBeLessThan(5);
    });

    it('token includes all required claims', () => {
      const result = service.generateToken(VALID_PAYLOAD);
      const decoded = jwt.decode(result.token) as Record<string, unknown>;

      const expectedClaims = buildExpectedTokenClaims();
      for (const [key, value] of Object.entries(expectedClaims)) {
        expect(decoded[key]).toEqual(value);
      }
    });

    it('uses custom expiresAt when provided', () => {
      const customExpiry = new Date(Date.now() + 3600 * 1000); // 1 hour
      const result = service.generateToken({ ...VALID_PAYLOAD, expiresAt: customExpiry });
      const decoded = jwt.decode(result.token) as Record<string, unknown>;

      expect(decoded.exp).toBe(Math.floor(customExpiry.getTime() / 1000));
    });
  });

  // -----------------------------------------------------------------------
  // verifyToken
  // -----------------------------------------------------------------------
  describe('verifyToken', () => {
    it('verifies a valid token successfully', () => {
      const { token } = service.generateToken(VALID_PAYLOAD);
      const claims = service.verifyToken(token);

      expect(claims.subscriptionId).toBe(VALID_PAYLOAD.subscriptionId);
      expect(claims.workstationId).toBe(VALID_PAYLOAD.workstationId);
      expect(claims.hardwareFingerprint).toBe(VALID_PAYLOAD.hardwareFingerprint);
      expect(claims.iss).toBe('pharmacy-licensing');
    });

    it('throws on expired token', () => {
      const expiredToken = jwt.sign(
        {
          sub: VALID_PAYLOAD.workstationId,
          subscriptionId: VALID_PAYLOAD.subscriptionId,
          hardwareFingerprint: VALID_PAYLOAD.hardwareFingerprint,
          exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
          iat: Math.floor(Date.now() / 1000) - 7200,
          iss: 'pharmacy-licensing',
        },
        TEST_SECRET,
        { algorithm: 'HS256' },
      );

      expect(() => service.verifyToken(expiredToken)).toThrow('License token expired');
    });

    it('throws on invalid signature', () => {
      const { token } = service.generateToken(VALID_PAYLOAD);
      // Create a token signed with a different secret
      const wrongSecretToken = jwt.sign(
        {
          sub: VALID_PAYLOAD.workstationId,
          subscriptionId: VALID_PAYLOAD.subscriptionId,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iss: 'pharmacy-licensing',
        },
        'some-other-secret-key-that-is-also-32-characters!!',
        { algorithm: 'HS256' },
      );

      expect(() => service.verifyToken(wrongSecretToken)).toThrow('Invalid license token');
    });

    it('throws on different issuer', () => {
      const wrongIssuerToken = jwt.sign(
        {
          sub: VALID_PAYLOAD.workstationId,
          subscriptionId: VALID_PAYLOAD.subscriptionId,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iss: 'different-issuer',
        },
        TEST_SECRET,
        { algorithm: 'HS256' },
      );

      expect(() => service.verifyToken(wrongIssuerToken)).toThrow('Invalid license token');
    });

    it('throws on malformed token', () => {
      expect(() => service.verifyToken('not-a-valid-token')).toThrow('Invalid license token');
    });

    it('throws on empty token string', () => {
      expect(() => service.verifyToken('')).toThrow('Invalid license token');
    });
  });

  // -----------------------------------------------------------------------
  // decodeToken
  // -----------------------------------------------------------------------
  describe('decodeToken', () => {
    it('decodes a valid token without verification', () => {
      const { token } = service.generateToken(VALID_PAYLOAD);
      const decoded = service.decodeToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded!.subscriptionId).toBe(VALID_PAYLOAD.subscriptionId);
    });

    it('decodes an expired token without throwing', () => {
      const expiredToken = jwt.sign(
        {
          sub: VALID_PAYLOAD.workstationId,
          exp: Math.floor(Date.now() / 1000) - 3600,
          iss: 'pharmacy-licensing',
        },
        TEST_SECRET,
        { algorithm: 'HS256' },
      );

      const decoded = service.decodeToken(expiredToken);
      expect(decoded).not.toBeNull();
      expect(decoded!.exp).toBeLessThan(Math.floor(Date.now() / 1000));
    });

    it('returns null for garbage input', () => {
      const decoded = service.decodeToken('absolute-garbage');
      expect(decoded).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getTokenRemainingSeconds
  // -----------------------------------------------------------------------
  describe('getTokenRemainingSeconds', () => {
    it('returns positive seconds for a valid token', () => {
      const customExpiry = new Date(Date.now() + 3600 * 1000); // 1 hour from now
      const { token } = service.generateToken({ ...VALID_PAYLOAD, expiresAt: customExpiry });
      const remaining = service.getTokenRemainingSeconds(token);

      expect(remaining).toBeGreaterThan(3500); // Allow a few seconds of drift
      expect(remaining).toBeLessThanOrEqual(3600);
    });

    it('returns 0 for an expired token', () => {
      const expiredToken = jwt.sign(
        {
          sub: VALID_PAYLOAD.workstationId,
          subscriptionId: VALID_PAYLOAD.subscriptionId,
          exp: Math.floor(Date.now() / 1000) - 3600,
          iat: Math.floor(Date.now() / 1000) - 7200,
          iss: 'pharmacy-licensing',
        },
        TEST_SECRET,
        { algorithm: 'HS256' },
      );

      const remaining = service.getTokenRemainingSeconds(expiredToken);
      expect(remaining).toBe(0);
    });

    it('returns 0 for an invalid token', () => {
      const remaining = service.getTokenRemainingSeconds('not-a-token');
      expect(remaining).toBe(0);
    });
  });
});
