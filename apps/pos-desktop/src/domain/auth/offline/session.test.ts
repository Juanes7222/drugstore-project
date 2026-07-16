/**
 * Unit tests for offline session lifecycle (pure functions).
 *
 * Covers createOfflineSession, markPendingBlessing, applyBlessingResult,
 * isSessionValid, and filterValidSessions.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import type {
  OfflineSession,
  OfflineTokenClaims,
  BlessingResult,
  RevocationListEntry,
} from "./types";
import {
  createOfflineSession,
  markPendingBlessing,
  applyBlessingResult,
  isSessionValid,
  filterValidSessions,
} from "./session";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Base64url-encode a JSON-serialisable value. */
function b64url(value: unknown): string {
  const json = JSON.stringify(value);
  const encoded = globalThis.btoa(json);
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Create an offline JWT token string with claims suitable for testing
 * session validity (exp far in the future).
 */
function makeOfflineToken(overrides: Partial<OfflineTokenClaims> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: OfflineTokenClaims = {
    sub: "user-1",
    sid: "sess-abc",
    role: "CASHIER",
    subscriptionId: "sub-1",
    locationIds: ["loc-1"],
    wfp: "ws-1",
    typ: "offline",
    jti: "jti-abc-123",
    iat: now - 3600,
    exp: now + 36000, // 10 hours in the future
    ...overrides,
  };

  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url(claims);
  return `${header}.${payload}.dummysignature`;
}

const defaultClaims: OfflineTokenClaims = {
  sub: "user-1",
  sid: "sess-abc",
  role: "CASHIER",
  subscriptionId: "sub-1",
  locationIds: ["loc-1"],
  wfp: "ws-1",
  typ: "offline",
  jti: "jti-abc-123",
  iat: 1000000,
  exp: 2000000,
};

const makeSession = (
  overrides: Partial<OfflineSession> = {},
): OfflineSession => ({
  localSessionId: "local-sess-1",
  userId: "user-1",
  username: "cajero1",
  displayName: "Cajero Uno",
  role: "CASHIER",
  subscriptionId: "sub-1",
  offlineToken: makeOfflineToken(),
  workstationFingerprint: "ws-1",
  createdAt: new Date("2026-07-15T10:00:00Z"),
  lastActiveAt: new Date("2026-07-15T10:00:00Z"),
  isBlessed: false,
  ...overrides,
});

const defaultRevocationList: RevocationListEntry[] = [];

// ---------------------------------------------------------------------------
// createOfflineSession
// ---------------------------------------------------------------------------

describe("createOfflineSession", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("creates an un-blessed offline session with the given properties", () => {
    const session = createOfflineSession(
      "user-1",
      "cajero1",
      "Cajero Uno",
      "CASHIER",
      "sub-1",
      defaultClaims,
      "ws-1",
    );

    expect(session.userId).toBe("user-1");
    expect(session.username).toBe("cajero1");
    expect(session.displayName).toBe("Cajero Uno");
    expect(session.role).toBe("CASHIER");
    expect(session.subscriptionId).toBe("sub-1");
    expect(session.workstationFingerprint).toBe("ws-1");
    expect(session.isBlessed).toBe(false);
    expect(session.offlineToken).toBe("");
    expect(session.createdAt).toEqual(new Date("2026-07-15T12:00:00Z"));
    expect(session.lastActiveAt).toEqual(new Date("2026-07-15T12:00:00Z"));
  });

  it("generates a localSessionId", () => {
    const session = createOfflineSession(
      "user-1", "cajero1", "Cajero", "CASHIER", null, defaultClaims, "ws-1",
    );

    expect(session.localSessionId).toBeTruthy();
    expect(typeof session.localSessionId).toBe("string");
  });

  it("uses the claims wfp as workstationFingerprint argument", () => {
    const session = createOfflineSession(
      "user-1", "cajero1", "Cajero", "CASHIER", null, defaultClaims, "custom-ws",
    );

    expect(session.workstationFingerprint).toBe("custom-ws");
  });

  it("accepts null subscriptionId", () => {
    const session = createOfflineSession(
      "user-1", "cajero1", "Cajero", "CASHIER", null, defaultClaims, "ws-1",
    );

    expect(session.subscriptionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// markPendingBlessing
// ---------------------------------------------------------------------------

describe("markPendingBlessing", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("returns a new session with isBlessed=false and cleared timestamps", () => {
    const blessedSession = makeSession({
      isBlessed: true,
      blessedAt: new Date("2026-07-15T11:00:00Z"),
    });

    const result = markPendingBlessing(blessedSession);

    expect(result).not.toBe(blessedSession); // immutability
    expect(result.isBlessed).toBe(false);
    expect(result.blessedAt).toBeUndefined();
    expect(result.rejectedAt).toBeUndefined();
    expect(result.rejectionReason).toBeUndefined();
    expect(result.lastActiveAt).toEqual(new Date("2026-07-15T12:00:00Z"));
  });

  it("also clears rejection state", () => {
    const rejectedSession = makeSession({
      rejectedAt: new Date("2026-07-15T11:30:00Z"),
      rejectionReason: "USER_DISABLED",
    });

    const result = markPendingBlessing(rejectedSession);

    expect(result.rejectedAt).toBeUndefined();
    expect(result.rejectionReason).toBeUndefined();
    expect(result.isBlessed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyBlessingResult
// ---------------------------------------------------------------------------

describe("applyBlessingResult", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  const session = makeSession();

  it("marks the session as blessed and updates the token when status is BLESSED", () => {
    const result: BlessingResult = {
      localSessionId: "local-sess-1",
      status: "BLESSED",
      replacementToken: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        offlineToken: "new-offline-token",
        expiresAt: new Date("2099-01-01"),
      },
    };

    const updated = applyBlessingResult(session, result);

    expect(updated.isBlessed).toBe(true);
    expect(updated.blessedAt).toEqual(new Date("2026-07-15T12:00:00Z"));
    expect(updated.offlineToken).toBe("new-offline-token");
    expect(updated.rejectedAt).toBeUndefined();
    expect(updated.rejectionReason).toBeUndefined();
  });

  it("keeps the existing offline token when no replacement is provided", () => {
    const result: BlessingResult = {
      localSessionId: "local-sess-1",
      status: "BLESSED",
    };

    const updated = applyBlessingResult(session, result);

    expect(updated.isBlessed).toBe(true);
    expect(updated.offlineToken).toBe(session.offlineToken);
  });

  it("marks the session as rejected when status is REJECTED", () => {
    const result: BlessingResult = {
      localSessionId: "local-sess-1",
      status: "REJECTED",
      reason: "USER_DISABLED",
    };

    const updated = applyBlessingResult(session, result);

    expect(updated.isBlessed).toBe(false);
    expect(updated.rejectedAt).toEqual(new Date("2026-07-15T12:00:00Z"));
    expect(updated.rejectionReason).toBe("USER_DISABLED");
    expect(updated.blessedAt).toBeUndefined();
  });

  it("uses UNKNOWN as rejection reason when none is provided", () => {
    const result: BlessingResult = {
      localSessionId: "local-sess-1",
      status: "REJECTED",
    };

    const updated = applyBlessingResult(session, result);

    expect(updated.rejectionReason).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// isSessionValid
// ---------------------------------------------------------------------------

describe("isSessionValid", () => {
  const now = new Date("2026-07-15T12:00:00Z");

  it("returns valid=true for a properly configured session", () => {
    const session = makeSession();
    const result = isSessionValid(session, now, defaultRevocationList);
    expect(result).toEqual({ valid: true });
  });

  it("returns valid=false when the session has no offline token", () => {
    const session = makeSession({ offlineToken: "" });
    const result = isSessionValid(session, now, defaultRevocationList);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("no offline token");
  });

  it("returns valid=false when the offline token is malformed", () => {
    const session = makeSession({ offlineToken: "not-a-valid-jwt" });
    const result = isSessionValid(session, now, defaultRevocationList);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("malformed");
  });

  it("returns valid=false when the token has expired", () => {
    // Token's exp is in the far past
    const expiredToken = makeOfflineToken({ exp: 100000 });
    const session = makeSession({ offlineToken: expiredToken });
    const result = isSessionValid(session, now, defaultRevocationList);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("returns valid=false when the token's jti is in the revocation list", () => {
    const session = makeSession();
    const revocationList: RevocationListEntry[] = [
      { jti: "jti-abc-123", revokedAt: new Date("2026-07-14"), reason: "logout" },
    ];
    const result = isSessionValid(session, now, revocationList);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("revoked");
  });

  it("returns valid=false when the session was previously rejected", () => {
    const session = makeSession({
      rejectedAt: new Date("2026-07-15T11:00:00Z"),
      rejectionReason: "USER_DISABLED",
    });
    const result = isSessionValid(session, now, defaultRevocationList);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("USER_DISABLED");
  });

  it("returns valid=false with the rejection reason when available", () => {
    const session = makeSession({
      rejectedAt: new Date("2026-07-15T11:00:00Z"),
      rejectionReason: "FRAUD_DETECTED",
    });
    const result = isSessionValid(session, now, defaultRevocationList);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("FRAUD_DETECTED");
  });

  it("returns valid=false with fallback reason when rejectedAt is set but no rejectionReason", () => {
    const session = makeSession({
      rejectedAt: new Date("2026-07-15T11:00:00Z"),
      rejectionReason: undefined,
    });
    const result = isSessionValid(session, now, defaultRevocationList);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("rejected by the server");
  });
});

// ---------------------------------------------------------------------------
// filterValidSessions
// ---------------------------------------------------------------------------

describe("filterValidSessions", () => {
  const now = new Date("2026-07-15T12:00:00Z");

  it("returns only sessions that pass isSessionValid", () => {
    const valid = makeSession({ localSessionId: "s-1" });
    const noToken = makeSession({ localSessionId: "s-2", offlineToken: "" });
    const malformed = makeSession({ localSessionId: "s-3", offlineToken: "bad" });
    const valid2 = makeSession({ localSessionId: "s-4" });

    const sessions = [valid, noToken, malformed, valid2];
    const result = filterValidSessions(sessions, now, defaultRevocationList);

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.localSessionId)).toEqual(["s-1", "s-4"]);
  });

  it("returns an empty array when all sessions are invalid", () => {
    const sessions = [
      makeSession({ localSessionId: "s-1", offlineToken: "" }),
      makeSession({ localSessionId: "s-2", offlineToken: "bad" }),
    ];
    const result = filterValidSessions(sessions, now, defaultRevocationList);
    expect(result).toEqual([]);
  });

  it("returns an empty array when given an empty input array", () => {
    const result = filterValidSessions([], now, defaultRevocationList);
    expect(result).toEqual([]);
  });
});
