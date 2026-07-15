/**
 * Component tests for UpdateCheckInterceptor.
 *
 * Covers: rendering children, notify/toast behavior for HOTFIX/OPTIONAL
 * updates, modal for CRITICAL/MANDATORY updates, dismissed version guard.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { UpdateCheckInterceptor } from "./update-check-interceptor";
import { UpdateType } from "@pharmacy/shared-types";
import "@/i18n";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories are hoisted above imports, so any
// variables they reference must be defined via vi.hoisted().
// ---------------------------------------------------------------------------

const {
  mockIsOnline,
  mockCheckForUpdate,
  mockStoreStateRef,
  mockUseUpdateStore,
  mockNotify,
} = vi.hoisted(() => {
  const updateAndPersistFn = vi.fn();
  const dismissVersionFn = vi.fn();

  const state: Record<string, unknown> = {
    currentVersion: "1.5.0",
    lastAvailableVersion: null,
    userDismissedVersion: null,
    lastAvailableType: null,
    lastAvailableChangelog: null,
    lastCheckAt: null,
    setStateMachineState: vi.fn(),
    updateAndPersist: updateAndPersistFn,
    dismissVersion: dismissVersionFn,
    persistToDb: vi.fn(),
  };

  const mockStore = Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      if (selector) return selector(state);
      return state;
    },
    {
      getState: () => state,
      setState: vi.fn(),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    },
  );

  return {
    mockIsOnline: vi.fn().mockReturnValue(false),
    mockCheckForUpdate: vi.fn().mockResolvedValue({
      updateAvailable: false,
      version: null,
    }),
    mockStoreStateRef: state,
    mockUseUpdateStore: mockStore,
    mockNotify: {
      action: vi.fn(),
      show: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
    },
  };
});

// ---------------------------------------------------------------------------
// Module mocks — references to hoisted variables so individual tests can
// control return values via mockIsOnline.mockReturnValue(...) etc.
// ---------------------------------------------------------------------------

vi.mock("../../../common/is-online", () => ({
  isOnline: mockIsOnline,
}));

vi.mock("../common/service-context", () => ({
  useUpdateService: vi.fn().mockReturnValue({
    stateMachine: {
      onTransition: vi.fn().mockReturnValue(vi.fn()),
    },
    checkStartupRollback: vi.fn().mockResolvedValue({
      needsRollback: false,
    }),
    checkForUpdate: mockCheckForUpdate,
  }),
}));

vi.mock("../../../domain/updates/update.store", () => ({
  useUpdateStore: mockUseUpdateStore,
}));

vi.mock("../../../infrastructure/local-database", () => ({
  getLocalDatabase: vi.fn().mockResolvedValue({ prisma: {} }),
}));

vi.mock("@/utils/notify", () => ({
  notify: mockNotify,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Advance fake timers past the component's 3-second startup sleep and drain
 * all microtasks so the async startup effect runs to completion.
 */
async function settleStartupEffect(): Promise<void> {
  // Let the async IIFE get past the initial checkStartupRollback() await
  // and reach the await new Promise(resolve => setTimeout(resolve, 3000)).
  await Promise.resolve();
  // Fire the 3-second timer
  vi.advanceTimersByTime(3001);
  // Drain all subsequent microtasks (checkForUpdate, getLocalDatabase,
  // updateAndPersist, then the notify call itself).
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("UpdateCheckInterceptor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreStateRef.currentVersion = "1.5.0";
    mockStoreStateRef.lastAvailableVersion = null;
    mockStoreStateRef.userDismissedVersion = null;
    mockStoreStateRef.lastAvailableType = null;
    mockStoreStateRef.lastAvailableChangelog = null;
    mockStoreStateRef.lastCheckAt = null;
    mockIsOnline.mockReturnValue(false);
    mockCheckForUpdate.mockResolvedValue({
      updateAvailable: false,
      version: null,
    });
  });

  it("renders nothing initially when offline", () => {
    const { container } = render(<UpdateCheckInterceptor />);

    // The component renders an empty fragment when no update is available
    // and the startup effect bails out early because isOnline() returns false
    // (the 3-second sleep in the effect hasn't elapsed yet, but even if it
    // did, the effect would return early without updating state).
    expect(container.firstChild).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Notify behavior (online, with fake timers)
  // -------------------------------------------------------------------------

  describe("when online with an available update", () => {
    beforeEach(() => {
      mockIsOnline.mockReturnValue(true);
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("calls notify.action() for a HOTFIX update", async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: true,
        version: "1.5.1",
        updateType: UpdateType.HOTFIX,
        releaseNotes: "Critical bugfix",
      });

      render(<UpdateCheckInterceptor />);
      await settleStartupEffect();

      expect(mockNotify.action).toHaveBeenCalledTimes(1);
      expect(mockNotify.action).toHaveBeenCalledWith(
        expect.objectContaining({ duration: null }),
      );
      expect(mockNotify.show).not.toHaveBeenCalled();
    });

    it("calls notify.show() for an OPTIONAL update", async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: true,
        version: "1.6.0",
        updateType: UpdateType.OPTIONAL,
        releaseNotes: "New features",
      });

      render(<UpdateCheckInterceptor />);
      await settleStartupEffect();

      expect(mockNotify.show).toHaveBeenCalledTimes(1);
      expect(mockNotify.show).toHaveBeenCalledWith(
        expect.objectContaining({ type: "info", duration: 8000 }),
      );
      expect(mockNotify.action).not.toHaveBeenCalled();
    });

    it("shows a modal for CRITICAL updates instead of calling notify", async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: true,
        version: "2.0.0",
        updateType: UpdateType.CRITICAL,
        releaseNotes: "Major security patch",
      });

      render(<UpdateCheckInterceptor />);
      await settleStartupEffect();

      // CRITICAL/MANDATORY updates render an UpdateModal — notify is not used
      expect(mockNotify.action).not.toHaveBeenCalled();
      expect(mockNotify.show).not.toHaveBeenCalled();
      // updateAndPersist should still have been called to persist the version
      expect(mockStoreStateRef.updateAndPersist).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          lastAvailableVersion: "2.0.0",
          lastAvailableType: UpdateType.CRITICAL,
        }),
      );
    });

    it("does not notify when the available version was already dismissed", async () => {
      mockStoreStateRef.userDismissedVersion = "1.5.1";
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: true,
        version: "1.5.1",
        updateType: UpdateType.HOTFIX,
        releaseNotes: "Critical bugfix",
      });

      render(<UpdateCheckInterceptor />);
      await settleStartupEffect();

      expect(mockNotify.action).not.toHaveBeenCalled();
      expect(mockNotify.show).not.toHaveBeenCalled();
    });

    it("does not notify when no update is available", async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: false,
        version: null,
      });

      render(<UpdateCheckInterceptor />);
      await settleStartupEffect();

      expect(mockNotify.action).not.toHaveBeenCalled();
      expect(mockNotify.show).not.toHaveBeenCalled();
    });
  });
});
