/**
 * Component tests for AboutPage.
 *
 * Covers: app version display, build date, update checker button.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AboutPage } from "./about.page";
import "@/i18n";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories are hoisted above imports, so any
// variables they reference must be defined via vi.hoisted().
// ---------------------------------------------------------------------------

const { createStoreState, mockStoreStateRef, mockUseUpdateStore } =
  vi.hoisted(() => {
    const updateAndPersistFn = vi.fn();
    const dismissVersionFn = vi.fn();

    const createState = () => ({
      currentVersion: "1.5.0",
      lastAvailableVersion: null as string | null,
      lastAvailableChangelog: null as string | null,
      channel: "STABLE",
      userDismissedVersion: null as string | null,
      setStateMachineState: vi.fn(),
      updateAndPersist: updateAndPersistFn,
      dismissVersion: dismissVersionFn,
      persistToDb: vi.fn(),
    });

    const state = createState();

    const mockStore = Object.assign(
      (selector?: (s: Record<string, unknown>) => unknown) => {
        if (selector) return selector(state as unknown as Record<string, unknown>);
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
      createStoreState: createState,
      mockStoreStateRef: state,
      mockUseUpdateStore: mockStore,
    };
  });

vi.mock("../../../domain/updates/update.store", () => ({
  useUpdateStore: mockUseUpdateStore,
}));

vi.mock("../../components/common/service-context", () => ({
  useUpdateService: vi.fn().mockReturnValue({
    checkForUpdate: vi.fn().mockResolvedValue({
      updateAvailable: false,
      version: null,
      updateType: null,
      releaseNotes: null,
      mandatoryFrom: null,
    }),
  }),
}));

vi.mock("../../../infrastructure/local-database", () => ({
  getLocalDatabase: vi.fn().mockResolvedValue({
    prisma: {
      updateAttempt: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AboutPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state values for each test (preserving function refs)
    mockStoreStateRef.currentVersion = "1.5.0";
    mockStoreStateRef.lastAvailableVersion = null;
    mockStoreStateRef.lastAvailableChangelog = null;
    mockStoreStateRef.channel = "STABLE";
    mockStoreStateRef.userDismissedVersion = null;
  });

  it("shows the current app version", () => {
    render(<AboutPage />);

    expect(screen.getByText("1.5.0")).toBeInTheDocument();
  });

  it("shows a check for updates button", () => {
    render(<AboutPage />);

    expect(
      screen.getByRole("button", { name: /check_for_updates/i }),
    ).toBeInTheDocument();
  });

  it("shows the channel name", () => {
    render(<AboutPage />);

    expect(screen.getByText("STABLE")).toBeInTheDocument();
  });

  it("shows latest available version when present", () => {
    mockStoreStateRef.lastAvailableVersion = "2.0.0";
    mockStoreStateRef.lastAvailableChangelog = "Corrección de errores";

    render(<AboutPage />);

    expect(screen.getByText("2.0.0")).toBeInTheDocument();
  });

  it("shows 'up-to-date' message when check resolves with no update", async () => {
    render(<AboutPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /check_for_updates/i }),
    );

    // Result shows the key since no translation exists
    expect(await screen.findByText(/up_to_date/i)).toBeInTheDocument();
  });
});
