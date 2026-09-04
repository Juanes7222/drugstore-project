/**
 * Tests for AuthService's opportunistic user-identities pull after login.
 *
 * After login / loginWithGoogle / completeTwoFactor succeed, the service
 * fire-and-forgets `createUserPullService(...).pullUserIdentities()` so the
 * avatar grid picks up users created elsewhere. The pull is best-effort:
 * a rejection must never fail the login, which already resolved.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createAuthService, type AuthService } from "./auth.service";
import { useLocalSessionStore } from "./local-session.store";
import type { AuthHttpClient } from "./auth-http-client";

vi.mock("./user-pull.service", () => ({
  createUserPullService: vi.fn(),
}));
import { createUserPullService } from "./user-pull.service";

vi.mock("./local-user-cache", () => ({
  cacheUser: vi.fn().mockResolvedValue(undefined),
  cacheUsers: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Factory helpers (data construction only — no assertions hidden here)
// ---------------------------------------------------------------------------

const BASE_URL = "http://localhost:3000";

const makeHttp = (): AuthHttpClient => ({
  post: vi.fn(),
  postWithAuth: vi.fn(),
  getWithAuth: vi.fn(),
  patchWithAuth: vi.fn(),
  deleteWithAuth: vi.fn(),
});

const makeUserPayload = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  role: "CASHIER",
  email: "cajero@pharmacy.com",
  username: "cajero1",
  displayName: "Cajero Uno",
  subscriptionId: "sub-1",
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
  ...overrides,
});

const makeLoginResponse = (accessToken: string, overrides: Record<string, unknown> = {}) => ({
  accessToken,
  refreshToken: "refresh-xyz",
  expiresAt: "2099-12-31T23:59:59Z",
  sessionId: "sess-1",
  user: makeUserPayload(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AuthService opportunistic user pull", () => {
  let http: AuthHttpClient;
  let auth: AuthService;
  let pullUserIdentities: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    http = { ...makeHttp(), postWithStatus: vi.fn() } as AuthHttpClient;
    pullUserIdentities = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createUserPullService).mockReset();
    vi.mocked(createUserPullService).mockReturnValue({ pullUserIdentities } as any);
    auth = createAuthService({ baseUrl: BASE_URL, httpClient: http });
    useLocalSessionStore.getState().clearSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useLocalSessionStore.getState().clearSession();
  });

  describe("login", () => {
    it("attempts the user pull with the login access token", async () => {
      vi.mocked(http.post!).mockResolvedValue(makeLoginResponse("token-login"));

      const result = await auth.login("cajero1", "secret123", "PASSWORD", "ws-1");

      expect(result.session?.accessToken).toBe("token-login");
      await vi.waitFor(() => expect(pullUserIdentities).toHaveBeenCalledOnce());
      expect(createUserPullService).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: BASE_URL, accessToken: "token-login" }),
      );
    });

    it("still resolves the session when the user pull rejects", async () => {
      vi.mocked(http.post!).mockResolvedValue(makeLoginResponse("token-login"));
      pullUserIdentities.mockRejectedValue(new Error("pull failed"));

      const result = await auth.login("cajero1", "secret123", "PASSWORD", "ws-1");

      expect(result.session).toBeDefined();
      expect(result.session?.accessToken).toBe("token-login");
      await vi.waitFor(() => expect(pullUserIdentities).toHaveBeenCalledOnce());
      expect(useLocalSessionStore.getState().session?.accessToken).toBe("token-login");
    });

    it("skips the user pull when the server issues a two-factor challenge", async () => {
      vi.mocked(http.post!).mockResolvedValue({
        requiresTwoFactor: true,
        challengeToken: "challenge-abc",
      });

      const result = await auth.login("cajero1", "secret123", "PASSWORD", "ws-1");

      expect(result.requiresTwoFactor).toBe(true);
      await Promise.resolve();
      expect(createUserPullService).not.toHaveBeenCalled();
    });
  });

  describe("loginWithGoogle", () => {
    it("attempts the user pull with the Google login access token", async () => {
      vi.mocked(http.postWithStatus!).mockResolvedValue(makeLoginResponse("token-google"));

      const result = await auth.loginWithGoogle("firebase-id-token", "ws-1");

      expect(result.session.accessToken).toBe("token-google");
      await vi.waitFor(() => expect(pullUserIdentities).toHaveBeenCalledOnce());
      expect(createUserPullService).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: BASE_URL, accessToken: "token-google" }),
      );
    });

    it("still resolves the session when the user pull rejects", async () => {
      vi.mocked(http.postWithStatus!).mockResolvedValue(makeLoginResponse("token-google"));
      pullUserIdentities.mockRejectedValue(new Error("pull failed"));

      const result = await auth.loginWithGoogle("firebase-id-token", "ws-1");

      expect(result.session).toBeDefined();
      await vi.waitFor(() => expect(pullUserIdentities).toHaveBeenCalledOnce());
    });
  });

  describe("completeTwoFactor", () => {
    it("attempts the user pull with the 2FA access token", async () => {
      vi.mocked(http.post!).mockResolvedValue(makeLoginResponse("token-2fa"));

      const session = await auth.completeTwoFactor("challenge-abc", "123456");

      expect(session.accessToken).toBe("token-2fa");
      await vi.waitFor(() => expect(pullUserIdentities).toHaveBeenCalledOnce());
      expect(createUserPullService).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: BASE_URL, accessToken: "token-2fa" }),
      );
    });

    it("still resolves the session when the user pull rejects", async () => {
      vi.mocked(http.post!).mockResolvedValue(makeLoginResponse("token-2fa"));
      pullUserIdentities.mockRejectedValue(new Error("pull failed"));

      const session = await auth.completeTwoFactor("challenge-abc", "123456");

      expect(session.accessToken).toBe("token-2fa");
      await vi.waitFor(() => expect(pullUserIdentities).toHaveBeenCalledOnce());
    });
  });
});
