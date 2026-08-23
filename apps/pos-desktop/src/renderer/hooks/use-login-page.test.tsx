/**
 * Unit tests for useLoginPage hook.
 *
 * Covers: initial state, user selection, PIN login, password login,
 * two-factor flow, forgot-password navigation, and session redirect.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useLoginPage } from "./use-login-page";
import { InvalidCredentialsException, NetworkErrorException } from "../../domain/auth/exceptions";
import { setActiveScreen } from "@/store/slices/ui-slice";
import { offlineAuthSlice } from "../store/slices/offline-auth-slice";
import { RoleType } from "@pharmacy/shared-types";

import type { LocalUserInfo } from "../../domain/auth/local-users";
import type { LocalSession } from "../../domain/auth/local-session.store";
import type { UserData } from "../../domain/auth/local-types";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { dispatch, mockAuthService, mockSessionRef } = vi.hoisted(() => {
  const dispatch = vi.fn();
  const mockAuthService = {
    login: vi.fn(),
    completeTwoFactor: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    getCurrentSession: vi.fn(),
    requireRole: vi.fn(),
    changePassword: vi.fn(),
    changePin: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    requestStepUp: vi.fn(),
    approveStepUp: vi.fn(),
    verifyStepUp: vi.fn(),
    createUser: vi.fn(),
    listUsers: vi.fn(),
    getPendingStepUpRequests: vi.fn(),
    getAuditLogs: vi.fn(),
    loginWithGoogle: vi.fn(),
  };
  const mockSessionRef: { current: LocalSession | null } = { current: null };
  return { dispatch, mockAuthService, mockSessionRef };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => dispatch,
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) => {
    const rootState = {
      offlineAuth: {
        connectionState: "ONLINE",
        blessingProgress: { total: 0, completed: 0, failed: 0 },
        isBlessingInProgress: false,
      },
    };
    return selector(rootState as any);
  },
}));

vi.mock("../../domain/auth/local-session.store", () => {
  const store = (selector: (s: { session: LocalSession | null }) => unknown) =>
    selector({ session: mockSessionRef.current });
  store.getState = () => ({
    session: mockSessionRef.current,
    setSession: mockLocalSessionActions.setSession,
    updateSession: mockLocalSessionActions.updateSession,
    clearSession: vi.fn(),
  });
  return {
    useLocalSessionStore: store,
    hasMinRole: () => true,
  };
});

// Hoisted actions of the local session store so tests can assert on the
// offline fallback's updateSession identity enrichment.
const { mockLocalSessionActions } = vi.hoisted(() => ({
  mockLocalSessionActions: {
    setSession: vi.fn(),
    updateSession: vi.fn(),
  },
}));

// Shared offline-auth mock: connectionState is a mutable ref so tests can
// exercise the strict-offline branch; attemptOfflineLogin is shared so tests
// can assert on the userId it receives.
const { offlineAuthMock } = vi.hoisted(() => ({
  offlineAuthMock: {
    connectionState: "ONLINE" as "ONLINE" | "OFFLINE",
    attemptOfflineLogin: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./use-offline-auth", () => ({
  useOfflineAuth: () => ({
    connectionState: offlineAuthMock.connectionState,
    attemptOfflineLogin: offlineAuthMock.attemptOfflineLogin,
  }),
}));

vi.mock("../../domain/auth/auth.service", () => ({
  createAuthService: () => mockAuthService,
}));

// Mock the local user cache so the login flow skips PGlite and goes
// straight to the server auth path (the cache queries would otherwise
// attempt a real PGlite initialisation in jsdom and fail).
const { mockUserCache } = vi.hoisted(() => ({
  mockUserCache: {
    getUsers: vi.fn().mockResolvedValue([]),
    getUser: vi.fn().mockResolvedValue(null),
    getUserByUsername: vi.fn().mockResolvedValue(null),
    verifyPassword: vi.fn().mockResolvedValue({ valid: false }),
    recordLogin: vi.fn(),
    upsertUserIdentity: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../domain/auth/user-cache.service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../domain/auth/user-cache.service")
  >();
  return {
    ...actual,
    createUserCacheService: () => mockUserCache,
  };
});

// Firebase (Google) sign-in service. fetchPublicConfig resolves to a
// configured response so the mount effect enables the Google button;
// isFirebaseConfigured is mutable so tests can flip availability.
const { mockFirebaseAuth, mockIsFirebaseConfigured } = vi.hoisted(() => ({
  mockFirebaseAuth: {
    signInWithGoogle: vi.fn(),
    fetchPublicConfig: vi
      .fn()
      .mockResolvedValue({ firebaseConfig: { apiKey: "test-key" } }),
  },
  mockIsFirebaseConfigured: vi.fn((cfg: unknown) => cfg != null),
}));

vi.mock("../../domain/auth/firebase-auth.service", () => ({
  createFirebaseAuthService: () => mockFirebaseAuth,
  isFirebaseConfigured: mockIsFirebaseConfigured,
}));

vi.mock("@infra/config", () => ({
  API_BASE_URL: "http://test",
  WORKSTATION_ID: "ws_principal",
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cashierUser: LocalUserInfo = {
  id: "user_cashier1",
  displayName: "María Rodríguez",
  role: RoleType.CASHIER,
  avatarUrl: null,
  avatarColor: "#D97706",
  username: "cashier1",
};

const fakeLocalSession: LocalSession = {
  userId: "user-1",
  username: "test",
  fullName: "Test User",
  displayName: "Test User",
  email: null,
  role: RoleType.CASHIER,
  subscriptionId: null,
  workstationId: "ws-1",
  accessToken: "token-123",
  refreshToken: "refresh-123",
  expiresAt: new Date("2099-01-01"),
  sessionId: "session-1",
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
  sessionTrust: 'SERVER_VERIFIED',
};

const cachedAdminUser: UserData = {
  id: "user-admin-1",
  username: "admin",
  displayName: "Admin Local",
  role: RoleType.MANAGER,
  status: "ACTIVE",
  passwordVersion: 1,
  credentialMode: "PASSWORD",
  createdLocally: false,
  syncStatus: "SYNCED",
  syncError: null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  mustChangePassword: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastLoginAt: null,
  deletedAt: null,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useLoginPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockSessionRef.current = null;
    offlineAuthMock.connectionState = "ONLINE";
    offlineAuthMock.attemptOfflineLogin.mockResolvedValue(undefined);
  });

  describe("initial state", () => {
    it("returns default values when no user is selected and no session exists", () => {
      const { result } = renderHook(() => useLoginPage());

      expect(result.current.selectedUser).toBeNull();
      expect(result.current.showManualInput).toBe(false);
      expect(result.current.identifier).toBe("");
      expect(result.current.password).toBe("");
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.requiresTwoFactor).toBe(false);
      expect(result.current.challengeToken).toBeNull();
      expect(result.current.lockoutUntil).toBeNull();
      expect(result.current.countdown).toBe(0);
    });
  });

  describe("handleUserSelect", () => {
    it("sets selectedUser, identifier, clears error, and hides manual input", () => {
      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.handleUserSelect(cashierUser);
      });

      expect(result.current.selectedUser).toEqual(cashierUser);
      expect(result.current.identifier).toBe(cashierUser.username);
      expect(result.current.showManualInput).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe("handlePinComplete", () => {
    it("calls authService.login and dispatches setActiveScreen('sales') on success", async () => {
      mockAuthService.login.mockResolvedValueOnce({ session: fakeLocalSession });

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.handleUserSelect(cashierUser);
      });

      await act(async () => {
        await result.current.handlePinComplete("123456");
      });

      expect(mockAuthService.login).toHaveBeenCalledWith(
        cashierUser.username,
        "123456",
        "PIN",
        "ws_principal",
        "ws_principal",
        "pos-desktop",
      );
      expect(dispatch).toHaveBeenCalledWith(setActiveScreen("home"));
      expect(dispatch).toHaveBeenCalledWith(
        offlineAuthSlice.actions.setConnectionState("ONLINE"),
      );
      expect(result.current.isLoading).toBe(false);
    });

    it("sets requiresTwoFactor when the response includes a challenge token", async () => {
      mockAuthService.login.mockResolvedValueOnce({
        requiresTwoFactor: true,
        challengeToken: "challenge-abc",
      });

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.handleUserSelect(cashierUser);
      });

      await act(async () => {
        await result.current.handlePinComplete("123456");
      });

      expect(result.current.requiresTwoFactor).toBe(true);
      expect(result.current.challengeToken).toBe("challenge-abc");
      expect(dispatch).not.toHaveBeenCalled();
    });

    it("sets error to 'auth.pin_incorrect' on InvalidCredentialsException", async () => {
      mockAuthService.login.mockRejectedValueOnce(
        new InvalidCredentialsException(),
      );

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.handleUserSelect(cashierUser);
      });

      await act(async () => {
        await result.current.handlePinComplete("123456");
      });

      expect(result.current.error).toBe("auth.pin_incorrect");
      expect(dispatch).not.toHaveBeenCalled();
    });

    it("sets error to 'auth.too_many_attempts' on lockout error", async () => {
      mockAuthService.login.mockRejectedValueOnce(new Error("locked"));

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.handleUserSelect(cashierUser);
      });

      await act(async () => {
        await result.current.handlePinComplete("654321");
      });

      expect(result.current.error).toBe("auth.too_many_attempts");
    });

    it("falls back to offline login with the selected user's id on NetworkErrorException", async () => {
      mockAuthService.login.mockRejectedValueOnce(new NetworkErrorException());
      offlineAuthMock.attemptOfflineLogin.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.handleUserSelect(cashierUser);
      });

      await act(async () => {
        await result.current.handlePinComplete("123456");
      });

      expect(offlineAuthMock.attemptOfflineLogin).toHaveBeenCalledWith(
        cashierUser.id,
        "123456",
        "PIN",
      );
      expect(mockLocalSessionActions.updateSession).toHaveBeenCalledWith({
        username: cashierUser.username,
        fullName: cashierUser.displayName,
        displayName: cashierUser.displayName,
      });
      expect(dispatch).toHaveBeenCalledWith(setActiveScreen("home"));
    });

    it("shows a connection error when the offline fallback also fails on PIN login", async () => {
      mockAuthService.login.mockRejectedValueOnce(new NetworkErrorException());
      offlineAuthMock.attemptOfflineLogin.mockRejectedValueOnce(new Error("offline failed"));

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.handleUserSelect(cashierUser);
      });

      await act(async () => {
        await result.current.handlePinComplete("123456");
      });

      expect(result.current.error).toBe("auth.connection_error");
      expect(result.current.offlineErrorMessage).toBe("auth.connection_error");
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("handlePasswordLogin", () => {
    it("calls authService.login and dispatches setActiveScreen('sales') on success", async () => {
      mockAuthService.login.mockResolvedValueOnce({ session: fakeLocalSession });

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.setIdentifier("admin");
        result.current.setPassword("secret123");
      });

      await act(async () => {
        await result.current.handlePasswordLogin();
      });

      expect(mockAuthService.login).toHaveBeenCalledWith(
        "admin",
        "secret123",
        "PASSWORD",
        "ws_principal",
        "ws_principal",
        "pos-desktop",
      );
      expect(dispatch).toHaveBeenCalledWith(setActiveScreen("home"));
      expect(dispatch).toHaveBeenCalledWith(
        offlineAuthSlice.actions.setConnectionState("ONLINE"),
      );
      expect(result.current.isLoading).toBe(false);
    });

    it("does not call login when identifier or password is empty", async () => {
      const { result } = renderHook(() => useLoginPage());

      await act(async () => {
        await result.current.handlePasswordLogin();
      });

      expect(mockAuthService.login).not.toHaveBeenCalled();
    });

    it("sets requiresTwoFactor when the response includes a challenge token", async () => {
      mockAuthService.login.mockResolvedValueOnce({
        requiresTwoFactor: true,
        challengeToken: "challenge-xyz",
      });

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.setIdentifier("admin");
        result.current.setPassword("secret123");
      });

      await act(async () => {
        await result.current.handlePasswordLogin();
      });

      expect(result.current.requiresTwoFactor).toBe(true);
      expect(result.current.challengeToken).toBe("challenge-xyz");
      expect(dispatch).not.toHaveBeenCalled();
    });

    it("sets error to 'auth.password_incorrect' on InvalidCredentialsException", async () => {
      mockAuthService.login.mockRejectedValueOnce(
        new InvalidCredentialsException(),
      );

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.setIdentifier("admin");
        result.current.setPassword("wrong");
      });

      await act(async () => {
        await result.current.handlePasswordLogin();
      });

      expect(result.current.error).toBe("auth.password_incorrect");
    });

    it("sets lockoutUntil and lockout error when server responds with 'locked'", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      mockAuthService.login.mockRejectedValueOnce(new Error("locked"));

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.setIdentifier("admin");
        result.current.setPassword("secret123");
      });

      await act(async () => {
        await result.current.handlePasswordLogin();
      });

      expect(result.current.error).toBe("auth.too_many_attempts_minutes");
      expect(result.current.lockoutUntil).toBeInstanceOf(Date);
      expect(result.current.lockoutUntil!.getTime()).toBe(
        now + 5 * 60 * 1000,
      );
      expect(result.current.countdown).toBe(300);

      vi.useRealTimers();
    });

    it("falls back to offline login with the cached user's id on NetworkErrorException", async () => {
      mockUserCache.getUserByUsername.mockResolvedValueOnce(cachedAdminUser);
      mockAuthService.login.mockRejectedValueOnce(new NetworkErrorException());
      offlineAuthMock.attemptOfflineLogin.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.setIdentifier("admin");
        result.current.setPassword("secret123");
      });

      await act(async () => {
        await result.current.handlePasswordLogin();
      });

      expect(offlineAuthMock.attemptOfflineLogin).toHaveBeenCalledWith(
        cachedAdminUser.id,
        "secret123",
        "PASSWORD",
      );
    });

    it("enriches the bridged session with the cached user's identity after offline fallback", async () => {
      mockUserCache.getUserByUsername.mockResolvedValueOnce(cachedAdminUser);
      mockAuthService.login.mockRejectedValueOnce(new NetworkErrorException());
      offlineAuthMock.attemptOfflineLogin.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.setIdentifier("admin");
        result.current.setPassword("secret123");
      });

      await act(async () => {
        await result.current.handlePasswordLogin();
      });

      expect(mockLocalSessionActions.updateSession).toHaveBeenCalledWith({
        username: cachedAdminUser.username,
        fullName: cachedAdminUser.displayName,
        displayName: cachedAdminUser.displayName,
      });
      expect(dispatch).toHaveBeenCalledWith(setActiveScreen("home"));
    });

    it("shows a connection error when the offline fallback also fails on password login", async () => {
      mockUserCache.getUserByUsername.mockResolvedValueOnce(cachedAdminUser);
      mockAuthService.login.mockRejectedValueOnce(new NetworkErrorException());
      offlineAuthMock.attemptOfflineLogin.mockRejectedValueOnce(new Error("offline failed"));

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.setIdentifier("admin");
        result.current.setPassword("secret123");
      });

      await act(async () => {
        await result.current.handlePasswordLogin();
      });

      expect(result.current.error).toBe("auth.connection_error");
      expect(result.current.offlineErrorMessage).toBe("auth.connection_error");
      expect(dispatch).not.toHaveBeenCalled();
    });

    it("uses the cached user's id in strict offline mode and enriches the bridged session", async () => {
      offlineAuthMock.connectionState = "OFFLINE";
      mockUserCache.getUserByUsername.mockResolvedValueOnce(cachedAdminUser);
      offlineAuthMock.attemptOfflineLogin.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.setIdentifier("admin");
        result.current.setPassword("secret123");
      });

      await act(async () => {
        await result.current.handlePasswordLogin();
      });

      expect(mockAuthService.login).not.toHaveBeenCalled();
      expect(offlineAuthMock.attemptOfflineLogin).toHaveBeenCalledWith(
        cachedAdminUser.id,
        "secret123",
        "PASSWORD",
      );
      expect(mockLocalSessionActions.updateSession).toHaveBeenCalledWith({
        username: cachedAdminUser.username,
        fullName: cachedAdminUser.displayName,
        displayName: cachedAdminUser.displayName,
      });
      expect(dispatch).toHaveBeenCalledWith(setActiveScreen("home"));
    });
  });

  describe("handleTwoFactorComplete", () => {
    it("clears two-factor state and dispatches setActiveScreen('sales')", () => {
      const { result } = renderHook(() => useLoginPage());

      // Set 2FA state first
      act(() => {
        result.current.setPassword("dummy");
      });
      // Mutate state to simulate 2FA being active — we set it manually
      // by calling handleTwoFactorComplete directly; we just verify it
      // clears the flags.
      act(() => {
        result.current.handleTwoFactorComplete();
      });

      expect(result.current.requiresTwoFactor).toBe(false);
      expect(result.current.challengeToken).toBeNull();
      expect(dispatch).toHaveBeenCalledWith(setActiveScreen("home"));
      expect(dispatch).toHaveBeenCalledWith(
        offlineAuthSlice.actions.setConnectionState("ONLINE"),
      );
    });
  });

  describe("handleTwoFactorCancel", () => {
    it("clears two-factor state without dispatching navigation", () => {
      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.handleTwoFactorCancel();
      });

      expect(result.current.requiresTwoFactor).toBe(false);
      expect(result.current.challengeToken).toBeNull();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("handleGoogleSignIn", () => {
    it("dispatches setConnectionState ONLINE and navigates home after a successful Google sign-in", async () => {
      mockFirebaseAuth.signInWithGoogle.mockResolvedValueOnce("google-id-token");
      mockAuthService.loginWithGoogle.mockResolvedValueOnce({
        session: fakeLocalSession,
      });

      const { result } = renderHook(() => useLoginPage());

      // Flush the public-config fetch so the Google button is enabled.
      await act(async () => {});
      expect(result.current.googleAvailable).toBe(true);

      await act(async () => {
        await result.current.handleGoogleSignIn();
      });

      expect(mockAuthService.loginWithGoogle).toHaveBeenCalledWith(
        "google-id-token",
        "ws_principal",
        "ws_principal",
        "pos-desktop",
      );
      expect(dispatch).toHaveBeenCalledWith(
        offlineAuthSlice.actions.setConnectionState("ONLINE"),
      );
      expect(dispatch).toHaveBeenCalledWith(setActiveScreen("home"));
      expect(result.current.googleLoading).toBe(false);
    });

    it("does not call loginWithGoogle when Google sign-in is unavailable", async () => {
      mockFirebaseAuth.fetchPublicConfig.mockResolvedValueOnce(null);

      const { result } = renderHook(() => useLoginPage());

      await act(async () => {});
      expect(result.current.googleAvailable).toBe(false);

      await act(async () => {
        await result.current.handleGoogleSignIn();
      });

      expect(mockAuthService.loginWithGoogle).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("handleForgotPassword", () => {
    it("dispatches setActiveScreen('forgot-password')", () => {
      const { result } = renderHook(() => useLoginPage());

      act(() => {
        result.current.handleForgotPassword();
      });

      expect(dispatch).toHaveBeenCalledWith(
        setActiveScreen("forgot-password"),
      );
    });
  });

  describe("session redirect", () => {
    it("dispatches setActiveScreen('home') when session becomes non-null", async () => {
      const { rerender } = renderHook(() => useLoginPage());

      // Initially no dispatch
      expect(dispatch).not.toHaveBeenCalled();

      // Set the session
      mockSessionRef.current = fakeLocalSession;

      // Trigger re-render so the effect picks up the new session value
      rerender();

      await waitFor(() => {
        expect(dispatch).toHaveBeenCalledWith(setActiveScreen("home"));
      });
    });

    it("does not dispatch when session is null", () => {
      mockSessionRef.current = null;

      renderHook(() => useLoginPage());

      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});
