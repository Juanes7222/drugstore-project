/**
 * Component tests for SessionView.
 *
 * Covers rendering of online and offline sessions, filtering, blessing
 * trigger, and empty state.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionView } from "./session-view";
import type { OfflineSession } from "../../../../domain/auth/offline/types";
import type { LocalSession } from "../../../../domain/auth/local-session.store";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSelectors, mockZustandSessions } = vi.hoisted(() => ({
  mockSelectors: {
    connectionState: "ONLINE" as "ONLINE" | "OFFLINE" | "RECONNECTING",
    isBlessingInProgress: false,
  },
  mockZustandSessions: [] as OfflineSession[],
}));

const { triggerBlessingMock, dispatchMock } = vi.hoisted(() => ({
  triggerBlessingMock: vi.fn(),
  dispatchMock: vi.fn(),
}));

const { mockSessionRef } = vi.hoisted(() => ({
  mockSessionRef: { current: null as LocalSession | null },
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/store/hooks", () => ({
  useAppSelector: (selector: (state: any) => unknown) => {
    const rootState = {
      offlineAuth: {
        connectionState: mockSelectors.connectionState,
        isBlessingInProgress: mockSelectors.isBlessingInProgress,
        lastRevocationListFetch: null,
        lastBlessingAttempt: null,
        blessingProgress: { total: 0, completed: 0, failed: 0 },
        error: null,
      },
    };
    return selector(rootState);
  },
  useAppDispatch: () => dispatchMock,
}));

vi.mock("@/store/slices/offline-auth-slice", () => ({
  selectConnectionState: (state: any) => state.offlineAuth.connectionState,
  selectIsBlessingInProgress: (state: any) => state.offlineAuth.isBlessingInProgress,
}));

vi.mock("@/store/slices/ui-slice", () => ({
  setActiveScreen: (screen: string) => ({
    type: "ui/setActiveScreen",
    payload: screen,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../hooks/use-offline-auth", () => ({
  useOfflineAuth: () => ({
    triggerBlessing: triggerBlessingMock,
  }),
}));

vi.mock("../../../../domain/auth", () => ({
  useLocalSessionStore: (selector: (s: any) => unknown) => {
    return selector({ session: mockSessionRef.current });
  },
}));

vi.mock("../../../../domain/auth/offline", () => ({
  useOfflineSessionStore: (selector: (s: any) => unknown) => {
    return selector({ sessions: mockZustandSessions });
  },
}));

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
  accessToken: "token-abc",
  refreshToken: "refresh-xyz",
  expiresAt: new Date("2099-12-31"),
  sessionId: "session-1",
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
  ...overrides,
});

const makeOfflineSession = (overrides: Partial<OfflineSession> = {}): OfflineSession => ({
  localSessionId: "off-sess-" + Math.random().toString(36).substring(2, 8),
  userId: "user-2",
  username: "cajero2",
  displayName: "Cajero Dos",
  role: "CASHIER",
  subscriptionId: "sub-1",
  offlineToken: "token",
  workstationFingerprint: "ws-1",
  createdAt: new Date("2026-07-15T10:00:00Z"),
  lastActiveAt: new Date("2026-07-15T10:00:00Z"),
  isBlessed: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SessionView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockZustandSessions.length = 0;
    mockSessionRef.current = null;
    mockSelectors.connectionState = "ONLINE";
    mockSelectors.isBlessingInProgress = false;
  });

  it("renders the title", () => {
    render(<SessionView />);
    expect(screen.getByText("session_view.title")).toBeVisible();
  });

  it("shows the online session when one exists", () => {
    mockSessionRef.current = makeOnlineSession({
      fullName: "Cajero Online",
      displayName: "Cajero Online",
      username: "online1",
      role: "MANAGER",
    });

    render(<SessionView />);

    expect(screen.getByText("Cajero Online")).toBeVisible();
  });

  it("shows offline sessions from the Zustand store", () => {
    mockZustandSessions.push(
      makeOfflineSession({
        localSessionId: "off-1",
        displayName: "Cajero Offline",
        username: "offline1",
        role: "CASHIER",
      }),
    );

    render(<SessionView />);

    expect(screen.getByText("Cajero Offline")).toBeVisible();
  });

  it("shows pending sessions with the pending filter label", () => {
    mockZustandSessions.push(
      makeOfflineSession({
        localSessionId: "off-pending",
        displayName: "Pendiente",
        isBlessed: false,
      }),
    );

    render(<SessionView />);

    expect(screen.getByText("session_view.status_offline_pending")).toBeVisible();
  });

  it("shows blessed sessions with the blessed filter label", () => {
    mockZustandSessions.push(
      makeOfflineSession({
        localSessionId: "off-blessed",
        displayName: "Validada",
        isBlessed: true,
      }),
    );

    render(<SessionView />);

    expect(screen.getByText("session_view.status_offline_blessed")).toBeVisible();
  });

  it("shows rejected sessions with the rejected filter label", () => {
    mockZustandSessions.push(
      makeOfflineSession({
        localSessionId: "off-rejected",
        displayName: "Rechazada",
        isBlessed: false,
        rejectedAt: new Date(),
        rejectionReason: "USER_DISABLED",
      }),
    );

    render(<SessionView />);

    expect(screen.getByText("session_view.status_offline_rejected")).toBeVisible();
  });

  it("shows the revalidate button when there are pending sessions", () => {
    mockZustandSessions.push(
      makeOfflineSession({
        localSessionId: "off-pending",
        isBlessed: false,
      }),
    );

    render(<SessionView />);

    expect(
      screen.getByRole("button", { name: "session_view.revalidate" }),
    ).toBeVisible();
  });

  it("calls triggerBlessing when revalidate is clicked", async () => {
    const user = userEvent.setup();
    mockZustandSessions.push(
      makeOfflineSession({
        localSessionId: "off-pending",
        isBlessed: false,
      }),
    );

    render(<SessionView />);

    await user.click(screen.getByRole("button", { name: "session_view.revalidate" }));

    expect(triggerBlessingMock).toHaveBeenCalledTimes(1);
  });

  it("disables the revalidate button when blessing is in progress", () => {
    mockSelectors.isBlessingInProgress = true;
    mockZustandSessions.push(
      makeOfflineSession({
        localSessionId: "off-pending",
        isBlessed: false,
      }),
    );

    render(<SessionView />);

    expect(
      screen.getByRole("button", { name: "session_view.revalidating" }),
    ).toBeDisabled();
  });

  it("shows the offline-only warning when there are offline sessions", () => {
    mockZustandSessions.push(
      makeOfflineSession({
        localSessionId: "off-1",
        displayName: "Offline User",
        isBlessed: false,
      }),
    );

    render(<SessionView />);

    expect(screen.getByText("session_view.offline_only_warning")).toBeVisible();
  });

  it("shows the empty state when there are no sessions", () => {
    render(<SessionView />);

    expect(screen.getByText("session_view.no_sessions")).toBeVisible();
  });

  it("shows the connection status text", () => {
    mockSelectors.connectionState = "OFFLINE";
    render(<SessionView />);

    expect(screen.getByText("session_view.status_offline")).toBeVisible();
  });

  it("shows RECONNECTING status", () => {
    mockSelectors.connectionState = "RECONNECTING";
    render(<SessionView />);

    expect(screen.getByText("session_view.status_reconnecting")).toBeVisible();
  });

  it("shows ONLINE status", () => {
    mockSelectors.connectionState = "ONLINE";
    render(<SessionView />);

    expect(screen.getByText("session_view.status_online")).toBeVisible();
  });

  it("dispatches setActiveScreen when back button is clicked", async () => {
    const user = userEvent.setup();
    render(<SessionView />);

    await user.click(screen.getByRole("button", { name: "common.back" }));

    expect(dispatchMock).toHaveBeenCalledWith({
      type: "ui/setActiveScreen",
      payload: "admin-menu",
    });
  });

  it("filters sessions by offline-only checkbox", async () => {
    const user = userEvent.setup();
    mockSessionRef.current = makeOnlineSession({ fullName: "Online User" });
    mockZustandSessions.push(
      makeOfflineSession({ localSessionId: "off-1", displayName: "Offline User" }),
    );

    render(<SessionView />);

    // Both sessions visible initially
    expect(screen.getByText("Online User")).toBeVisible();
    expect(screen.getByText("Offline User")).toBeVisible();

    // Check "Solo offline" checkbox
    await user.click(screen.getByRole("checkbox"));

    // Only offline session visible
    expect(screen.queryByText("Online User")).toBeNull();
    expect(screen.getByText("Offline User")).toBeVisible();
  });

  it("renders filter buttons", () => {
    render(<SessionView />);

    expect(screen.getByText("session_view.filter_all")).toBeVisible();
    expect(screen.getByText("session_view.filter_online")).toBeVisible();
    expect(screen.getByText("session_view.filter_pending")).toBeVisible();
    expect(screen.getByText("session_view.filter_blessed")).toBeVisible();
    expect(screen.getByText("session_view.filter_rejected")).toBeVisible();
  });
});
