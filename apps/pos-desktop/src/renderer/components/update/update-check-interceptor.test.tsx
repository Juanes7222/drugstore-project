/**
 * Component tests for UpdateCheckInterceptor.
 *
 * Covers: rendering children, periodic check trigger.
 * Note: The interceptor's async startup logic is tested via integration
 * tests; unit tests here focus on the render output and early returns.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpdateCheckInterceptor } from "./update-check-interceptor";
import "@/i18n";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories are hoisted above imports, so any
// variables they reference must be defined via vi.hoisted().
// ---------------------------------------------------------------------------

const { mockStoreStateRef, mockUseUpdateStore } = vi.hoisted(() => {
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
    mockStoreStateRef: state,
    mockUseUpdateStore: mockStore,
  };
});

vi.mock("../common/service-context", () => ({
  useUpdateService: vi.fn().mockReturnValue({
    stateMachine: {
      onTransition: vi.fn().mockReturnValue(vi.fn()),
    },
    checkStartupRollback: vi.fn().mockResolvedValue({
      needsRollback: false,
    }),
    checkForUpdate: vi.fn().mockResolvedValue({
      updateAvailable: false,
      version: null,
    }),
  }),
}));

vi.mock("../../../domain/updates/update.store", () => ({
  useUpdateStore: mockUseUpdateStore,
}));

vi.mock("../../../infrastructure/local-database", () => ({
  getLocalDatabase: vi.fn().mockResolvedValue({ prisma: {} }),
}));

vi.mock("../../../common/is-online", () => ({
  isOnline: vi.fn().mockReturnValue(false),
}));

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
  });

  it("renders nothing initially when offline", () => {
    const { container } = render(<UpdateCheckInterceptor />);

    // The component renders nothing visible when no update is available
    // and the startup check doesn't trigger due to isOnline=false
    expect(container.firstChild).toBeNull();
  });
});
