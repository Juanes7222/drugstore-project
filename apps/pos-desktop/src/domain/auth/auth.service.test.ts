/**
 * Unit tests for AuthService — login, session, role-based access control.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createAuthService, type AuthService } from "./auth.service";
import { useLocalSessionStore, type LocalSession } from "./local-session.store";
import { InvalidCredentialsException, NoActiveSessionException, InsufficientRoleException } from "./exceptions";
import type { AuthHttpClient } from "./auth-http-client";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const makeMockHttpClient = (): AuthHttpClient => ({
  post: vi.fn(),
  postWithAuth: vi.fn(),
  getWithAuth: vi.fn(),
});

const makeLocalSession = (overrides: Partial<LocalSession> = {}): LocalSession => ({
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthService", () => {
  let http: ReturnType<typeof makeMockHttpClient>;
  let auth: AuthService;

  beforeEach(() => {
    http = makeMockHttpClient();
    auth = createAuthService({ baseUrl: "http://localhost:3000", httpClient: http });
    // Clear session before each test
    useLocalSessionStore.getState().clearSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("login", () => {
    it("returns a LocalSession when credentials are valid and 2FA is disabled", async () => {
      vi.mocked(http.post).mockResolvedValue({
        accessToken: "token-abc",
        refreshToken: "refresh-xyz",
        expiresAt: "2099-12-31T23:59:59Z",
        sessionId: "sess-1",
        user: {
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
        },
      });

      const result = await auth.login("cajero1", "secret123", "PASSWORD", "ws-1");

      expect(result.session).toBeDefined();
      expect(result.session!.userId).toBe("user-1");
      expect(result.session!.role).toBe("CASHIER");
      expect(result.session!.accessToken).toBe("token-abc");
      expect(result.requiresTwoFactor).toBeUndefined();

      // Store should be updated
      const stored = useLocalSessionStore.getState().session;
      expect(stored?.userId).toBe("user-1");
    });

    it("returns requiresTwoFactor when the server responds with challenge", async () => {
      vi.mocked(http.post).mockResolvedValue({
        requiresTwoFactor: true,
        challengeToken: "challenge-abc",
      });

      const result = await auth.login("cajero1", "secret123", "PASSWORD", "ws-1");

      expect(result.requiresTwoFactor).toBe(true);
      expect(result.challengeToken).toBe("challenge-abc");
      expect(result.session).toBeUndefined();

      // Session should NOT be set until 2FA is completed
      const stored = useLocalSessionStore.getState().session;
      expect(stored).toBeNull();
    });

    it("throws InvalidCredentialsException on 401 from the HTTP client", async () => {
      vi.mocked(http.post).mockRejectedValue(new InvalidCredentialsException());

      await expect(
        auth.login("baduser", "badpass", "PASSWORD", "ws-1"),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it("throws a network error when fetch fails", async () => {
      vi.mocked(http.post).mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        auth.login("cajero1", "secret123", "PASSWORD", "ws-1"),
      ).rejects.toThrow();
    });
  });

  describe("completeTwoFactor", () => {
    it("returns a LocalSession after successful 2FA completion", async () => {
      vi.mocked(http.post).mockResolvedValue({
        accessToken: "token-2fa",
        refreshToken: "refresh-2fa",
        expiresAt: "2099-12-31T23:59:59Z",
        sessionId: "sess-2fa",
        user: {
          id: "user-1",
          role: "MANAGER",
          email: "manager@pharmacy.com",
          username: "manager1",
          displayName: "Manager Uno",
          subscriptionId: "sub-1",
          totpEnabled: true,
          avatarUrl: null,
          avatarColor: null,
          mustChangePassword: false,
        },
      });

      const session = await auth.completeTwoFactor("challenge-abc", "123456");

      expect(session.role).toBe("MANAGER");
      expect(session.accessToken).toBe("token-2fa");

      const stored = useLocalSessionStore.getState().session;
      expect(stored?.role).toBe("MANAGER");
    });
  });

  describe("refreshSession", () => {
    it("returns null when there is no active session", async () => {
      useLocalSessionStore.getState().clearSession();

      const result = await auth.refreshSession();

      expect(result).toBeNull();
    });

    it("returns an updated session when the refresh succeeds", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());

      vi.mocked(http.postWithAuth).mockResolvedValue({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresAt: "2099-12-31T23:59:59Z",
      });

      const result = await auth.refreshSession();

      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe("new-access-token");

      const stored = useLocalSessionStore.getState().session;
      expect(stored?.accessToken).toBe("new-access-token");
    });

    it("clears the session when the refresh fails", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());

      vi.mocked(http.postWithAuth).mockRejectedValue(new Error("Token expired"));

      const result = await auth.refreshSession();

      expect(result).toBeNull();
      const stored = useLocalSessionStore.getState().session;
      expect(stored).toBeNull();
    });
  });

  describe("getCurrentSession", () => {
    it("returns the session when one is active", () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());

      const session = auth.getCurrentSession();

      expect(session).not.toBeNull();
      expect(session!.userId).toBe("user-1");
    });

    it("returns null when no session is active", () => {
      const session = auth.getCurrentSession();
      expect(session).toBeNull();
    });
  });

  describe("requireRole", () => {
    it("returns the session when the current role is in the allowed list", () => {
      useLocalSessionStore.getState().setSession(
        makeLocalSession({ role: "ADMIN" }),
      );

      const session = auth.requireRole("ADMIN", "MANAGER");

      expect(session.role).toBe("ADMIN");
    });

    it("throws NoActiveSessionException when there is no session", () => {
      expect(() => auth.requireRole("CASHIER")).toThrow(NoActiveSessionException);
    });

    it("throws InsufficientRoleException when the role is not in the allowed list", () => {
      useLocalSessionStore.getState().setSession(
        makeLocalSession({ role: "CASHIER" }),
      );

      expect(() => auth.requireRole("ADMIN")).toThrow(InsufficientRoleException);
    });
  });

  describe("logout", () => {
    it("clears the session and notifies the server", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue(undefined);

      await auth.logout();

      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/auth/logout",
        {},
        "access-token-abc",
      );
      const stored = useLocalSessionStore.getState().session;
      expect(stored).toBeNull();
    });

    it("clears the session even when the server logout fails", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockRejectedValue(new Error("Network error"));

      await auth.logout();

      const stored = useLocalSessionStore.getState().session;
      expect(stored).toBeNull();
    });
  });

  describe("changePassword", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(
        auth.changePassword("old", "new"),
      ).rejects.toThrow(NoActiveSessionException);
    });

    it("calls the HTTP endpoint when a session exists", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue(undefined);

      await auth.changePassword("old-pass", "new-pass");

      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/auth/change-password",
        { currentPassword: "old-pass", newPassword: "new-pass" },
        "access-token-abc",
      );
    });
  });

  describe("changePin", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(auth.changePin("1234", "5678")).rejects.toThrow(NoActiveSessionException);
    });

    it("calls the HTTP endpoint when a session exists", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue(undefined);

      await auth.changePin("1234", "5678");

      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/auth/change-pin",
        { currentPin: "1234", newPin: "5678" },
        "access-token-abc",
      );
    });
  });

  describe("forgotPassword", () => {
    it("calls the HTTP endpoint and returns a message", async () => {
      vi.mocked(http.post).mockResolvedValue({ message: "Reset link sent" });

      const result = await auth.forgotPassword("user@pharmacy.com");

      expect(http.post).toHaveBeenCalledWith("/auth/forgot-password", {
        email: "user@pharmacy.com",
      });
      expect(result.message).toBe("Reset link sent");
    });
  });
});
