/**
 * Unit tests for auth guard utilities.
 *
 * Covers isAuthenticated, canPerformOperation (LOCAL / SERVER_TRUSTED),
 * and isOfflineSessionUsable.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import type { LocalSession } from "./local-session.store";
import type { OfflineSession } from "./offline";
import {
  isAuthenticated,
  canPerformOperation,
  isOfflineSessionUsable,
} from "./auth-guards";

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
function makeOfflineTokenString(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: "user-1",
    typ: "offline",
    exp: now + 36000,
    jti: "jti-abc-123",
    ...overrides,
  };
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url(claims);
  return `${header}.${payload}.dummysignature`;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeOnlineSession = (overrides: Partial<LocalSession> = {}): LocalSession => ({
  userId: "user-1",
  username: "cajero1",
  fullName: "Cajero Uno",
  displayName: "Cajero Uno",
  email: "cajero@pharmacy.com",
  role: "CASHIER",
  subscriptionId: "sub-1",
  workstationId: "ws-1",
  accessToken: "access-token-abc",
  refreshToken: "refresh-token-xyz",
  expiresAt: new Date("2099-12-31"),
  sessionId: "session-1",
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
  ...overrides,
});

const makeOfflineSession = (overrides: Partial<OfflineSession> = {}): OfflineSession => ({
  localSessionId: "local-sess-1",
  userId: "user-1",
  username: "cajero1",
  displayName: "Cajero Uno",
  role: "CASHIER",
  subscriptionId: "sub-1",
  offlineToken: makeOfflineTokenString(),
  workstationFingerprint: "ws-1",
  createdAt: new Date("2026-07-15T10:00:00Z"),
  lastActiveAt: new Date("2026-07-15T10:00:00Z"),
  isBlessed: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// isAuthenticated
// ---------------------------------------------------------------------------

describe("isAuthenticated", () => {
  it("returns true when an online session is present", () => {
    expect(isAuthenticated(makeOnlineSession(), null)).toBe(true);
  });

  it("returns true when an offline session is present", () => {
    expect(isAuthenticated(null, makeOfflineSession())).toBe(true);
  });

  it("returns true when both sessions are present", () => {
    expect(isAuthenticated(makeOnlineSession(), makeOfflineSession())).toBe(true);
  });

  it("returns false when both sessions are null", () => {
    expect(isAuthenticated(null, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canPerformOperation — LOCAL
// ---------------------------------------------------------------------------

describe("canPerformOperation — LOCAL", () => {
  it("allows when an online session is present", () => {
    const result = canPerformOperation("LOCAL", makeOnlineSession(), null);
    expect(result.allowed).toBe(true);
  });

  it("allows when an offline session is present", () => {
    const result = canPerformOperation("LOCAL", null, makeOfflineSession());
    expect(result.allowed).toBe(true);
  });

  it("allows when both sessions are present", () => {
    const result = canPerformOperation("LOCAL", makeOnlineSession(), makeOfflineSession());
    expect(result.allowed).toBe(true);
  });

  it("denies with a reason when no session is present", () => {
    const result = canPerformOperation("LOCAL", null, null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("log in");
  });
});

// ---------------------------------------------------------------------------
// canPerformOperation — SERVER_TRUSTED
// ---------------------------------------------------------------------------

describe("canPerformOperation — SERVER_TRUSTED", () => {
  it("allows when an online session is present", () => {
    const result = canPerformOperation("SERVER_TRUSTED", makeOnlineSession(), null);
    expect(result.allowed).toBe(true);
  });

  it("denies when only an offline session is present", () => {
    const result = canPerformOperation("SERVER_TRUSTED", null, makeOfflineSession());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("server connectivity");
  });

  it("denies when no session is present", () => {
    const result = canPerformOperation("SERVER_TRUSTED", null, null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("log in");
  });

  it("denies with 'server connectivity' reason when offline session explains the absence of online", () => {
    // When there is an offline session but no online session for a
    // SERVER_TRUSTED operation, the reason should mention connectivity.
    const result = canPerformOperation("SERVER_TRUSTED", null, makeOfflineSession());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("server connectivity");
  });
});

// ---------------------------------------------------------------------------
// isOfflineSessionUsable
// ---------------------------------------------------------------------------

describe("isOfflineSessionUsable", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns allowed=true for a valid session with no revocation list", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));

    const session = makeOfflineSession();
    const result = isOfflineSessionUsable(session, []);
    expect(result.allowed).toBe(true);
  });

  it("returns allowed=false when the token is expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));

    // Create a session with an expired token (exp set to far past)
    const session = makeOfflineSession({
      offlineToken: makeOfflineTokenString({ exp: 100000 }),
    });
    const result = isOfflineSessionUsable(session, []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("returns allowed=false when the token's jti is revoked", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));

    const session = makeOfflineSession();
    const revocationList = [
      { jti: "jti-abc-123", revokedAt: new Date("2026-07-14"), reason: "logout" },
    ];
    const result = isOfflineSessionUsable(session, revocationList);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("revoked");
  });
});
