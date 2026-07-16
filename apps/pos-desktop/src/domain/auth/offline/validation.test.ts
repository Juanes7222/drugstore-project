/**
 * Unit tests for offline auth validation (pure functions).
 *
 * Covers decodeOfflineToken, verifyOfflineToken, isRevoked,
 * getOfflineTokenExpiration, isTokenExpired, and validateCachedCredentials.
 */
import { describe, expect, it, vi, beforeAll, afterEach, afterAll } from "vitest";
import type { OfflineTokenClaims, RevocationListEntry, CredentialCacheEntry } from "./types";

// jsdom/Node exposes crypto.subtle (Web Crypto API), so the validation
// module would normally use that path.  To test the deterministic fallback
// HMAC consistently, we make subtle unavailable during these tests.
let originalSubtle: any;

beforeAll(() => {
  originalSubtle = crypto.subtle;
  Object.defineProperty(crypto, "subtle", { value: undefined, configurable: true });
});

afterAll(() => {
  Object.defineProperty(crypto, "subtle", { value: originalSubtle, configurable: true });
});
import {
  decodeOfflineToken,
  verifyOfflineToken,
  isRevoked,
  getOfflineTokenExpiration,
  isTokenExpired,
  validateCachedCredentials,
} from "./validation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the fallback HMAC-SHA256 used by the validation module when
 * `crypto.subtle` is unavailable (jsdom environment).
 */
function fallbackHmac(data: string, secret: string): string {
  let hash = 0;
  const combined = data + ":" + secret;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(64, "0");
}

