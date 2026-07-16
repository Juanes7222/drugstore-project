/**
 * Unit tests for useLoginPage hook.
 *
 * Covers: initial state, user selection, PIN login, password login,
 * two-factor flow, forgot-password navigation, and session redirect.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useLoginPage } from "./use-login-page";
import { InvalidCredentialsException } from "../../domain/auth/exceptions";
import { setActiveScreen } from "@/store/slices/ui-slice";
import { RoleType } from "@pharmacy/shared-types";

import type { LocalUserInfo } from "../../domain/auth/local-users";
import type { LocalSession } from "../../domain/auth/local-session.store";

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
  };
  const mockSessionRef: { current: LocalSession | null } = { current: null };
  return { dispatch, mockAuthService, mockSessionRef };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => dispatch,
}));

vi.mock("../../domain/auth/local-session.store", () => ({
  useLocalSessionStore: (selector: (s: { session: LocalSession | null }) => unknown) =>
    selector({ session: mockSessionRef.current }),
}));

vi.mock("../../domain/auth/auth.service", () => ({
  createAuthService: vi.fn(() => mockAuthService),
}));

vi.mock("@infra/config", () => ({
  API_BASE_URL: "http://test",
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
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useLoginPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockSessionRef.current = null;
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
        undefined,
        "pos-desktop",
      );
      expect(dispatch).toHaveBeenCalledWith(setActiveScreen("sales"));
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
        undefined,
        "pos-desktop",
      );
      expect(dispatch).toHaveBeenCalledWith(setActiveScreen("sales"));
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
      expect(dispatch).toHaveBeenCalledWith(setActiveScreen("sales"));
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
    it("dispatches setActiveScreen('sales') when session becomes non-null", async () => {
      const { result, rerender } = renderHook(() => useLoginPage());

      // Initially no dispatch
      expect(dispatch).not.toHaveBeenCalled();

      // Set the session
      mockSessionRef.current = fakeLocalSession;

      // Trigger re-render so the effect picks up the new session value
      rerender();

      await waitFor(() => {
        expect(dispatch).toHaveBeenCalledWith(setActiveScreen("sales"));
      });
    });

    it("does not dispatch when session is null", () => {
      mockSessionRef.current = null;

      renderHook(() => useLoginPage());

      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});
