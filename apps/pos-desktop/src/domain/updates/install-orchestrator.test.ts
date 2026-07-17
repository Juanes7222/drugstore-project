/**
 * Tests for the Install Orchestrator.
 *
 * Covers pre-install checks, full install sequence (backup → migration → Tauri
 * invoke), rollback on migration failure, and rollback-only path.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  createInstallOrchestrator,
  type InstallOrchestrator,
  type InstallOrchestratorConfig,
} from "./install-orchestrator";
import { InstallFailedException } from "./exceptions";

// ---------------------------------------------------------------------------
// Mock Tauri invoke
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

// ---------------------------------------------------------------------------
// Stub dependencies
// ---------------------------------------------------------------------------

function createFakePrisma(overrides: {
  saleCount?: number;
  shiftCount?: number;
  stalledSyncCount?: number;
} = {}) {
  const { saleCount = 0, shiftCount = 0, stalledSyncCount = 0 } = overrides;

  return {
    sale: {
      count: vi.fn().mockResolvedValue(saleCount),
    },
    cashShift: {
      count: vi.fn().mockResolvedValue(shiftCount),
    },
    syncQueue: {
      count: vi.fn().mockResolvedValue(stalledSyncCount),
    },
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
  };
}

function createFakeBackupService() {
  return {
    createBackup: vi.fn().mockResolvedValue({
    listBackups: vi.fn().mockResolvedValue([]),
    verifyBackup: vi.fn().mockResolvedValue({ isValid: true }),
    restoreBackup: vi.fn().mockResolvedValue(undefined),
    pruneBackups: vi.fn().mockResolvedValue(undefined),
    getPendingCount: vi.fn().mockResolvedValue(0),
    getFailedCount: vi.fn().mockResolvedValue(0),
    getMaxClientSequence: vi.fn().mockResolvedValue(0),
    getContainsUnpushedOperations: vi.fn().mockResolvedValue(false),
      id: "backup-1",
      createdAt: "2026-07-13T12:00:00Z",
      workstationId: "ws-1",
      appVersion: "1.2.3",
      dbSchemaVersion: 1,
      sizeBytes: 5000,
      sha256: "abc",
      reason: "MANUAL",
      containsUnpushedOperations: false,
      pendingCount: 0,
      failedCount: 0,
      maxClientSequence: 0,
      note: "Pre-update backup",
      clockSkewSeconds: null,
      status: "HEALTHY",
    }),
  };
}

function createFakeMigrationRunner() {
  return {
    runPending: vi.fn().mockResolvedValue([
      { id: "m1", name: "add-sale-index", appliedAt: "2026-07-13T12:00:00Z", success: true, errorMessage: null },
    ]),
    listApplied: vi.fn().mockResolvedValue([]),
  };
}

// Also mock the migration-runner factory so InstallOrchestrator uses our fake
vi.mock("./migration-runner", () => ({
  createMigrationRunner: vi.fn(() => createFakeMigrationRunner()),
}));

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<InstallOrchestratorConfig> = {}): InstallOrchestratorConfig {
  return {
    prisma: createFakePrisma(),
    backupService: createFakeBackupService(),
    version: "1.2.3",
    downloadPath: "/tmp/updates/v1.2.3.bin",
    workstationId: "ws-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InstallOrchestrator", () => {
  let orchestrator: InstallOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  // -----------------------------------------------------------------------
  // Pre-install checks
  // -----------------------------------------------------------------------

  describe("runPreInstallChecks", () => {
    it("returns canInstall:true when no open sales or shifts exist", async () => {
      const prisma = createFakePrisma({ saleCount: 0, shiftCount: 0 });
      orchestrator = createInstallOrchestrator(makeConfig({ prisma }));

      const result = await orchestrator.runPreInstallChecks();

      expect(result.canInstall).toBe(true);
      expect(result.blockedReason).toBeNull();
    });

    it("blocks install when sales are still in progress", async () => {
      const prisma = createFakePrisma({ saleCount: 2 });
      orchestrator = createInstallOrchestrator(makeConfig({ prisma }));

      const result = await orchestrator.runPreInstallChecks();

      expect(result.canInstall).toBe(false);
      expect(result.blockedReason).toContain("sale(s) are still in progress");
    });

    it("blocks install when a cash shift is open", async () => {
      const prisma = createFakePrisma({ saleCount: 0, shiftCount: 1 });
      orchestrator = createInstallOrchestrator(makeConfig({ prisma }));

      const result = await orchestrator.runPreInstallChecks();

      expect(result.canInstall).toBe(false);
      expect(result.blockedReason).toContain("open cash shift");
    });

    it("proceeds when sale/shift queries throw (fresh database)", async () => {
      const prisma = {
        sale: { count: vi.fn().mockRejectedValue(new Error("table not found")) },
        cashShift: { count: vi.fn().mockRejectedValue(new Error("table not found")) },
        syncQueue: { count: vi.fn().mockRejectedValue(new Error("table not found")) },
      };
      orchestrator = createInstallOrchestrator(makeConfig({ prisma }));

      const result = await orchestrator.runPreInstallChecks();

      expect(result.canInstall).toBe(true);
    });

    it("warns on stalled sync operations but does not block", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const prisma = createFakePrisma({ stalledSyncCount: 15 });
      orchestrator = createInstallOrchestrator(makeConfig({ prisma }));

      const result = await orchestrator.runPreInstallChecks();

      expect(result.canInstall).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("permanently failed sync"),
      );
      consoleWarnSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // Install
  // -----------------------------------------------------------------------

  describe("install", () => {
    it("runs the full install sequence and returns success report", async () => {
      mockInvoke.mockResolvedValue(undefined);
      orchestrator = createInstallOrchestrator(makeConfig());

      const report = await orchestrator.install();

      expect(report.success).toBe(true);
      expect(report.backupCreated).toBe(true);
      expect(report.migrated).toBe(true);
      expect(report.restartTriggered).toBe(true);
    });

    it("throws InstallFailedException when pre-install checks fail", async () => {
      const prisma = createFakePrisma({ saleCount: 1 });
      orchestrator = createInstallOrchestrator(makeConfig({ prisma }));

      await expect(orchestrator.install()).rejects.toThrow(InstallFailedException);
    });

    it("marks backupCreated:false when backup fails but continues install", async () => {
      const backupService = createFakeBackupService();
      backupService.createBackup.mockRejectedValueOnce(new Error("Disk full"));

      orchestrator = createInstallOrchestrator(
        makeConfig({ backupService, migrations: [] }),
      );

      const report = await orchestrator.install();

      expect(report.backupCreated).toBe(false);
      expect(report.success).toBe(true);
    });

    it("applies migrations when migrations are provided", async () => {
      const { createMigrationRunner } = await import("./migration-runner");
      const mockRunner = createFakeMigrationRunner();
      (createMigrationRunner as any).mockReturnValueOnce(mockRunner);

      orchestrator = createInstallOrchestrator(
        makeConfig({
          migrations: [{ name: "add-index", type: "SQL", payload: "CREATE INDEX..." }],
        }),
      );

      const report = await orchestrator.install();

      expect(report.migrated).toBe(true);
      expect(mockRunner.runPending).toHaveBeenCalled();
    });

    it("triggers rollback and throws InstallFailedException when migration fails", async () => {
      const { createMigrationRunner } = await import("./migration-runner");
      const mockRunner = createFakeMigrationRunner();
      mockRunner.runPending.mockRejectedValueOnce(new Error("Migration SQL error"));
      (createMigrationRunner as any).mockReturnValueOnce(mockRunner);

      orchestrator = createInstallOrchestrator(
        makeConfig({
          migrations: [{ name: "bad-migration", type: "SQL", payload: "BAD SQL" }],
        }),
      );

      await expect(orchestrator.install()).rejects.toThrow(InstallFailedException);

      // Should have attempted rollback on migration failure
      expect(mockInvoke).toHaveBeenCalledWith("rollback_update_command");
    });

    it("throws InstallFailedException when Tauri install command fails", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("Installer crashed"));

      orchestrator = createInstallOrchestrator(makeConfig());

      await expect(orchestrator.install()).rejects.toThrow(InstallFailedException);
    });

    it("sets migrated:true when migrations array is empty", async () => {
      orchestrator = createInstallOrchestrator(makeConfig({ migrations: [] }));

      const report = await orchestrator.install();

      expect(report.migrated).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Rollback
  // -----------------------------------------------------------------------

  describe("rollback", () => {
    it("calls Tauri rollback_update_command", async () => {
      orchestrator = createInstallOrchestrator(makeConfig());

      await orchestrator.rollback();

      expect(mockInvoke).toHaveBeenCalledWith("rollback_update_command");
    });

    it("does not throw when the rollback invoke fails", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("Rust error"));

      orchestrator = createInstallOrchestrator(makeConfig());

      // Should resolve, not reject
      await expect(orchestrator.rollback()).resolves.toBeUndefined();
    });
  });
});