/** Base64url-encode a JSON-serialisable value. */
function b64url(value: unknown): string {
  const json = JSON.stringify(value);
  const encoded = globalThis.btoa(json);
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Create a valid offline JWT string that passes verifyOfflineToken. */
function createValidToken(
  overrides: Partial<OfflineTokenClaims> = {},
  secret: string = "test-secret",
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: OfflineTokenClaims = {
    sub: "user-1",
    sid: "sess-abc",
    role: "CASHIER",
    subscriptionId: "sub-1",
    locationIds: ["loc-1"],
    wfp: "ws-fingerprint",
    typ: "offline",
    jti: "jti-abc-123",
    iat: now - 3600,
    exp: now + 3600,
    ...overrides,
  };

  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url(claims);
  const data = `${header}.${payload}`;
  const signature = fallbackHmac(data, secret);

  return `${data}.${signature}`;
}

const defaultClaims: OfflineTokenClaims = {
  sub: "user-1",
  sid: "sess-abc",
  role: "CASHIER",
  subscriptionId: "sub-1",
  locationIds: ["loc-1"],
  wfp: "ws-fingerprint",
  typ: "offline",
  jti: "jti-abc-123",
  iat: 1000000,
  exp: 2000000,
};

// ---------------------------------------------------------------------------
// decodeOfflineToken
// ---------------------------------------------------------------------------

describe("decodeOfflineToken", () => {
  it("decodes a well-formed offline JWT token", () => {
    const token = createValidToken();
    const result = decodeOfflineToken(token);

    expect(result).not.toBeNull();
    expect(result!.sub).toBe("user-1");
    expect(result!.typ).toBe("offline");
    expect(result!.jti).toBe("jti-abc-123");
    expect(result!.role).toBe("CASHIER");
  });

  it("returns null for a malformed token (no dots)", () => {
    expect(decodeOfflineToken("not-a-jwt")).toBeNull();
  });

  it("returns null for a token with empty parts", () => {
    expect(decodeOfflineToken("..")).toBeNull();
    expect(decodeOfflineToken(".payload.")).toBeNull();
    expect(decodeOfflineToken("header..signature")).toBeNull();
  });

  it("returns null when payload is not valid JSON", () => {
    const header = b64url({ alg: "HS256" });
    const token = `${header}.not-json.signature`;
    expect(decodeOfflineToken(token)).toBeNull();
  });

  it("returns null when sub field is missing or not a string", () => {
    const header = b64url({ alg: "HS256" });
    const payload = b64url({ typ: "offline", sub: 123 });
    expect(decodeOfflineToken(`${header}.${payload}.sig`)).toBeNull();
  });

  it("returns null when typ is not 'offline'", () => {
    const header = b64url({ alg: "HS256" });
    const payload = b64url({ sub: "user-1", typ: "online" });
    expect(decodeOfflineToken(`${header}.${payload}.sig`)).toBeNull();
  });

  it("returns null when typ is missing", () => {
    const header = b64url({ alg: "HS256" });
    const payload = b64url({ sub: "user-1" });
    expect(decodeOfflineToken(`${header}.${payload}.sig`)).toBeNull();
  });

  it("uses defaults for optional fields when missing", () => {
    const header = b64url({ alg: "HS256" });
    const payload = b64url({ sub: "user-1", typ: "offline" });
    const result = decodeOfflineToken(`${header}.${payload}.sig`);

    expect(result).not.toBeNull();
    expect(result!.sid).toBe("");
    expect(result!.role).toBe("");
    expect(result!.subscriptionId).toBeNull();
    expect(result!.locationIds).toEqual([]);
    expect(result!.wfp).toBe("");
    expect(result!.jti).toBe("");
    expect(result!.iat).toBe(0);
    expect(result!.exp).toBe(0);
  });

  it("handles base64url-encoded payload with padding", () => {
    const claims = { sub: "user-1", typ: "offline" };
    const header = b64url({ alg: "HS256" });
    const payload = b64url(claims);
    const result = decodeOfflineToken(`${header}.${payload}.sig`);

    expect(result).not.toBeNull();
    expect(result!.sub).toBe("user-1");
  });
});

// ---------------------------------------------------------------------------
// verifyOfflineToken
// ---------------------------------------------------------------------------

describe("verifyOfflineToken", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns decoded claims for a valid token", async () => {
    const token = createValidToken();
    const result = await verifyOfflineToken(token, "test-secret", "ws-fingerprint");

    expect(result).not.toBeNull();
    expect(result!.sub).toBe("user-1");
    expect(result!.role).toBe("CASHIER");
  });

  it("returns null for a malformed JWT", async () => {
    const result = await verifyOfflineToken("bad-token", "secret", "wfp");
    expect(result).toBeNull();
  });

  it("returns null when the signature does not match", async () => {
    const token = createValidToken({}, "secret-one");
    const result = await verifyOfflineToken(token, "wrong-secret", "ws-fingerprint");
    expect(result).toBeNull();
  });

  it("returns null when the token has been tampered with (payload altered)", async () => {
    const token = createValidToken();
    const parts = token.split(".");
    // Replace the payload with a different one but keep the same signature
    const tamperedPayload = b64url({ sub: "attacker", typ: "offline" });
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const result = await verifyOfflineToken(tamperedToken, "test-secret", "ws-fingerprint");
    expect(result).toBeNull();
  });

  it("returns null when the token type is not 'offline'", async () => {
    const token = createValidToken({ typ: "online" as any });
    const result = await verifyOfflineToken(token, "test-secret", "ws-fingerprint");
    expect(result).toBeNull();
  });

  it("returns null when the token is expired (beyond clock drift tolerance)", async () => {
    vi.useFakeTimers();
    const now = Math.floor(Date.now() / 1000);
    // Token expired 10 minutes ago — beyond the 5-minute tolerance
    const token = createValidToken({ exp: now - 600 });
    vi.setSystemTime(new Date(now * 1000));

    const result = await verifyOfflineToken(token, "test-secret", "ws-fingerprint");
    expect(result).toBeNull();
  });

  it("accepts a token that expired within the clock drift tolerance window", async () => {
    vi.useFakeTimers();
    const now = Math.floor(Date.now() / 1000);
    // Token expired 2 minutes ago — within the 5-minute tolerance
    const token = createValidToken({ exp: now - 120 });
    vi.setSystemTime(new Date(now * 1000));

    const result = await verifyOfflineToken(token, "test-secret", "ws-fingerprint");
    expect(result).not.toBeNull();
  });

  it("returns null when the workstation fingerprint does not match", async () => {
    const token = createValidToken({ wfp: "other-workstation" });
    const result = await verifyOfflineToken(token, "test-secret", "this-workstation");
    expect(result).toBeNull();
  });

  it("returns null when the catch-all catches an unexpected error", async () => {
    // Pass null/undefined as token to trigger an error during parsing
    const result = await verifyOfflineToken(null as unknown as string, "secret", "wfp");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isRevoked
// ---------------------------------------------------------------------------

describe("isRevoked", () => {
  const revocationList: RevocationListEntry[] = [
    { jti: "jti-revoked-1", revokedAt: new Date("2026-01-01"), reason: "logout" },
    { jti: "jti-revoked-2", revokedAt: new Date("2026-01-02"), reason: "admin" },
  ];

  it("returns true when the jti is in the revocation list", () => {
    expect(isRevoked("jti-revoked-1", revocationList)).toBe(true);
    expect(isRevoked("jti-revoked-2", revocationList)).toBe(true);
  });

  it("returns false when the jti is not in the revocation list", () => {
    expect(isRevoked("jti-not-revoked", revocationList)).toBe(false);
  });

  it("returns false for an empty revocation list", () => {
    expect(isRevoked("anything", [])).toBe(false);
  });

  it("is case-sensitive when comparing jti values", () => {
    expect(isRevoked("JTI-REVOKED-1", revocationList)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getOfflineTokenExpiration
// ---------------------------------------------------------------------------

describe("getOfflineTokenExpiration", () => {
  it("returns a Date from the exp timestamp", () => {
    const claims: OfflineTokenClaims = { ...defaultClaims, exp: 2000000 };
    const result = getOfflineTokenExpiration(claims);
    expect(result).toEqual(new Date(2000000 * 1000));
  });

  it("handles a zero exp value", () => {
    const claims: OfflineTokenClaims = { ...defaultClaims, exp: 0 };
    const result = getOfflineTokenExpiration(claims);
    expect(result).toEqual(new Date(0));
  });
});

// ---------------------------------------------------------------------------
// isTokenExpired
// ---------------------------------------------------------------------------

describe("isTokenExpired", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true when the token is expired beyond tolerance", () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-15T12:00:00Z");
    vi.setSystemTime(now);

    // Token expired 10 minutes before reference time
    const claims: OfflineTokenClaims = {
      ...defaultClaims,
      exp: Math.floor(now.getTime() / 1000) - 600,
    };

    expect(isTokenExpired(claims, now)).toBe(true);
  });

  it("returns false when the token is still valid", () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-15T12:00:00Z");
    vi.setSystemTime(now);

    // Token expires 1 hour from now
    const claims: OfflineTokenClaims = {
      ...defaultClaims,
      exp: Math.floor(now.getTime() / 1000) + 3600,
    };

    expect(isTokenExpired(claims, now)).toBe(false);
  });

  it("returns false when the token is within the clock drift tolerance", () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-15T12:00:00Z");
    vi.setSystemTime(now);

    // Token expired 2 minutes ago — within 5-minute tolerance
    const claims: OfflineTokenClaims = {
      ...defaultClaims,
      exp: Math.floor(now.getTime() / 1000) - 120,
    };

    expect(isTokenExpired(claims, now)).toBe(false);
  });

  it("uses the current time when no reference time is provided", () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-15T12:00:00Z");
    vi.setSystemTime(now);

    const claims: OfflineTokenClaims = {
      ...defaultClaims,
      exp: Math.floor(now.getTime() / 1000) - 600,
    };

    expect(isTokenExpired(claims)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateCachedCredentials
// ---------------------------------------------------------------------------

describe("validateCachedCredentials", () => {
  const keyFingerprint = "kfp-v1-abc123";

  const makeEntry = (overrides: Partial<CredentialCacheEntry> = {}): CredentialCacheEntry => ({
    userId: "user-1",
    encryptedCredentials: "encrypted-blob-data",
    keyFingerprint,
    expiresAt: new Date("2099-01-01"),
    version: 1,
    ...overrides,
  });

  it("returns valid=true for a fresh entry with matching key fingerprint", () => {
    const now = new Date("2026-07-01");
    const result = validateCachedCredentials(makeEntry(), keyFingerprint, now);
    expect(result).toEqual({ valid: true });
  });

  it("returns valid=false with reason when the entry has expired", () => {
    const now = new Date("2026-07-01");
    const entry = makeEntry({ expiresAt: new Date("2026-01-01") });
    const result = validateCachedCredentials(entry, keyFingerprint, now);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("returns valid=false with reason when the key fingerprint does not match", () => {
    const now = new Date("2026-07-01");
    const entry = makeEntry({ keyFingerprint: "kfp-old-key" });
    const result = validateCachedCredentials(entry, keyFingerprint, now);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("key fingerprint");
  });

  it("returns expired reason when both expired and key fingerprint mismatch", () => {
    // The function checks expiration first, so that's the returned reason
    const now = new Date("2026-07-01");
    const entry = makeEntry({
      expiresAt: new Date("2026-01-01"),
      keyFingerprint: "kfp-old-key",
    });
    const result = validateCachedCredentials(entry, keyFingerprint, now);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expired");
  });
});
