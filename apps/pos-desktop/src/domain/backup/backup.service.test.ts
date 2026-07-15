/**
 * Tests for the backup domain service.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createBackupService, type BackupService, type BackupMetadata } from "./backup.service";
import { BackupInProgressException, BackupFailedException, RestoreFailedException, UploadFailedException } from "./exceptions";
import type { VerificationReport, RestoreReport } from "./backup.service";

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

// Mock infrastructure config
vi.mock("../../infrastructure/config", () => ({
  API_BASE_URL: "http://localhost:3000",
}));

// Mock is-online
vi.mock("../../common/is-online", () => ({
  isOnline: vi.fn(() => true),
}));

// Mock startup health (for verifyBackup)
vi.mock("../../infrastructure/startup-health", () => ({
  runLocalDatabaseIntegrityCheck: vi.fn(),
}));

// Mock local-database (for restoreBackup)
vi.mock("../../infrastructure/local-database", () => ({
  closeLocalDatabase: vi.fn(),
}));

// Mock PGlite (used in verifyBackup) — must be callable with `new`
const mockPGliteInstance = { close: vi.fn().mockResolvedValue(undefined) };
function PGliteMock() {
  return mockPGliteInstance;
}
vi.mock("@electric-sql/pglite", () => ({
  PGlite: PGliteMock,
}));

describe("BackupService", () => {
  let service: BackupService;

  beforeEach(() => {
    mockInvoke.mockReset();
    vi.clearAllMocks();
    service = createBackupService();
  });

  afterEach(() => {
    // Restore global.fetch in case a test replaced it
    delete (globalThis as any).fetch;
    vi.useRealTimers();
  });

  describe("createBackup", () => {
    it("calls invoke with create_backup_command and returns metadata", async () => {
      const mockMetadata: BackupMetadata = {
        id: "backup-1",
        createdAt: "2026-07-13T10:00:00Z",
        workstationId: "ws-1",
        appVersion: "1.0.0",
        dbSchemaVersion: 1,
        sizeBytes: 1024,
        sha256: "abc123",
        reason: "MANUAL",
        containsUnpushedOperations: false,
        pendingCount: 0,
        failedCount: 0,
        maxClientSequence: 42,
        note: null,
        clockSkewSeconds: null,
        status: "HEALTHY",
      };
      mockInvoke.mockResolvedValueOnce(mockMetadata);

      const result = await service.createBackup({
        reason: "MANUAL",
        workstationId: "ws-1",
        dbSchemaVersion: 1,
        pendingCount: 0,
        failedCount: 0,
        maxClientSequence: 42,
      });

      expect(result).toEqual(mockMetadata);
      expect(mockInvoke).toHaveBeenCalledWith("create_backup_command", {
        request: expect.objectContaining({
          reason: "MANUAL",
          workstationId: "ws-1",
        }),
      });
    });

    it("throws BackupInProgressException when a backup is already running", async () => {
      mockInvoke.mockResolvedValueOnce({} as BackupMetadata);
      const request = {
        reason: "MANUAL" as const,
        workstationId: "ws-1",
        dbSchemaVersion: 1,
        pendingCount: 0,
        failedCount: 0,
        maxClientSequence: 0,
      };

      const firstBackup = service.createBackup(request);
      await expect(service.createBackup(request)).rejects.toThrow(BackupInProgressException);

      await firstBackup;
    });

    it("wraps non-DomainError exceptions in BackupFailedException", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("Rust panic"));

      await expect(
        service.createBackup({
          reason: "MANUAL",
          workstationId: "ws-1",
          dbSchemaVersion: 1,
          pendingCount: 0,
          failedCount: 0,
          maxClientSequence: 0,
        }),
      ).rejects.toThrow(BackupFailedException);
    });
  });

  describe("listBackups", () => {
    it("returns an array of backup metadata", async () => {
      mockInvoke.mockResolvedValueOnce([
        { id: "b1" },
        { id: "b2" },
      ]);

      const result = await service.listBackups();

      expect(result).toHaveLength(2);
      expect(mockInvoke).toHaveBeenCalledWith("list_backups_command");
    });

    it("returns empty array when no backups exist", async () => {
      mockInvoke.mockResolvedValueOnce([]);

      const result = await service.listBackups();

      expect(result).toEqual([]);
    });
  });

  describe("pruneBackups", () => {
    it("calls invoke with prune_backups_command and returns count", async () => {
      mockInvoke.mockResolvedValueOnce(3);

      const result = await service.pruneBackups({ keepLastN: 10 });

      expect(result).toBe(3);
      expect(mockInvoke).toHaveBeenCalledWith("prune_backups_command", {
        policy: { keepLastN: 10 },
      });
    });

    it("passes null when no policy is provided", async () => {
      mockInvoke.mockResolvedValueOnce(0);

      await service.pruneBackups();

      expect(mockInvoke).toHaveBeenCalledWith("prune_backups_command", {
        policy: null,
      });
    });
  });

  describe("getBackupSummary", () => {
    it("returns backup summary from Rust", async () => {
      mockInvoke.mockResolvedValueOnce({
        lastBackupAt: "2026-07-13T10:00:00Z",
        lastBackupReason: "MANUAL",
        totalBackups: 5,
        oldestBackupAt: "2026-07-01T00:00:00Z",
        totalBackupSizeBytes: 50000,
      });

      const result = await service.getBackupSummary();

      expect(result.totalBackups).toBe(5);
      expect(result.lastBackupReason).toBe("MANUAL");
    });
  });

  describe("getBackupHealth", () => {
    it("returns health level from Rust", async () => {
      mockInvoke.mockResolvedValueOnce("HEALTHY");

      const result = await service.getBackupHealth();

      expect(result).toBe("HEALTHY");
    });

    it("returns STALE when backups are old", async () => {
      mockInvoke.mockResolvedValueOnce("STALE");

      const result = await service.getBackupHealth();

      expect(result).toBe("STALE");
    });
  });

  describe("fetchLocalNumberHint", () => {
    it("returns null when offline", async () => {
      const { isOnline } = await import("../../common/is-online");
      (isOnline as any).mockReturnValueOnce(false);

      const result = await service.fetchLocalNumberHint("ws-1", "token");

      expect(result).toBeNull();
    });

    it("returns null on HTTP error", async () => {
      const fakeFetch = vi.fn().mockResolvedValueOnce({ ok: false });
      global.fetch = fakeFetch;

      const result = await service.fetchLocalNumberHint("ws-1", "token");

      expect(result).toBeNull();
    });

    it("returns maxLocalNumber from server response", async () => {
      const fakeFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workstationId: "ws-1", maxLocalNumber: 42 }),
      });
      global.fetch = fakeFetch;

      const result = await service.fetchLocalNumberHint("ws-1", "token");

      expect(result).toBe(42);
    });
  });

  describe("shouldRunPeriodicBackup", () => {
    it("returns true when lastBackupAt is null", () => {
      expect(service.shouldRunPeriodicBackup(null)).toBe(true);
    });

    it("returns true when last backup is older than 6 hours", () => {
      const sixHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
      expect(service.shouldRunPeriodicBackup(sixHoursAgo)).toBe(true);
    });

    it("returns false when last backup is recent", () => {
      const now = new Date().toISOString();
      expect(service.shouldRunPeriodicBackup(now)).toBe(false);
    });
  });

  describe("uploadBackupToServer", () => {
    it("throws UploadFailedException when backup is not found", async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // listBackups returns empty
        .mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

      await expect(
        service.uploadBackupToServer("nonexistent-id", "password", "token"),
      ).rejects.toThrow(UploadFailedException);
    });

    it("uploads encrypted backup to server", async () => {
      mockInvoke
        .mockResolvedValueOnce([
          {
            id: "backup-1",
            workstationId: "ws-1",
            createdAt: "2026-07-13T10:00:00Z",
            sha256: "abc123",
            appVersion: "1.0.0",
            dbSchemaVersion: 1,
            sizeBytes: 100,
            reason: "MANUAL",
            containsUnpushedOperations: false,
            pendingCount: 0,
            failedCount: 0,
            maxClientSequence: 0,
            note: null,
            clockSkewSeconds: null,
            status: "HEALTHY",
          },
        ])
        .mockResolvedValueOnce(new Uint8Array([1, 2, 3, 4]));

      const fakeFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ uploadId: "upload-1", workstationId: "ws-1", createdAt: "now" }),
      });
      global.fetch = fakeFetch;

      const result = await service.uploadBackupToServer("backup-1", "password", "token");

      expect(result.uploadId).toBe("upload-1");
      expect(fakeFetch).toHaveBeenCalledWith(
        "http://localhost:3000/terminals/ws-1/backup-upload",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer token",
            "X-Backup-Id": "backup-1",
          }),
        }),
      );
    });

    it("throws UploadFailedException on HTTP error from server", async () => {
      mockInvoke
        .mockResolvedValueOnce([
          {
            id: "backup-2",
            workstationId: "ws-1",
            createdAt: "2026-07-13T10:00:00Z",
            sha256: "def456",
            appVersion: "1.0.0",
            dbSchemaVersion: 1,
            sizeBytes: 200,
            reason: "MANUAL",
            containsUnpushedOperations: false,
            pendingCount: 0,
            failedCount: 0,
            maxClientSequence: 0,
            note: null,
            clockSkewSeconds: null,
            status: "HEALTHY",
          },
        ])
        .mockResolvedValueOnce(new Uint8Array([5, 6, 7, 8]));

      const fakeFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 413,
        text: () => Promise.resolve("Payload too large"),
      });
      global.fetch = fakeFetch;

      await expect(
        service.uploadBackupToServer("backup-2", "password", "token"),
      ).rejects.toThrow(UploadFailedException);
    });
  });

  describe("verifyBackup", () => {
    it("returns passed=true when hash matches and integrity passes", async () => {
      const mockIntegrityReport = {
        passed: true,
        expectedTables: ["Client"],
        actualCounts: { Client: 5 },
        missingTables: [],
      };

      mockInvoke
        .mockResolvedValueOnce({ hashMatched: true }) // verify_backup_command
        .mockResolvedValueOnce({ tempDataDir: "/tmp/backup-check" }) // copy_backup_to_temp_command
        .mockResolvedValueOnce(undefined); // remove_temp_dir_command

      const { runLocalDatabaseIntegrityCheck } = await import("../../infrastructure/startup-health");
      (runLocalDatabaseIntegrityCheck as any).mockResolvedValue(mockIntegrityReport);

      const result = await service.verifyBackup("backup-1");

      expect(result.passed).toBe(true);
      expect(result.hashMatched).toBe(true);
      expect(result.integrityCheckPassed).toBe(true);
      expect(result.tableCounts).toEqual({ Client: 5 });
      expect(mockInvoke).toHaveBeenCalledWith("verify_backup_command", { id: "backup-1" });
    });

    it("marks backup as corrupt when hash does not match", async () => {
      mockInvoke
        .mockResolvedValueOnce({ hashMatched: false }) // verify_backup_command
        .mockResolvedValueOnce(undefined); // mark_backup_corrupt_command

      const result = await service.verifyBackup("backup-no-hash");

      expect(result.passed).toBe(false);
      expect(result.hashMatched).toBe(false);
      expect(result.integrityCheckPassed).toBe(false);
      expect(mockInvoke).toHaveBeenCalledWith("mark_backup_corrupt_command", { id: "backup-no-hash" });
    });

    it("marks backup as corrupt when integrity check fails", async () => {
      const mockIntegrityReport = {
        passed: false,
        expectedTables: ["Client", "Sale"],
        actualCounts: { Client: 5 },
        missingTables: ["Sale"],
        error: undefined,
      };

      mockInvoke
        .mockResolvedValueOnce({ hashMatched: true })
        .mockResolvedValueOnce({ tempDataDir: "/tmp/backup-check" })
        .mockResolvedValueOnce(undefined) // remove_temp_dir_command
        .mockResolvedValueOnce(undefined); // mark_backup_corrupt_command

      const { runLocalDatabaseIntegrityCheck } = await import("../../infrastructure/startup-health");
      (runLocalDatabaseIntegrityCheck as any).mockResolvedValue(mockIntegrityReport);

      const result = await service.verifyBackup("backup-2");

      expect(result.passed).toBe(false);
      expect(result.hashMatched).toBe(true);
      expect(result.integrityCheckPassed).toBe(false);
      expect(result.error).toContain("Missing or unreadable tables");
      expect(mockInvoke).toHaveBeenCalledWith("mark_backup_corrupt_command", { id: "backup-2" });
    });

    it("handles PGlite failure during integrity check gracefully", async () => {
      mockInvoke
        .mockResolvedValueOnce({ hashMatched: true })
        .mockResolvedValueOnce({ tempDataDir: "/tmp/backup-check" })
        .mockResolvedValueOnce(undefined) // remove_temp_dir_command
        .mockResolvedValueOnce(undefined); // mark_backup_corrupt_command

      const { runLocalDatabaseIntegrityCheck } = await import("../../infrastructure/startup-health");
      (runLocalDatabaseIntegrityCheck as any).mockRejectedValue(new Error("Corrupt file"));

      const result = await service.verifyBackup("backup-3");

      expect(result.passed).toBe(false);
      expect(result.hashMatched).toBe(true);
      expect(result.error).toBe("Corrupt file");
    });

    it("cleans up temp dir even when integrity check throws", async () => {
      mockInvoke
        .mockResolvedValueOnce({ hashMatched: true })
        .mockResolvedValueOnce({ tempDataDir: "/tmp/backup-check" })
        .mockResolvedValueOnce(undefined) // remove_temp_dir_command
        .mockResolvedValueOnce(undefined);

      const { runLocalDatabaseIntegrityCheck } = await import("../../infrastructure/startup-health");
      (runLocalDatabaseIntegrityCheck as any).mockRejectedValue(new Error("DB error"));

      await service.verifyBackup("backup-4");

      expect(mockInvoke).toHaveBeenCalledWith("remove_temp_dir_command", { path: "/tmp/backup-check" });
    });
  });

  describe("restoreBackup", () => {
    it("closes database, invokes restore, and reloads page", async () => {
      const restoreReport: RestoreReport = {
        id: "backup-1",
        success: true,
        restarted: true,
      };
      mockInvoke.mockResolvedValueOnce(restoreReport);

      const reloadSpy = vi.fn();
      Object.defineProperty(window, "location", {
        value: { reload: reloadSpy },
        writable: true,
      });

      const result = await service.restoreBackup("backup-1");

      expect(result.success).toBe(true);
      const { closeLocalDatabase } = await import("../../infrastructure/local-database");
      expect(closeLocalDatabase).toHaveBeenCalledOnce();
      expect(mockInvoke).toHaveBeenCalledWith("restore_backup_command", {
        id: "backup-1",
        options: { skipSchemaVersionCheck: false },
      });
      expect(reloadSpy).toHaveBeenCalledOnce();
    });

    it("throws BackupInProgressException when a restore is already running", async () => {
      mockInvoke.mockResolvedValueOnce({ success: true, restarted: true, id: "b1" });

      const firstRestore = service.restoreBackup("b1");
      await expect(service.restoreBackup("b2")).rejects.toThrow(BackupInProgressException);
      await firstRestore;
    });

    it("throws RestoreFailedException on non-DomainError", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("Rust error during restore"));

      await expect(
        service.restoreBackup("backup-1"),
      ).rejects.toThrow(RestoreFailedException);
    });

    it("passes skipSchemaVersionCheck option", async () => {
      mockInvoke.mockResolvedValueOnce({ id: "b1", success: true, restarted: true });

      const reloadSpy = vi.fn();
      Object.defineProperty(window, "location", {
        value: { reload: reloadSpy },
        writable: true,
      });

      await service.restoreBackup("backup-1", { skipSchemaVersionCheck: true });

      expect(mockInvoke).toHaveBeenCalledWith("restore_backup_command", {
        id: "backup-1",
        options: { skipSchemaVersionCheck: true },
      });
    });
  });

  describe("startPeriodicBackup", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("runs an initial tick and sets an interval", async () => {
      mockInvoke
        .mockResolvedValueOnce({
          lastBackupAt: null,
          lastBackupReason: null,
          totalBackups: 0,
          oldestBackupAt: null,
          totalBackupSizeBytes: 0,
        })
        .mockResolvedValueOnce({
          id: "backup-auto-1",
          createdAt: new Date().toISOString(),
          workstationId: "ws-1",
          appVersion: "1.0.0",
          dbSchemaVersion: 1,
          sizeBytes: 500,
          sha256: "abc",
          reason: "PERIODIC",
          containsUnpushedOperations: false,
          pendingCount: 0,
          failedCount: 0,
          maxClientSequence: 0,
          note: null,
          clockSkewSeconds: null,
          status: "HEALTHY",
        });

      const onSuccess = vi.fn();
      const factory = vi.fn().mockResolvedValue({
        reason: "PERIODIC",
        workstationId: "ws-1",
        dbSchemaVersion: 1,
        pendingCount: 0,
        failedCount: 0,
        maxClientSequence: 0,
      });

      service.startPeriodicBackup(factory, onSuccess);

      // Wait for the initial tick
      await vi.advanceTimersByTimeAsync(0);

      expect(factory).toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalledWith("create_backup_command", expect.anything());
      expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: "backup-auto-1" }));
    });

    it("skips the tick when the last backup is recent", async () => {
      mockInvoke.mockResolvedValueOnce({
        lastBackupAt: new Date().toISOString(),
        lastBackupReason: "PERIODIC",
        totalBackups: 1,
        oldestBackupAt: null,
        totalBackupSizeBytes: 500,
      });

      const factory = vi.fn();
      service.startPeriodicBackup(factory);

      await vi.advanceTimersByTimeAsync(0);

      expect(factory).not.toHaveBeenCalled();
    });

    it("calls onError when the backup fails", async () => {
      mockInvoke
        .mockResolvedValueOnce({
          lastBackupAt: null,
          lastBackupReason: null,
          totalBackups: 0,
          oldestBackupAt: null,
          totalBackupSizeBytes: 0,
        })
        .mockRejectedValueOnce(new Error("Backup failed"));

      const onError = vi.fn();
      const factory = vi.fn().mockResolvedValue({
        reason: "PERIODIC",
        workstationId: "ws-1",
        dbSchemaVersion: 1,
        pendingCount: 0,
        failedCount: 0,
        maxClientSequence: 0,
      });

      service.startPeriodicBackup(factory, undefined, onError);

      await vi.advanceTimersByTimeAsync(0);

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("does not start a second timer if already running", async () => {
      mockInvoke.mockResolvedValue({
        lastBackupAt: null,
        lastBackupReason: null,
        totalBackups: 0,
        oldestBackupAt: null,
        totalBackupSizeBytes: 0,
      });

      const factory = vi.fn().mockResolvedValue({
        reason: "PERIODIC",
        workstationId: "ws-1",
        dbSchemaVersion: 1,
        pendingCount: 0,
        failedCount: 0,
        maxClientSequence: 0,
      });

      service.startPeriodicBackup(factory);
      service.startPeriodicBackup(factory); // second call should be no-op

      await vi.advanceTimersByTimeAsync(0);

      // The tick runs twice (once for each startPeriodicBackup call)
      // but the second call is guarded by the timer check
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe("stopPeriodicBackup", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("clears the timer and prevents further ticks", async () => {
      mockInvoke.mockResolvedValue({
        lastBackupAt: null,
        lastBackupReason: null,
        totalBackups: 0,
        oldestBackupAt: null,
        totalBackupSizeBytes: 0,
      });

      const factory = vi.fn().mockResolvedValue({
        reason: "PERIODIC",
        workstationId: "ws-1",
        dbSchemaVersion: 1,
        pendingCount: 0,
        failedCount: 0,
        maxClientSequence: 0,
      });

      service.startPeriodicBackup(factory);

      // Let the initial tick run
      await vi.advanceTimersByTimeAsync(0);
      expect(factory).toHaveBeenCalledTimes(1);

      service.stopPeriodicBackup();

      // Advance far beyond the interval — no additional ticks
      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 100);
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe("createBackup (slow backup)", () => {
    it("dispatches backup:slow event when backup takes longer than threshold", async () => {
      mockInvoke.mockResolvedValue({
        id: "backup-slow",
        createdAt: new Date().toISOString(),
        workstationId: "ws-1",
        appVersion: "1.0.0",
        dbSchemaVersion: 1,
        sizeBytes: 10000,
        sha256: "slow-hash",
        reason: "MANUAL",
        containsUnpushedOperations: false,
        pendingCount: 0,
        failedCount: 0,
        maxClientSequence: 0,
        note: null,
        clockSkewSeconds: null,
        status: "HEALTHY",
      });

      const eventSpy = vi.fn();
      window.addEventListener("backup:slow", eventSpy);

      // Simulate a slow backup by making Date.now() return a value > 2000ms delta
      const realNow = Date.now.bind(globalThis.Date);
      let callCount = 0;
      vi.spyOn(Date, "now").mockImplementation(() => {
        callCount++;
        // First call is before invoke (startTime), second is after
        if (callCount === 1) return realNow();
        return realNow() + 3000; // > BACKUP_TOAST_THRESHOLD_MS (2000)
      });

      await service.createBackup({
        reason: "MANUAL",
        workstationId: "ws-1",
        dbSchemaVersion: 1,
        pendingCount: 0,
        failedCount: 0,
        maxClientSequence: 42,
      });

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "backup:slow",
          detail: expect.objectContaining({ id: "backup-slow" }),
        }),
      );

      vi.restoreAllMocks();
    });

    it("does not dispatch backup:slow when backup is fast", async () => {
      mockInvoke.mockResolvedValue({
        id: "backup-fast",
        createdAt: new Date().toISOString(),
        workstationId: "ws-1",
        appVersion: "1.0.0",
        dbSchemaVersion: 1,
        sizeBytes: 100,
        sha256: "fast-hash",
        reason: "MANUAL",
        containsUnpushedOperations: false,
        pendingCount: 0,
        failedCount: 0,
        maxClientSequence: 0,
        note: null,
        clockSkewSeconds: null,
        status: "HEALTHY",
      });

      const eventSpy = vi.fn();
      window.addEventListener("backup:slow", eventSpy);

      await service.createBackup({
        reason: "MANUAL",
        workstationId: "ws-1",
        dbSchemaVersion: 1,
        pendingCount: 0,
        failedCount: 0,
        maxClientSequence: 0,
      });

      expect(eventSpy).not.toHaveBeenCalled();
    });
  });

  describe("fetchLocalNumberHint (catch block)", () => {
    it("returns null when fetch throws", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

      const result = await service.fetchLocalNumberHint("ws-1", "token");

      expect(result).toBeNull();
    });
  });
});
