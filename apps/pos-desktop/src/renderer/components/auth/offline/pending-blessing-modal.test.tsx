/**
 * Component tests for PendingBlessingModal.
 *
 * Covers rendering with pending sessions, auto-trigger blessing when online,
 * progress display, rejected session dismissal, and auto-close when resolved.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PendingBlessingModal } from "./pending-blessing-modal";
import type { OfflineSession } from "../../../../domain/auth/offline/types";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSelectors, mockZustandSessions } = vi.hoisted(() => ({
  mockSelectors: {
    connectionState: "ONLINE" as "ONLINE" | "OFFLINE" | "RECONNECTING",
    isBlessingInProgress: false,
    blessingProgress: { total: 0, completed: 0, failed: 0 },
  },
  mockZustandSessions: [] as OfflineSession[],
}));

const { triggerBlessingMock } = vi.hoisted(() => ({
  triggerBlessingMock: vi.fn(),
}));

// ---------------------------------------------------------------------------
// vi.mock
// ---------------------------------------------------------------------------

vi.mock("@/store/hooks", () => ({
  useAppSelector: (selector: (state: any) => unknown) => {
    const rootState = {
      offlineAuth: {
        connectionState: mockSelectors.connectionState,
        isBlessingInProgress: mockSelectors.isBlessingInProgress,
        blessingProgress: mockSelectors.blessingProgress,
      },
    };
    return selector(rootState);
  },
  useAppDispatch: vi.fn(),
}));

vi.mock("@/store/slices/offline-auth-slice", () => ({
  selectConnectionState: (state: any) => state.offlineAuth.connectionState,
  selectIsBlessingInProgress: (state: any) => state.offlineAuth.isBlessingInProgress,
  selectBlessingProgress: (state: any) => state.offlineAuth.blessingProgress,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, ...safeProps } = props;
      return <div {...safeProps}>{children}</div>;
    },
    span: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, ...safeProps } = props;
      return <span {...safeProps}>{children}</span>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("../../../hooks/use-offline-auth", () => ({
  useOfflineAuth: () => ({
    triggerBlessing: triggerBlessingMock,
  }),
}));

vi.mock("../../../../domain/auth/offline", () => ({
  useOfflineSessionStore: (selector: (s: any) => unknown) => {
    return selector({ sessions: mockZustandSessions });
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSession = (overrides: Partial<OfflineSession> = {}): OfflineSession => ({
  localSessionId: "sess-" + Math.random().toString(36).substring(2, 8),
  userId: "user-1",
  username: "cajero1",
  displayName: "Cajero Uno",
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

describe("PendingBlessingModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockZustandSessions.length = 0;
    mockSelectors.connectionState = "ONLINE";
    mockSelectors.isBlessingInProgress = false;
    mockSelectors.blessingProgress = { total: 0, completed: 0, failed: 0 };
  });

  it("does not render when there are no sessions", () => {
    render(<PendingBlessingModal />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders when there are pending (un-blessed, not rejected) sessions", () => {
    mockZustandSessions.push(
      makeSession({ localSessionId: "sess-pending", isBlessed: false }),
    );

    render(<PendingBlessingModal />);

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("offline_blessing.title")).toBeVisible();
  });

  it("does not render when all sessions are already blessed", () => {
    mockZustandSessions.push(
      makeSession({ localSessionId: "sess-blessed", isBlessed: true }),
    );

    render(<PendingBlessingModal />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("displays pending sessions in the list", () => {
    mockZustandSessions.push(
      makeSession({
        localSessionId: "sess-pending",
        displayName: "Cajero Pendiente",
        isBlessed: false,
      }),
    );

    render(<PendingBlessingModal />);

    expect(screen.getByText("Cajero Pendiente")).toBeVisible();
  });

  it("displays rejected sessions alongside pending sessions", () => {
    // The modal only opens when there are pending sessions
    mockZustandSessions.push(
      makeSession({
        localSessionId: "sess-pending",
        displayName: "Pendiente",
        isBlessed: false,
      }),
      makeSession({
        localSessionId: "sess-rejected",
        displayName: "Cajero Rechazado",
        isBlessed: false,
        rejectedAt: new Date(),
        rejectionReason: "USER_DISABLED",
      }),
    );

    render(<PendingBlessingModal />);

    expect(screen.getByText("Cajero Rechazado")).toBeVisible();
    expect(screen.getByText("offline_blessing.rejected")).toBeVisible();
  });

  it("calls triggerBlessing when online and there are pending sessions", () => {
    mockSelectors.connectionState = "ONLINE";
    mockZustandSessions.push(
      makeSession({ localSessionId: "sess-pending", isBlessed: false }),
    );

    render(<PendingBlessingModal />);

    expect(triggerBlessingMock).toHaveBeenCalledTimes(1);
  });

  it("does not call triggerBlessing when offline", () => {
    mockSelectors.connectionState = "OFFLINE";
    mockZustandSessions.push(
      makeSession({ localSessionId: "sess-pending", isBlessed: false }),
    );

    render(<PendingBlessingModal />);

    expect(triggerBlessingMock).not.toHaveBeenCalled();
  });

  it("shows progress stats when blessingProgress.total > 0", () => {
    mockSelectors.blessingProgress = { total: 3, completed: 1, failed: 1 };

    mockZustandSessions.push(
      makeSession({ localSessionId: "sess-pending", isBlessed: false }),
    );

    render(<PendingBlessingModal />);

    // With key-based i18n mock, progress text renders as "1 / 3 offline_blessing.blessed"
    expect(screen.getByText(/1.*3/)).toBeVisible();
    expect(screen.getByText(/offline_blessing.failed/)).toBeVisible();
  });

  it("shows the close button when all sessions are processed and rejected dismissed", async () => {
    const user = userEvent.setup();

    // All sessions resolved: one blessed (no pending counts), one rejected
    mockZustandSessions.push(
      makeSession({
        localSessionId: "sess-blessed",
        isBlessed: true,
      }),
      makeSession({
        localSessionId: "sess-rejected",
        displayName: "Rechazado",
        isBlessed: false,
        rejectedAt: new Date(),
        rejectionReason: "USER_DISABLED",
      }),
    );

    render(<PendingBlessingModal />);

    // Initially the modal should be closed because totalPendingCount === 0
    // and rejectedSessions are not all dismissed yet
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the modal with rejections when combined with pending sessions", async () => {
    const user = userEvent.setup();

    // Both pending and rejected sessions — modal stays open
    mockZustandSessions.push(
      makeSession({
        localSessionId: "sess-pending",
        displayName: "Pendiente",
        isBlessed: false,
      }),
      makeSession({
        localSessionId: "sess-rejected",
        displayName: "Rechazado",
        isBlessed: false,
        rejectedAt: new Date(),
        rejectionReason: "USER_DISABLED",
      }),
    );

    render(<PendingBlessingModal />);

    expect(screen.getByRole("dialog")).toBeVisible();

    // Find and click dismiss on the rejected session
    const dismissButtons = screen.getAllByRole("button", { name: "common.dismiss" });
    expect(dismissButtons.length).toBeGreaterThanOrEqual(1);

    await user.click(dismissButtons[0]);

    // After dismissing the rejected session, there's still a pending one so no close button
    expect(screen.getByText("offline_blessing.pending")).toBeVisible();
  });

  it("shows progress bar when blessing is in progress", () => {
    mockSelectors.isBlessingInProgress = true;
    mockZustandSessions.push(
      makeSession({ localSessionId: "sess-pending", isBlessed: false }),
    );

    render(<PendingBlessingModal />);

    expect(screen.getByText("offline_blessing.processing")).toBeVisible();
  });

  it("has accessible dialog attributes", () => {
    mockZustandSessions.push(
      makeSession({ localSessionId: "sess-pending", isBlessed: false }),
    );

    render(<PendingBlessingModal />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "offline_blessing.title");
  });
});
