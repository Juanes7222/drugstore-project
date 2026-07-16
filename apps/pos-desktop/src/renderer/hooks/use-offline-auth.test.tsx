/**
 * Unit tests for useOfflineAuth hook.
 *
 * Covers the returned state values, blessing trigger on online transition,
 * attemptOfflineLogin, logoutOffline, triggerBlessing, and checkConnectionState.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useOfflineAuth, type UseOfflineAuthReturn } from "./use-offline-auth";
import type { OfflineSession, OfflineLoginResult } from "../../domain/auth/offline/types";
import type { LocalSession } from "../../domain/auth/local-session.store";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { dispatchMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
}));

// Mutable refs for selectors and zustand state
const { selectorsMock, zustandSessionsMock, zustandCurrentSessionIdRef } = vi.hoisted(() => ({
  selectorsMock: {
    connectionState: "ONLINE" as "ONLINE" | "OFFLINE" | "RECONNECTING",
    blessingProgress: { total: 0, completed: 0, failed: 0 },
    isBlessingInProgress: false,
  },
  zustandSessionsMock: [] as OfflineSession[],
  zustandCurrentSessionIdRef: { current: null as string | null },
}));

// Mock auth service
const { authServiceMock } = vi.hoisted(() => {
  const authServiceMock = {
    attemptOfflineLogin: vi.fn(),
    blessPendingSessions: vi.fn(),
    fetchRevocationList: vi.fn(),
    updateCachedCredentials: vi.fn(),
    logoutOffline: vi.fn(),
    getOfflineSessionStore: vi.fn(),
    isOfflineLoginAvailable: vi.fn(),
  };
  return { authServiceMock };
});

// Mock HTTP client for checkConnectionState
const { httpClientMock } = vi.hoisted(() => ({
  httpClientMock: {
    post: vi.fn(),
    postWithAuth: vi.fn(),
    getWithAuth: vi.fn(),
  },
}));

// Mutable online session ref for useLocalSessionStore
const { onlineSessionRef } = vi.hoisted(() => ({
  onlineSessionRef: { current: null as LocalSession | null },
}));

// ---------------------------------------------------------------------------
// vi.mock calls
// ---------------------------------------------------------------------------

vi.mock("../store/hooks", () => ({
  useAppDispatch: () => dispatchMock,
  useAppSelector: (selector: (state: any) => unknown) => {
    // Match selectors by calling them with a mock root state
    const rootState = {
      offlineAuth: {
        connectionState: selectorsMock.connectionState,
        lastRevocationListFetch: null,
        lastBlessingAttempt: null,
        isBlessingInProgress: selectorsMock.isBlessingInProgress,
        blessingProgress: selectorsMock.blessingProgress,
        error: null,
      },
    };
    return selector(rootState);
  },
}));

vi.mock("./use-online-status", () => ({
  useOnlineStatus: vi.fn(),
}));

vi.mock("../store/slices/offline-auth-slice", () => ({
  offlineAuthSlice: {
    actions: {
      setConnectionState: vi.fn((state: string) => ({
        type: "offlineAuth/setConnectionState",
        payload: state,
      })),
      setError: vi.fn((err: string | null) => ({
        type: "offlineAuth/setError",
        payload: err,
      })),
      setBlessingInProgress: vi.fn((val: boolean) => ({
        type: "offlineAuth/setBlessingInProgress",
        payload: val,
      })),
      setBlessingProgress: vi.fn((progress: any) => ({
        type: "offlineAuth/setBlessingProgress",
        payload: progress,
      })),
      setLastBlessingAttempt: vi.fn((ts: string | null) => ({
        type: "offlineAuth/setLastBlessingAttempt",
        payload: ts,
      })),
    },
  },
  selectConnectionState: (state: any) => state.offlineAuth.connectionState,
  selectBlessingProgress: (state: any) => state.offlineAuth.blessingProgress,
  selectIsBlessingInProgress: (state: any) => state.offlineAuth.isBlessingInProgress,
}));

vi.mock("../../domain/auth/offline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../domain/auth/offline")>();
  return {
    ...actual,
    useOfflineSessionStore: Object.assign(
      (selector: (s: any) => unknown) => {
        const state = {
          sessions: zustandSessionsMock,
          currentSessionId: zustandCurrentSessionIdRef.current,
        };
        return selector(state);
      },
      {
        getState: () => ({
          sessions: zustandSessionsMock,
          currentSessionId: zustandCurrentSessionIdRef.current,
          updateSession: vi.fn((_id: string, _updates: any) => {
            // no-op: we don't need to simulate updates for these tests
          }),
        }),
        setState: vi.fn(),
        subscribe: vi.fn(),
        destroy: vi.fn(),
      },
    ),
  };
});

vi.mock("../../domain/auth/local-session.store", () => ({
  useLocalSessionStore: {
    getState: vi.fn(() => ({
      session: onlineSessionRef.current,
      clearSession: vi.fn(),
    })),
  },
}));

vi.mock("../services/auth/offline/offline-auth-service", () => ({
  createOfflineAuthService: vi.fn(() => authServiceMock),
}));

vi.mock("../../domain/auth/auth-http-client", () => ({
  createAuthHttpClient: vi.fn(() => httpClientMock),
}));

vi.mock("../../infrastructure/config", () => ({
  API_BASE_URL: "http://test",
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeOfflineSession = (overrides: Partial<OfflineSession> = {}): OfflineSession => ({
  localSessionId: "sess-1",
  userId: "user-1",
  username: "cajero1",
  displayName: "Cajero Uno",
  role: "CASHIER",
  subscriptionId: "sub-1",
  offlineToken: "offline-token",
  workstationFingerprint: "ws-1",
  createdAt: new Date("2026-07-15T10:00:00Z"),
  lastActiveAt: new Date("2026-07-15T10:00:00Z"),
  isBlessed: false,
  ...overrides,
});

const makeOnlineSession = (overrides: Partial<LocalSession> = {}): LocalSession => ({
  userId: "user-1",
  username: "cajero1",
  fullName: "Cajero Uno",
  displayName: "Cajero Uno",
  email: "cajero@pharmacy.com",
  role: "CASHIER",
  subscriptionId: "sub-1",
  workstationId: "ws-1",
  accessToken: "access-token-123",
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
// Suite
// ---------------------------------------------------------------------------

describe("useOfflineAuth", () => {
  let useOnlineStatusMock: () => boolean;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset mutable refs
    selectorsMock.connectionState = "ONLINE";
    selectorsMock.blessingProgress = { total: 0, completed: 0, failed: 0 };
    selectorsMock.isBlessingInProgress = false;
    zustandSessionsMock.length = 0;
    zustandCurrentSessionIdRef.current = null;
    onlineSessionRef.current = null;

    // Default online status mock (browser is online)
    const useOnlineStatusModule = await import("./use-online-status");
    useOnlineStatusMock = vi.mocked(useOnlineStatusModule.useOnlineStatus);
    useOnlineStatusMock.mockReturnValue(true);

    // Default auth service mock for getOfflineSessionStore
    authServiceMock.getOfflineSessionStore.mockReturnValue({
      getState: vi.fn(() => ({
        getCurrentSession: vi.fn(() => null),
        sessions: zustandSessionsMock,
        currentSessionId: zustandCurrentSessionIdRef.current,
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  describe("initial state", () => {
    it("returns default values when no sessions exist", () => {
      const { result } = renderHook(() => useOfflineAuth());

      expect(result.current.connectionState).toBe("ONLINE");
      expect(result.current.currentOfflineSession).toBeNull();
      expect(result.current.pendingBlessings).toEqual([]);
      expect(result.current.isBlessingInProgress).toBe(false);
      expect(result.current.blessingProgress).toEqual({ total: 0, completed: 0, failed: 0 });
    });

    it("derives the current offline session from the store", () => {
      const session = makeOfflineSession({ localSessionId: "sess-current" });
      zustandSessionsMock.push(session);
      zustandCurrentSessionIdRef.current = "sess-current";

      const { result } = renderHook(() => useOfflineAuth());

      expect(result.current.currentOfflineSession).not.toBeNull();
      expect(result.current.currentOfflineSession!.localSessionId).toBe("sess-current");
    });

    it("derives pending blessings from un-blessed sessions", () => {
      const blessed = makeOfflineSession({
        localSessionId: "sess-blessed",
        isBlessed: true,
      });
      const pending = makeOfflineSession({
        localSessionId: "sess-pending",
        isBlessed: false,
      });
      const rejected = makeOfflineSession({
        localSessionId: "sess-rejected",
        isBlessed: false,
        rejectedAt: new Date(),
      });
      zustandSessionsMock.push(blessed, pending, rejected);

      const { result } = renderHook(() => useOfflineAuth());

      expect(result.current.pendingBlessings).toHaveLength(1);
      expect(result.current.pendingBlessings[0].localSessionId).toBe("sess-pending");
    });
  });

  // -----------------------------------------------------------------------
  // attemptOfflineLogin
  // -----------------------------------------------------------------------

  describe("attemptOfflineLogin", () => {
    it("calls authService.attemptOfflineLogin with the workstation fingerprint", async () => {
      const session = makeOfflineSession();
      authServiceMock.attemptOfflineLogin.mockResolvedValueOnce({ session });

      const { result } = renderHook(() => useOfflineAuth());

      const loginResult = await act(async () => {
        return result.current.attemptOfflineLogin("user-1", "1234", "PIN");
      });

      expect(authServiceMock.attemptOfflineLogin).toHaveBeenCalledWith(
        "user-1",
        "1234",
        "PIN",
        "local-workstation",
      );
      expect(loginResult.session.localSessionId).toBe(session.localSessionId);
    });

    it("uses online session workstationId when available", async () => {
      onlineSessionRef.current = makeOnlineSession({ workstationId: "ws-online" });
      const session = makeOfflineSession();
      authServiceMock.attemptOfflineLogin.mockResolvedValueOnce({ session });

      const { result } = renderHook(() => useOfflineAuth());

      await act(async () => {
        await result.current.attemptOfflineLogin("user-1", "1234", "PIN");
      });

      expect(authServiceMock.attemptOfflineLogin).toHaveBeenCalledWith(
        "user-1",
        "1234",
        "PIN",
        "ws-online",
      );
    });

    it("dispatches setConnectionState OFFLINE after successful offline login", async () => {
      const session = makeOfflineSession();
      authServiceMock.attemptOfflineLogin.mockResolvedValueOnce({ session });

      const { result } = renderHook(() => useOfflineAuth());

      await act(async () => {
        await result.current.attemptOfflineLogin("user-1", "1234", "PIN");
      });

      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "offlineAuth/setConnectionState",
          payload: "OFFLINE",
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // logoutOffline
  // -----------------------------------------------------------------------

  describe("logoutOffline", () => {
    it("calls authService.logoutOffline when a current session exists", async () => {
      const session = makeOfflineSession();
      zustandSessionsMock.push(session);
      zustandCurrentSessionIdRef.current = session.localSessionId;
      authServiceMock.getOfflineSessionStore.mockReturnValue({
        getState: vi.fn(() => ({
          getCurrentSession: vi.fn(() => session),
          sessions: zustandSessionsMock,
        currentSessionId: zustandCurrentSessionIdRef.current,
        })),
      });

      const { result } = renderHook(() => useOfflineAuth());

      await act(async () => {
        await result.current.logoutOffline();
      });

      expect(authServiceMock.logoutOffline).toHaveBeenCalledWith(session.localSessionId);
    });

    it("does not call logoutOffline when no current session exists", async () => {
      authServiceMock.getOfflineSessionStore.mockReturnValue({
        getState: vi.fn(() => ({
          getCurrentSession: vi.fn(() => null),
          sessions: [],
          currentSessionId: null,
        })),
      });

      const { result } = renderHook(() => useOfflineAuth());

      await act(async () => {
        await result.current.logoutOffline();
      });

      expect(authServiceMock.logoutOffline).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // triggerBlessing
  // -----------------------------------------------------------------------

  describe("triggerBlessing", () => {
    it("calls blessPendingSessions and updates sessions on success", async () => {
      const pending = makeOfflineSession({ localSessionId: "sess-pending" });
      zustandSessionsMock.push(pending);

      onlineSessionRef.current = makeOnlineSession({ accessToken: "test-token" });

      authServiceMock.blessPendingSessions.mockResolvedValueOnce([
        { localSessionId: "sess-pending", status: "BLESSED" as const },
      ]);

      const { result } = renderHook(() => useOfflineAuth());

      await act(async () => {
        await result.current.triggerBlessing();
      });

      expect(authServiceMock.blessPendingSessions).toHaveBeenCalledWith(
        [pending],
        "test-token",
      );
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "offlineAuth/setBlessingInProgress",
          payload: false,
        }),
      );
    });

    it("returns early when no un-blessed sessions exist", async () => {
      zustandSessionsMock.push(
        makeOfflineSession({ localSessionId: "sess-blessed", isBlessed: true }),
      );

      const { result } = renderHook(() => useOfflineAuth());

      await act(async () => {
        await result.current.triggerBlessing();
      });

      expect(authServiceMock.blessPendingSessions).not.toHaveBeenCalled();
    });

    it("dispatches an error when no online session access token exists", async () => {
      const pending = makeOfflineSession({ localSessionId: "sess-pending" });
      zustandSessionsMock.push(pending);
      onlineSessionRef.current = null;

      const { result } = renderHook(() => useOfflineAuth());

      await act(async () => {
        await result.current.triggerBlessing();
      });

      expect(authServiceMock.blessPendingSessions).not.toHaveBeenCalled();
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "offlineAuth/setError",
        }),
      );
    });

    it("handles blessing API errors gracefully", async () => {
      const pending = makeOfflineSession({ localSessionId: "sess-pending" });
      zustandSessionsMock.push(pending);
      onlineSessionRef.current = makeOnlineSession({ accessToken: "test-token" });

      authServiceMock.blessPendingSessions.mockRejectedValueOnce(
        new Error("Network error"),
      );

      const { result } = renderHook(() => useOfflineAuth());

      await act(async () => {
        await result.current.triggerBlessing();
      });

      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "offlineAuth/setError",
          payload: "Network error",
        }),
      );
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "offlineAuth/setBlessingInProgress",
          payload: false,
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // checkConnectionState
  // -----------------------------------------------------------------------

  describe("checkConnectionState", () => {
    it("sets state to OFFLINE when no online session has an access token", async () => {
      onlineSessionRef.current = makeOnlineSession({ accessToken: "" });

      const { result } = renderHook(() => useOfflineAuth());

      await act(async () => {
        await result.current.checkConnectionState();
      });

      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "offlineAuth/setConnectionState",
          payload: "OFFLINE",
        }),
      );
    });

    it("sets state to ONLINE when the server responds successfully", async () => {
      onlineSessionRef.current = makeOnlineSession({ accessToken: "valid-token" });
      httpClientMock.getWithAuth.mockResolvedValueOnce({ id: "user-1" });

      const { result } = renderHook(() => useOfflineAuth());

      await act(async () => {
        await result.current.checkConnectionState();
      });

      expect(httpClientMock.getWithAuth).toHaveBeenCalledWith(
        "/auth/me",
        "valid-token",
      );
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "offlineAuth/setConnectionState",
          payload: "ONLINE",
        }),
      );
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "offlineAuth/setError",
          payload: null,
        }),
      );
    });

    it("sets state to RECONNECTING when the server request fails", async () => {
      onlineSessionRef.current = makeOnlineSession({ accessToken: "valid-token" });
      httpClientMock.getWithAuth.mockRejectedValueOnce(new Error("Server error"));

      const { result } = renderHook(() => useOfflineAuth());

      await act(async () => {
        await result.current.checkConnectionState();
      });

      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "offlineAuth/setConnectionState",
          payload: "RECONNECTING",
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Online transition → automatic blessing
  // -----------------------------------------------------------------------

  describe("online transition triggers blessing", () => {
    it("triggers blessing when browser transitions from offline to online and server is reachable", async () => {
      // Set browser online status initial to false (offline)
      useOnlineStatusMock.mockReturnValue(false);

      const pending = makeOfflineSession({ localSessionId: "sess-pending" });
      zustandSessionsMock.push(pending);
      onlineSessionRef.current = makeOnlineSession({ accessToken: "test-token" });

      const { rerender } = renderHook(() => useOfflineAuth());

      // Now switch to online
      useOnlineStatusMock.mockReturnValue(true);

      // Mock that checkConnectionState internal will succeed
      httpClientMock.getWithAuth.mockResolvedValueOnce({ id: "user-1" });
      authServiceMock.blessPendingSessions.mockResolvedValueOnce([
        { localSessionId: "sess-pending", status: "BLESSED" },
      ]);

      // Trigger re-render to process the effect
      rerender();

      // Wait for the async effect to settle
      await waitFor(() => {
        expect(authServiceMock.blessPendingSessions).toHaveBeenCalled();
      });
    });

    it("does not trigger blessing when browser was already online", async () => {
      useOnlineStatusMock.mockReturnValue(true);

      const pending = makeOfflineSession({ localSessionId: "sess-pending" });
      zustandSessionsMock.push(pending);
      onlineSessionRef.current = makeOnlineSession({ accessToken: "test-token" });

      renderHook(() => useOfflineAuth());

      // No blessing should have occurred since there was no online transition
      expect(authServiceMock.blessPendingSessions).not.toHaveBeenCalled();
    });
  });
});
