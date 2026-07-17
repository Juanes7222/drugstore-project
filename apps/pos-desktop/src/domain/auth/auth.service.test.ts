/**
 * Unit tests for AuthService — login, session, role-based access control.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createAuthService, type AuthService } from "./auth.service";
import { useLocalSessionStore, type LocalSession } from "./local-session.store";
import { InvalidCredentialsException, NoActiveSessionException, InsufficientRoleException } from "./exceptions";
import type { AuthHttpClient } from "./auth-http-client";
import { RoleType } from "@pharmacy/shared-types";

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

      const session = auth.requireRole(RoleType.ADMIN, RoleType.MANAGER);

      expect(session.role).toBe("ADMIN");
    });

    it("throws NoActiveSessionException when there is no session", () => {
      expect(() => auth.requireRole(RoleType.CASHIER)).toThrow(NoActiveSessionException);
    });

    it("throws InsufficientRoleException when the role is not in the allowed list", () => {
      useLocalSessionStore.getState().setSession(
        makeLocalSession({ role: "CASHIER" }),
      );

      expect(() => auth.requireRole(RoleType.ADMIN)).toThrow(InsufficientRoleException);
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

  describe("resetPassword", () => {
    it("calls the HTTP endpoint with token and new password", async () => {
      vi.mocked(http.post).mockResolvedValue(undefined);

      await auth.resetPassword("reset-token-abc", "new-secure-pass");

      expect(http.post).toHaveBeenCalledWith("/auth/reset-password", {
        token: "reset-token-abc",
        newPassword: "new-secure-pass",
      });
    });

    it("throws when the HTTP client returns an error", async () => {
      vi.mocked(http.post).mockRejectedValue(new Error("Token expired or invalid"));

      await expect(
        auth.resetPassword("bad-token", "new-pass"),
      ).rejects.toThrow("Token expired or invalid");
    });
  });

  describe("requestStepUp", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(
        auth.requestStepUp({
          operationType: "CLOSE_SHIFT",
          workstationId: "ws-1",
          requiredRole: RoleType.MANAGER,
        }),
      ).rejects.toThrow(NoActiveSessionException);
    });

    it("calls the HTTP endpoint when a session exists", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue({
        requestId: "stepup-1",
        status: "PENDING",
      });

      const result = await auth.requestStepUp({
        operationType: "CLOSE_SHIFT",
        workstationId: "ws-1",
        requiredRole: RoleType.MANAGER,
      });

      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/auth/step-up/request",
        {
          operationType: "CLOSE_SHIFT",
          workstationId: "ws-1",
          requiredRole: "MANAGER",
        },
        "access-token-abc",
      );
      expect(result.requestId).toBe("stepup-1");
    });

    it("passes optional operationId and method", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue({ requestId: "stepup-2" });

      await auth.requestStepUp({
        operationType: "VOID_INVOICE",
        operationId: "inv-1",
        workstationId: "ws-1",
        requiredRole: RoleType.MANAGER,
        method: "PIN",
      });

      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/auth/step-up/request",
        {
          operationType: "VOID_INVOICE",
          operationId: "inv-1",
          workstationId: "ws-1",
          requiredRole: "MANAGER",
          method: "PIN",
        },
        "access-token-abc",
      );
    });
  });

  describe("approveStepUp", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(
        auth.approveStepUp("req-1", "PIN"),
      ).rejects.toThrow(NoActiveSessionException);
    });

    it("calls the HTTP endpoint when a session exists", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue({
        approvalToken: "approval-token-xyz",
      });

      const result = await auth.approveStepUp("req-1", "PIN");

      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/auth/step-up/approve",
        { requestId: "req-1", method: "PIN" },
        "access-token-abc",
      );
      expect(result.approvalToken).toBe("approval-token-xyz");
    });
  });

  describe("verifyStepUp", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(
        auth.verifyStepUp("approval-token-xyz"),
      ).rejects.toThrow(NoActiveSessionException);
    });

    it("returns true when the server confirms the token is valid", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue({ valid: true });

      const result = await auth.verifyStepUp("approval-token-xyz");

      expect(result).toBe(true);
      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/auth/step-up/verify",
        { approvalToken: "approval-token-xyz", operationType: undefined },
        "access-token-abc",
      );
    });

    it("returns false when the server rejects the token", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue({ valid: false });

      const result = await auth.verifyStepUp("bad-token");

      expect(result).toBe(false);
    });

    it("passes operationType when provided", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue({ valid: true });

      await auth.verifyStepUp("approval-token-xyz", "VOID_INVOICE");

      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/auth/step-up/verify",
        { approvalToken: "approval-token-xyz", operationType: "VOID_INVOICE" },
        "access-token-abc",
      );
    });
  });

  describe("completeTwoFactor (backup code)", () => {
    it("accepts a backup code as an alternative to TOTP", async () => {
      vi.mocked(http.post).mockResolvedValue({
        accessToken: "token-backup",
        refreshToken: "refresh-backup",
        expiresAt: "2099-12-31T23:59:59Z",
        sessionId: "sess-backup",
        user: {
          id: "user-1",
          role: "MANAGER",
          email: "manager@pharmacy.com",
          username: "manager1",
          displayName: "Manager Backup",
          subscriptionId: "sub-1",
          totpEnabled: true,
          avatarUrl: null,
          avatarColor: null,
          mustChangePassword: false,
        },
      });

      const session = await auth.completeTwoFactor("challenge-abc", undefined, "backup-code-123");

      expect(session.accessToken).toBe("token-backup");
      expect(http.post).toHaveBeenCalledWith("/auth/login/2fa", {
        challengeToken: "challenge-abc",
        totpCode: undefined,
        backupCode: "backup-code-123",
      });

      const stored = useLocalSessionStore.getState().session;
      expect(stored?.accessToken).toBe("token-backup");
    });
  });

  describe("refreshSession (edge cases)", () => {
    it("returns null when the session has no refreshToken", async () => {
      useLocalSessionStore.getState().setSession(
        makeLocalSession({ refreshToken: "" }),
      );

      const result = await auth.refreshSession();

      expect(result).toBeNull();
      expect(http.postWithAuth).not.toHaveBeenCalled();
    });
  });

  describe("createUser", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(
        auth.createUser({ displayName: "New User", role: "CASHIER" }),
      ).rejects.toThrow(NoActiveSessionException);
    });

    it("calls the HTTP endpoint when a session exists", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue({ id: "new-user-1" });

      const result = await auth.createUser({
        displayName: "Nuevo Cajero",
        username: "cajero2",
        email: "cajero2@pharmacy.com",
        role: "CASHIER",
        initialPin: "1234",
        locationIds: ["loc-1"],
      });

      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/users",
        {
          displayName: "Nuevo Cajero",
          username: "cajero2",
          email: "cajero2@pharmacy.com",
          role: "CASHIER",
          initialPin: "1234",
          locationIds: ["loc-1"],
        },
        "access-token-abc",
      );
      expect(result.id).toBe("new-user-1");
    });
  });

  describe("listUsers", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(auth.listUsers()).rejects.toThrow(NoActiveSessionException);
    });

    it("returns users without filters", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.getWithAuth).mockResolvedValue({
        users: [{ id: "u1", displayName: "User One" }],
        total: 1,
      });

      const result = await auth.listUsers();

      expect(result.users).toHaveLength(1);
      expect(http.getWithAuth).toHaveBeenCalledWith("/users?", "access-token-abc");
    });

    it("passes query parameters when filters are provided", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.getWithAuth).mockResolvedValue({ users: [], total: 0 });

      await auth.listUsers({ role: "CASHIER", status: "ACTIVE", limit: 20, offset: 5 });

      expect(http.getWithAuth).toHaveBeenCalledWith(
        "/users?role=CASHIER&status=ACTIVE&limit=20&offset=5",
        "access-token-abc",
      );
    });

    it("passes locationId filter when provided", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.getWithAuth).mockResolvedValue({ users: [], total: 0 });

      await auth.listUsers({ locationId: "loc-1" });

      expect(http.getWithAuth).toHaveBeenCalledWith(
        "/users?locationId=loc-1",
        "access-token-abc",
      );
    });

    it("propagates 403 error from the server when a CASHIER tries to list", async () => {
      useLocalSessionStore.getState().setSession(
        makeLocalSession({ role: "CASHIER" }),
      );
      vi.mocked(http.getWithAuth).mockRejectedValue(
        new Error("[403] Insufficient permissions for this action"),
      );

      await expect(auth.listUsers()).rejects.toThrow("[403]");
    });

    it("propagates network errors from the HTTP client", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.getWithAuth).mockRejectedValue(
        new Error("Failed to fetch"),
      );

      await expect(auth.listUsers()).rejects.toThrow("Failed to fetch");
    });
  });

  describe("disableUser", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(auth.disableUser("user-2")).rejects.toThrow(NoActiveSessionException);
    });

    it("calls POST /users/:id/disable when a session exists", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue({ message: "User disabled" });

      const result = await auth.disableUser("user-2");

      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/users/user-2/disable",
        {},
        "access-token-abc",
      );
      expect(result.message).toBe("User disabled");
    });
  });

  describe("enableUser", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(auth.enableUser("user-2")).rejects.toThrow(NoActiveSessionException);
    });

    it("calls POST /users/:id/enable when a session exists", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue({ message: "User enabled" });

      const result = await auth.enableUser("user-2");

      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/users/user-2/enable",
        {},
        "access-token-abc",
      );
      expect(result.message).toBe("User enabled");
    });
  });

  describe("unlockUser", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(auth.unlockUser("user-2")).rejects.toThrow(NoActiveSessionException);
    });

    it("calls POST /users/:id/unlock when a session exists", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue({ message: "Account unlocked" });

      const result = await auth.unlockUser("user-2");

      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/users/user-2/unlock",
        {},
        "access-token-abc",
      );
      expect(result.message).toBe("Account unlocked");
    });
  });

  describe("resetUserPin", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(auth.resetUserPin("user-2")).rejects.toThrow(NoActiveSessionException);
    });

    it("calls POST /users/:id/reset-pin when a session exists", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.postWithAuth).mockResolvedValue({
        newPin: "123456",
        message: "PIN has been reset",
      });

      const result = await auth.resetUserPin("user-2");

      expect(http.postWithAuth).toHaveBeenCalledWith(
        "/users/user-2/reset-pin",
        {},
        "access-token-abc",
      );
      expect(result.newPin).toBe("123456");
      expect(result.message).toBe("PIN has been reset");
    });
  });

  describe("getPendingStepUpRequests", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(auth.getPendingStepUpRequests()).rejects.toThrow(NoActiveSessionException);
    });

    it("returns pending requests from the server", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.getWithAuth).mockResolvedValue([
        { requestId: "req-1", operationType: "CLOSE_SHIFT" },
      ]);

      const result = await auth.getPendingStepUpRequests();

      expect(result).toHaveLength(1);
      expect(result[0].requestId).toBe("req-1");
      expect(http.getWithAuth).toHaveBeenCalledWith(
        "/auth/step-up/pending",
        "access-token-abc",
      );
    });
  });

  describe("getAuditLogs", () => {
    it("throws NoActiveSessionException when not logged in", async () => {
      await expect(auth.getAuditLogs()).rejects.toThrow(NoActiveSessionException);
    });

    it("returns audit logs without filters", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.getWithAuth).mockResolvedValue({ entries: [], total: 0 });

      const result = await auth.getAuditLogs();

      expect(http.getWithAuth).toHaveBeenCalledWith("/audit?", "access-token-abc");
      expect(result.total).toBe(0);
    });

    it("passes query parameters when filters are provided", async () => {
      useLocalSessionStore.getState().setSession(makeLocalSession());
      vi.mocked(http.getWithAuth).mockResolvedValue({ entries: [], total: 0 });

      await auth.getAuditLogs({
        event: "LOGIN",
        actorId: "user-1",
        fromDate: "2026-01-01",
        toDate: "2026-07-14",
        limit: 50,
        offset: 10,
      });

      expect(http.getWithAuth).toHaveBeenCalledWith(
        "/audit?event=LOGIN&actorId=user-1&fromDate=2026-01-01&toDate=2026-07-14&limit=50&offset=10",
        "access-token-abc",
      );
    });
  });
});
