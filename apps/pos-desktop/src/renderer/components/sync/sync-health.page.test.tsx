/**
 * Component tests for SyncHealthPage.
 *
 * Covers: loading state, error state, KPI rendering, connection test,
 * and action button presence.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { uiSlice } from "@/store/slices/ui-slice";
import { SyncHealthPage } from "./sync-health.page";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import type { LocalSession } from "../../../domain/auth/local-session.store";

// ---------------------------------------------------------------------------
// Mock data factories
// ---------------------------------------------------------------------------

const defaultQueueCounts = {
  pending: 0,
  stalePending: 0,
  failed: 0,
  permanentFailure: 0,
  completed24h: 0,
  completedTotal: 0,
};

const defaultFailureBreakdown: Array<{
  category: string;
  count: number;
  mostRecent: string;
}> = [];

const defaultTimeline: Array<{
  bucket: string;
  completed: number;
  failed: number;
}> = [];

const defaultPermanentFailures = {
  data: [] as Array<Record<string, unknown>>,
  total: 0,
  hasMore: false,
  cursor: null as string | null,
};

const defaultStalePending = { data: [], total: 0, hasMore: false, cursor: null as string | null };

const mockMetricsService = {
  getQueueCounts: vi.fn().mockResolvedValue(defaultQueueCounts),
  getFailureBreakdown: vi.fn().mockResolvedValue(defaultFailureBreakdown),
  getSyncHealthTimeline: vi.fn().mockResolvedValue(defaultTimeline),
  getPermanentFailureEntries: vi.fn().mockResolvedValue(defaultPermanentFailures),
  getStalePendingEntries: vi.fn().mockResolvedValue(defaultStalePending),
  getBackupSummary: vi.fn().mockResolvedValue({ lastBackupAt: null }),
  getBackupHealth: vi.fn().mockResolvedValue("HEALTHY"),
  exportEntriesAsCsv: vi.fn().mockResolvedValue("col1,col2\nval1,val2"),
  exportEntriesAsJson: vi.fn().mockResolvedValue("[]"),
};

const mockRecoveryService = {
  retryEntry: vi.fn(),
  discardEntry: vi.fn(),
};

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock("../../../infrastructure/local-database", () => ({
  getLocalDatabase: vi.fn().mockResolvedValue({ prisma: {} }),
}));

vi.mock("../../../domain/sync/sync-metrics.service", () => ({
  createSyncMetricsService: vi.fn(() => mockMetricsService),
}));

vi.mock("../../../domain/sync/sync-recovery.service", () => ({
  createSyncRecoveryService: vi.fn(() => mockRecoveryService),
  EntryNotInPermanentFailureException: class extends Error {
    constructor(m: string) { super(m); this.name = "EntryNotInPermanentFailureException"; }
  },
  EntryStateChangedException: class extends Error {
    constructor(m: string) { super(m); this.name = "EntryStateChangedException"; }
  },
  EntryNotReplayableException: class extends Error {
    constructor(m: string) { super(m); this.name = "EntryNotReplayableException"; }
  },
}));

vi.mock("../../../common/download", () => ({
  downloadBlob: vi.fn(),
}));

vi.mock("../../../infrastructure/config", () => ({
  API_BASE_URL: "http://localhost:3000/api/v1",
}));

vi.mock("../../../domain/sync/sync-scheduler.service", () => ({
  createSyncScheduler: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createTestStore = () =>
  configureStore({
    reducer: { ui: uiSlice.reducer },
    preloadedState: {
      ui: uiSlice.reducer(
        uiSlice.getInitialState(),
        { type: "unknown" },
      ),
    },
  });

const renderPage = (store = createTestStore()) =>
  render(
    <Provider store={store}>
      <SyncHealthPage />
    </Provider>,
  );

const baseSession: LocalSession = {
  userId: "user-1",
  username: "admin",
  fullName: "Admin User",
  displayName: "Admin",
  email: "admin@test.com",
  role: "ADMIN",
  subscriptionId: "sub-1",
  workstationId: "ws-1",
  accessToken: "fake-token",
  refreshToken: "fake-refresh",
  expiresAt: new Date("2099-01-01"),
  sessionId: "session-1",
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
};

const setSession = (session: LocalSession | null): void => {
  if (session) {
    useLocalSessionStore.getState().setSession(session);
  } else {
    useLocalSessionStore.getState().clearSession();
  }
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SyncHealthPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession(baseSession);

    // Reset mock implementations to defaults
    mockMetricsService.getQueueCounts.mockResolvedValue(defaultQueueCounts);
    mockMetricsService.getFailureBreakdown.mockResolvedValue(defaultFailureBreakdown);
    mockMetricsService.getSyncHealthTimeline.mockResolvedValue(defaultTimeline);
    mockMetricsService.getPermanentFailureEntries.mockResolvedValue(defaultPermanentFailures);
    mockMetricsService.getStalePendingEntries.mockResolvedValue(defaultStalePending);
    mockMetricsService.getBackupSummary.mockResolvedValue({ lastBackupAt: null });
    mockMetricsService.getBackupHealth.mockResolvedValue("HEALTHY");
  });

  describe("loading state", () => {
    it("shows a loading indicator while data is being fetched", () => {
      // Keep the promise pending
      mockMetricsService.getQueueCounts.mockReturnValue(new Promise(() => {}));
      renderPage();

      expect(
        screen.getByText(/loading sync health/i),
      ).toBeInTheDocument();
    });
  });

  describe("SYNH-00: error state", () => {
    it("shows an error panel when data loading fails", async () => {
      mockMetricsService.getQueueCounts.mockRejectedValue(
        new Error("Failed to connect to database"),
      );

      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText(/Failed to connect to database/i),
        ).toBeInTheDocument();
      });
    });

    it("shows a retry button when in error state", async () => {
      mockMetricsService.getQueueCounts.mockRejectedValue(
        new Error("Connection error"),
      );

      renderPage();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /retry/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("SYNH-01: KPI tiles", () => {
    it("renders KPI tiles after data loads", async () => {
      mockMetricsService.getQueueCounts.mockResolvedValue({
        ...defaultQueueCounts,
        pending: 5,
        failed: 2,
        permanentFailure: 1,
        completed24h: 50,
        completedTotal: 500,
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/sync health/i)).toBeInTheDocument();
      });

      // KPI tiles should be visible
      await waitFor(() => {
        expect(screen.getByText("5")).toBeInTheDocument();
      });
    });

    it("shows permanent failure count from the metrics", async () => {
      mockMetricsService.getQueueCounts.mockResolvedValue({
        ...defaultQueueCounts,
        permanentFailure: 3,
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("3")).toBeInTheDocument();
      });
    });
  });

  describe("SYNH-08: Run Sync Now button", () => {
    it("renders the 'Run sync now' button", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /run sync now/i }),
        ).toBeInTheDocument();
      });
    });

    it("calls syncNow when the sync button is clicked", async () => {
      const mockSyncNow = vi.fn().mockResolvedValue(undefined);
      const { createSyncScheduler } = await import(
        "../../../domain/sync/sync-scheduler.service"
      );
      vi.mocked(createSyncScheduler).mockReturnValue({
        syncNow: mockSyncNow,
      } as unknown as ReturnType<typeof createSyncScheduler>);

      renderPage();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /run sync now/i }),
        ).toBeInTheDocument();
      });

      const syncButton = screen.getByRole("button", { name: /run sync now/i });
      fireEvent.click(syncButton);

      await waitFor(() => {
        expect(mockSyncNow).toHaveBeenCalled();
      });
    });
  });

  describe("SYNH-09: connection test button", () => {
    beforeEach(() => {
      // Mock fetch for the connection test
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);
    });

    it("renders a Test connection button", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /test connection/i }),
        ).toBeInTheDocument();
      });
    });

    it("checks connectivity when the test button is clicked", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /test connection/i }),
        ).toBeInTheDocument();
      });

      const testButton = screen.getByRole("button", { name: /test connection/i });
      fireEvent.click(testButton);

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/sync/status"),
          expect.objectContaining({ method: "GET" }),
        );
      });
    });
  });

  describe("export buttons", () => {
    it("renders CSV and JSON export buttons", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /export csv/i }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: /export json/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("SYNH-10: filter and toggle controls", () => {
    it("renders the 'Show discarded' toggle", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByLabelText(/show discarded/i),
        ).toBeInTheDocument();
      });
    });

    it("renders the 'Retry without server check' toggle", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByLabelText(/retry without server check/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("no sync data state", () => {
    it("shows the no-data placeholder when there is no sync history", async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText(/no sync data/i),
        ).toBeInTheDocument();
      });
    });
  });
});
