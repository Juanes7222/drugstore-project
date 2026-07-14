/**
 * Tests for the backup domain service.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createBackupService, type BackupService, type BackupMetadata } from "./backup.service";
import { BackupInProgressException, BackupFailedException, UploadFailedException } from "./exceptions";

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

describe("BackupService", () => {
  let service: BackupService;

  beforeEach(() => {
    mockInvoke.mockReset();
    vi.clearAllMocks();
    service = createBackupService();
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
  });
});
