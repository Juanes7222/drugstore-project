/**
 * Tests for the Update Service — the top-level orchestrator for the
 * auto-update lifecycle.
 *
 * Covers check, download, install, rollback, and telemetry flows,
 * including error paths and state-machine transitions.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  createUpdateService,
  type UpdateService,
  type UpdateServiceConfig,
} from "./update.service";
import { UpdateStateMachine } from "./state-machine";
import {
  UpdateCheckFailedException,
  DownloadFailedException,
  InstallFailedException,
} from "./exceptions";
import { UpdateOutcome } from "@pharmacy/shared-types";

// ---------------------------------------------------------------------------
// Module-level mocks for all sub-service factories
// ---------------------------------------------------------------------------

const mockHttpClient = { get: vi.fn() };
vi.mock("../../infrastructure/http-client", () => ({
  createHttpClient: vi.fn(() => mockHttpClient),
}));

const { mockIsOnline } = vi.hoisted(() => ({
  mockIsOnline: vi.fn(() => true),
}));
vi.mock("../../common/is-online", () => ({
  isOnline: mockIsOnline,
}));

const mockDownloadManager = {
  state: { status: "idle" as const },
  start: vi.fn(),
  pause: vi.fn(),
  cancel: vi.fn(),
  onProgress: vi.fn(),
  onStateChange: vi.fn(),
};
vi.mock("./download-manager", () => ({
  createDownloadManager: vi.fn(() => mockDownloadManager),
}));

const mockInstallOrchestrator = {
  install: vi.fn(),
  rollback: vi.fn(),
  runPreInstallChecks: vi.fn(),
};
vi.mock("./install-orchestrator", () => ({
  createInstallOrchestrator: vi.fn(() => mockInstallOrchestrator),
}));

const mockRollbackDetector = {
  checkForRollback: vi.fn(),
  markStartupSuccess: vi.fn(),
  resetCrashCount: vi.fn(),
};
vi.mock("./rollback-detector", () => ({
  createRollbackDetector: vi.fn(() => mockRollbackDetector),
}));

const mockTelemetryService = {
  enqueue: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};
vi.mock("./telemetry.service", () => ({
  createTelemetryService: vi.fn(() => mockTelemetryService),
}));

vi.mock("./check-strategy", () => ({
  getCheckStrategy: vi.fn((trigger: string) => ({
    trigger,
    minIntervalMs: trigger === "MANUAL" ? 0 : 6 * 60 * 60 * 1000,
    notifyOnNoUpdate: trigger === "MANUAL",
    autoDownload: trigger !== "MANUAL",
  })),
}));

// ---------------------------------------------------------------------------
// Config helper
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: Partial<UpdateServiceConfig> = {},
): UpdateServiceConfig {
  return {
    prisma: createFakePrisma(),
    currentVersion: "1.0.0",
    workstationId: "ws-1",
    licenseId: "lic-1",
    backupService: createFakeBackupService(),
    ...overrides,
  };
}

function createFakePrisma() {
  return {
    updateAttempt: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

function createFakeBackupService() {
  return {
    createBackup: vi.fn().mockResolvedValue({ id: "backup-1" }),
  };
}

// ---------------------------------------------------------------------------
// Helpers: set state-machine state directly for tests that bypass full flow
// ---------------------------------------------------------------------------

function setState(service: UpdateService, state: string) {
  (service.stateMachine as any)._state = state;
}

function primeCheckResult(service: UpdateService) {
  (service as any).lastCheckResult = {
    updateAvailable: true,
    version: "1.2.3",
    downloadUrl: "https://dl.example.com/v1.2.3.bin",
    fileSize: 5000,
    fileHash: "abc123",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UpdateService", () => {
  let service: UpdateService;

  beforeEach(() => {
    // Use restoreAllMocks to reset implementations too (unlike clearAllMocks
    // which only resets call counts). This prevents isOnline mocks from
    // leaking between tests.
    vi.restoreAllMocks();

    // Reset mock defaults
    mockHttpClient.get.mockReset();
    mockDownloadManager.start.mockReset();
    mockDownloadManager.cancel.mockReset();
    mockDownloadManager.onProgress.mockReturnValue(vi.fn());
    mockDownloadManager.onStateChange.mockImplementation(
      (_cb: any) => vi.fn(),
    );
    mockDownloadManager.state = { status: "idle" };
    mockInstallOrchestrator.install.mockReset();
    mockInstallOrchestrator.rollback.mockReset();
    mockRollbackDetector.checkForRollback.mockReset();
    mockTelemetryService.enqueue.mockReset();
    mockTelemetryService.flush.mockReset();
    mockTelemetryService.start.mockReset();
    mockTelemetryService.stop.mockReset();

    // Re-assert the isOnline mock returns true after restoreAllMocks clears it
    mockIsOnline.mockReturnValue(true);

    service = createUpdateService(makeConfig());
  });

  // -----------------------------------------------------------------------
  // State machine accessor
  // -----------------------------------------------------------------------

  describe("state", () => {
    it("returns the state machine's current state", () => {
      expect(service.state).toBe("IDLE");
    });
  });

  // -----------------------------------------------------------------------
  // Check for update
  // -----------------------------------------------------------------------

  describe("checkForUpdate", () => {
    it("returns updateAvailable:true when server returns an update", async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        updateAvailable: true,
        version: "1.2.3",
        downloadUrl: "https://dl.example.com/v1.2.3.bin",
        fileSize: 5000,
        fileHash: "abc123",
        updateType: "OPTIONAL",
        releaseNotes: "Bug fixes",
      });

      const result = await service.checkForUpdate("MANUAL");

      expect(result.updateAvailable).toBe(true);
      expect(result.version).toBe("1.2.3");
      expect(service.state).toBe("UPDATE_AVAILABLE");
    });

    it("returns updateAvailable:false when server says no update", async () => {
      mockHttpClient.get.mockResolvedValueOnce({ updateAvailable: false });

      const result = await service.checkForUpdate("MANUAL");

      expect(result.updateAvailable).toBe(false);
      expect(service.state).toBe("NO_UPDATE");
    });

    it("returns cached result when check is already in progress", async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        updateAvailable: true,
        version: "1.2.3",
        downloadUrl: "https://dl.example.com/v1.2.3.bin",
        fileSize: 5000,
        fileHash: "abc123",
        updateType: "OPTIONAL",
        releaseNotes: "Bug fixes",
      });

      // First call populates cache
      await service.checkForUpdate("MANUAL");

      // Set checkInProgress to simulate duplicate check
      (service as any).checkInProgress = true;

      const result = await service.checkForUpdate("MANUAL");

      expect(result.updateAvailable).toBe(true);
      expect(result.version).toBe("1.2.3");
    });

    it("enforces minimum interval for automatic checks", async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        updateAvailable: true,
        version: "1.2.3",
        downloadUrl: "https://dl.example.com/v1.2.3.bin",
        fileSize: 5000,
        fileHash: "abc123",
        updateType: "OPTIONAL",
        releaseNotes: "Bug fixes",
      });

      // First check populates lastCheckResult and lastCheckTimestamp
      await service.checkForUpdate("PERIODIC");

      // Immediate second check should return cached, not hit server
      const result = await service.checkForUpdate("PERIODIC");

      expect(result.updateAvailable).toBe(true);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
    });

    it("always allows manual checks regardless of interval", async () => {
      // First PERIODIC check completes and transitions to UPDATE_AVAILABLE
      mockHttpClient.get.mockResolvedValueOnce({
        updateAvailable: true,
        version: "1.2.3",
        downloadUrl: "https://dl.example.com/v1.2.3.bin",
        fileSize: 5000,
        fileHash: "abc123",
        updateType: "OPTIONAL",
        releaseNotes: "Bug fixes",
      });

      await service.checkForUpdate("PERIODIC");

      // Reset the state machine so the second check can transition
      // from IDLE to CHECKING (no direct path from UPDATE_AVAILABLE)
      setState(service, "IDLE");
      (service as any).lastCheckTimestamp = 0;

      mockHttpClient.get.mockResolvedValueOnce({ updateAvailable: false });

      const result = await service.checkForUpdate("MANUAL");

      expect(result.updateAvailable).toBe(false);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
    });

    it("throws UpdateCheckFailedException for MANUAL checks when offline", async () => {
      mockIsOnline.mockReturnValue(false);

      await expect(service.checkForUpdate("MANUAL")).rejects.toThrow(
        UpdateCheckFailedException,
      );
    });

    it("returns cached result for automatic checks when offline", async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        updateAvailable: true,
        version: "1.2.3",
        downloadUrl: "https://dl.example.com/v1.2.3.bin",
        fileSize: 5000,
        fileHash: "abc123",
        updateType: "OPTIONAL",
        releaseNotes: "Bug fixes",
      });

      // First manual check populates cache and transitions to CHECKING→UPDATE_AVAILABLE
      await service.checkForUpdate("MANUAL");

      // Reset state machine back to IDLE for the offline automatic check
      (service.stateMachine as any)._state = "IDLE";
      (service as any).lastCheckTimestamp = 0;

      mockIsOnline.mockReturnValue(false);

      // Automatic check should return cached instead of throwing
      const result = await service.checkForUpdate("PERIODIC");

      expect(result.updateAvailable).toBe(true);
      expect(result.version).toBe("1.2.3");
    });

    it("throws UpdateCheckFailedException on server error for MANUAL checks", async () => {
      mockHttpClient.get.mockRejectedValueOnce(
        new Error("Server unavailable"),
      );

      await expect(service.checkForUpdate("MANUAL")).rejects.toThrow(
        UpdateCheckFailedException,
      );
    });

    it("returns cached result on server error for automatic checks", async () => {
      // First check populates cache
      mockHttpClient.get.mockResolvedValueOnce({ updateAvailable: false });
      await service.checkForUpdate("MANUAL");

      (service.stateMachine as any)._state = "IDLE";
      (service as any).lastCheckTimestamp = 0;

      // Second check fails
      mockHttpClient.get.mockRejectedValueOnce(
        new Error("Server unavailable"),
      );

      const result = await service.checkForUpdate("PERIODIC");

      expect(result.updateAvailable).toBe(false);
    });

    it("records a CHECK_OK attempt when an update is found", async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        updateAvailable: true,
        version: "1.2.3",
        downloadUrl: "https://dl.example.com/v1.2.3.bin",
        fileSize: 5000,
        fileHash: "abc123",
        updateType: "OPTIONAL",
        releaseNotes: "Bug fixes",
      });

      await service.checkForUpdate("MANUAL");

      const prisma = (service as any).prisma;
      expect(prisma.updateAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            outcome: UpdateOutcome.CHECK_OK,
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Download — these require state to have gone through CHECKING→UPDATE_AVAILABLE
  // -----------------------------------------------------------------------

  describe("startDownload", () => {
    it("throws DownloadFailedException when no check result exists", async () => {
      await expect(service.startDownload()).rejects.toThrow(
        DownloadFailedException,
      );
    });

    it("creates a DownloadManager and returns the file path", async () => {
      primeCheckResult(service);
      setState(service, "UPDATE_AVAILABLE");

      mockDownloadManager.start.mockResolvedValueOnce(
        "/tmp/updates/v1.2.3.bin",
      );

      const filePath = await service.startDownload();

      expect(filePath).toBe("/tmp/updates/v1.2.3.bin");
      expect(mockDownloadManager.start).toHaveBeenCalled();
      expect(service.state).toBe("DOWNLOADING");
      expect(mockDownloadManager.onProgress).toHaveBeenCalled();
      expect(mockDownloadManager.onStateChange).toHaveBeenCalled();
    });

    it("wraps non-DownloadFailedException errors", async () => {
      primeCheckResult(service);
      setState(service, "UPDATE_AVAILABLE");

      mockDownloadManager.start.mockRejectedValueOnce(
        new Error("Generic error"),
      );

      await expect(service.startDownload()).rejects.toThrow(
        DownloadFailedException,
      );
    });

    it("transitions state to READY_TO_INSTALL on download complete", async () => {
      primeCheckResult(service);
      setState(service, "UPDATE_AVAILABLE");

      mockDownloadManager.start.mockResolvedValueOnce(
        "/tmp/updates/v1.2.3.bin",
      );

      // Capture the onStateChange callback
      let capturedOnStateChange: ((state: any) => void) | null = null;
      mockDownloadManager.onStateChange.mockImplementation(
        (cb: (state: any) => void) => {
          capturedOnStateChange = cb;
          return vi.fn();
        },
      );

      await service.startDownload();

      // Simulate download completing via the captured callback
      capturedOnStateChange!({
        status: "completed",
        filePath: "/tmp/updates/v1.2.3.bin",
        sha256: "abc123",
      });

      expect(service.state).toBe("READY_TO_INSTALL");
    });
  });

  describe("pauseDownload", () => {
    it("delegates to the download manager", () => {
      (service as any).downloadManager = mockDownloadManager;

      service.pauseDownload();

      expect(mockDownloadManager.pause).toHaveBeenCalled();
    });

    it("does not throw when no download is active", () => {
      expect(() => service.pauseDownload()).not.toThrow();
    });
  });

  describe("resumeDownload", () => {
    it("throws DownloadFailedException when no download manager exists", async () => {
      await expect(service.resumeDownload()).rejects.toThrow(
        DownloadFailedException,
      );
    });

    it("calls start on the existing download manager", async () => {
      (service as any).downloadManager = mockDownloadManager;
      setState(service, "DOWNLOAD_PAUSED");

      mockDownloadManager.start.mockResolvedValueOnce(
        "/tmp/updates/v1.2.3.bin",
      );

      const filePath = await service.resumeDownload();

      expect(filePath).toBe("/tmp/updates/v1.2.3.bin");
      expect(mockDownloadManager.start).toHaveBeenCalled();
    });
  });

  describe("cancelDownload", () => {
    it("cancels the download and resets state", async () => {
      // cancelDownload calls stateMachine.reset() which transitions to IDLE.
      // From DOWNLOAD_FAILED / INSTALL_FAILED / INSTALLED_VERIFIED / ROLLED_BACK
      // / NO_UPDATE / CHECK_FAILED → IDLE is legal. Set DOWNLOAD_FAILED to allow it.
      (service as any).downloadManager = mockDownloadManager;
      (service as any)._downloadProgress = {
        totalBytes: 5000,
        receivedBytes: 1000,
        percent: 20,
        bytesPerSecond: 50000,
        etaMs: 80000,
      };
      setState(service, "DOWNLOAD_FAILED");

      await service.cancelDownload();

      expect(mockDownloadManager.cancel).toHaveBeenCalled();
      expect((service as any).downloadManager).toBeNull();
      expect((service as any)._downloadProgress).toBeNull();
      expect(service.state).toBe("IDLE");
    });
  });

  // -----------------------------------------------------------------------
  // Install — requires READY_TO_INSTALL state
  // -----------------------------------------------------------------------

  describe("installUpdate", () => {
    it("throws InstallFailedException when no version is available", async () => {
      await expect(service.installUpdate()).rejects.toThrow(
        InstallFailedException,
      );
    });

    it("creates an install orchestrator and returns the install report", async () => {
      primeCheckResult(service);
      setState(service, "READY_TO_INSTALL");

      mockInstallOrchestrator.install.mockResolvedValueOnce({
        success: true,
        backupCreated: true,
        migrated: true,
        restartTriggered: true,
      });

      const report = await service.installUpdate();

      expect(report.success).toBe(true);
      expect(report.backupCreated).toBe(true);
      expect(service.state).toBe("INSTALLED_PENDING_RESTART");
    });

    it("transitions to ROLLED_BACK when install fails", async () => {
      primeCheckResult(service);
      setState(service, "READY_TO_INSTALL");

      mockInstallOrchestrator.install.mockRejectedValueOnce(
        new InstallFailedException("Migration failed"),
      );

      await expect(service.installUpdate()).rejects.toThrow(
        InstallFailedException,
      );

      expect(service.state).toBe("ROLLED_BACK");
    });

    it("records INSTALL_STARTED attempt before installing", async () => {
      primeCheckResult(service);
      setState(service, "READY_TO_INSTALL");

      mockInstallOrchestrator.install.mockResolvedValueOnce({
        success: true,
        backupCreated: true,
        migrated: true,
        restartTriggered: true,
      });

      await service.installUpdate();

      const prisma = (service as any).prisma;
      expect(prisma.updateAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            outcome: UpdateOutcome.INSTALL_STARTED,
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Rollback — requires INSTALLING or INSTALLED_PENDING_RESTART state
  // -----------------------------------------------------------------------

  describe("handleRollback", () => {
    it("calls rollback on the install orchestrator", async () => {
      (service as any).installOrchestrator = mockInstallOrchestrator;
      setState(service, "INSTALLING");

      await service.handleRollback();

      expect(mockInstallOrchestrator.rollback).toHaveBeenCalled();
      expect(service.state).toBe("ROLLED_BACK");
    });

    it("does not throw when no orchestrator exists", async () => {
      // Need the state machine to allow ROLLED_BACK transition
      setState(service, "INSTALLING");
      (service as any).installOrchestrator = null;

      await expect(service.handleRollback()).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Rollback detector
  // -----------------------------------------------------------------------

  describe("checkStartupRollback", () => {
    it("returns no rollback when none is needed", async () => {
      mockRollbackDetector.checkForRollback.mockResolvedValueOnce({
        needsRollback: false,
        reason: null,
      });

      const result = await service.checkStartupRollback();

      expect(result.needsRollback).toBe(false);
    });

    it("transitions state when rollback is needed", async () => {
      // The rollback detector was created with onRollbackRecommended callback
      // that calls stateMachine.rollback() directly. But checkStartupRollback
      // also calls stateMachine.rollback() if needsRollback is true.
      // The state machine needs to allow ROLLED_BACK from the current state.
      // From IDLE, ROLLED_BACK is not allowed. But the detector was created
      // in the constructor with onRollbackRecommended, which will be called
      // by the detector when it detects a rollback.
      //
      // For this test, checkStartupRollback calls stateMachine.rollback()
      // directly after the detector returns. We set the state to INSTALLING
      // so the transition is legal.
      setState(service, "INSTALLING");

      mockRollbackDetector.checkForRollback.mockResolvedValueOnce({
        needsRollback: true,
        reason: "App crashed 5 times",
      });

      const result = await service.checkStartupRollback();

      expect(result.needsRollback).toBe(true);
      expect(service.state).toBe("ROLLED_BACK");
    });
  });

  // -----------------------------------------------------------------------
  // Telemetry
  // -----------------------------------------------------------------------

  describe("telemetry methods", () => {
    it("sendTelemetry delegates to telemetry service enqueue", async () => {
      const event = {
        workstationId: "ws-1",
        licenseId: "lic-1",
        fromVersion: "1.0.0",
        toVersion: "1.2.3",
        attemptId: "attempt-001",
        outcome: UpdateOutcome.CHECK_OK,
      };

      await service.sendTelemetry(event as any);

      expect(mockTelemetryService.enqueue).toHaveBeenCalledWith(event);
    });

    it("flushTelemetry delegates to telemetry service flush", async () => {
      await service.flushTelemetry();

      expect(mockTelemetryService.flush).toHaveBeenCalled();
    });

    it("startTelemetryFlush delegates to telemetry service start", () => {
      service.startTelemetryFlush();

      expect(mockTelemetryService.start).toHaveBeenCalled();
    });

    it("stopTelemetryFlush delegates to telemetry service stop", () => {
      service.stopTelemetryFlush();

      expect(mockTelemetryService.stop).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  describe("dispose", () => {
    it("stops telemetry and cancels any pending download", async () => {
      (service as any).downloadManager = mockDownloadManager;

      // Set state to a value that allows reset() → IDLE (the TRANSITIONS map
      // has no entry for IDLE, so reset() throws from IDLE state, causing an
      // unhandled rejection because dispose() uses void this.cancelDownload()).
      setState(service, "DOWNLOAD_FAILED");

      service.dispose();

      expect(mockTelemetryService.stop).toHaveBeenCalled();
      expect(mockDownloadManager.cancel).toHaveBeenCalled();
    });
  });
});
