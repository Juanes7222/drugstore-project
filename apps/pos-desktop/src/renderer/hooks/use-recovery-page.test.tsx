/**
 * Unit tests for useRecoveryPage hook.
 *
 * Covers: initial rendering, data loading, permission gating,
 * backup creation, verification, selection, restore flow, refresh.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { RoleType } from '@pharmacy/shared-types';
import type { LocalSession } from '../../domain/auth/local-session.store';
import type { BackupMetadata, BackupHealthLevel, VerificationReport } from '../../domain/backup/backup.service';
import type { RecoveryLogEntry } from '../../domain/backup/recovery-log.service';
import { useRecoveryPage } from './use-recovery-page';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockBackupService, mockRecoveryLogService } = vi.hoisted(() => ({
  mockBackupService: {
    listBackups: vi.fn<() => Promise<BackupMetadata[]>>(),
    getBackupHealth: vi.fn<() => Promise<BackupHealthLevel>>(),
    createBackup: vi.fn<() => Promise<BackupMetadata>>(),
    verifyBackup: vi.fn<() => Promise<VerificationReport>>(),
    restoreBackup: vi.fn<() => Promise<void>>(),
    fetchLocalNumberHint: vi.fn<() => Promise<number | null>>(),
  },
  mockRecoveryLogService: {
    list: vi.fn<() => Promise<RecoveryLogEntry[]>>(),
    log: vi.fn<() => Promise<void>>(),
  },
}));

const { mockGetStartupHealth, mockAcknowledgeCleanStartup, mockReportIntegrityFailure, mockRunLocalDatabaseIntegrityCheck } = vi.hoisted(() => ({
  mockGetStartupHealth: vi.fn(),
  mockAcknowledgeCleanStartup: vi.fn(),
  mockReportIntegrityFailure: vi.fn(),
  mockRunLocalDatabaseIntegrityCheck: vi.fn(),
}));

const { mockGetLocalDatabase } = vi.hoisted(() => ({
  mockGetLocalDatabase: vi.fn(),
}));

const mockSessionRef: { current: LocalSession | null } = { current: null };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../domain/auth/local-session.store', () => ({
  useLocalSessionStore: (
    selector: (s: { session: LocalSession | null }) => unknown,
  ) => selector({ session: mockSessionRef.current }),
}));

vi.mock('../../renderer/components/common/service-context', () => ({
  useBackupService: () => mockBackupService,
  useRecoveryLogService: () => mockRecoveryLogService,
}));

vi.mock('../../infrastructure/startup-health', () => ({
  getStartupHealth: (...args: unknown[]) => mockGetStartupHealth(...args),
  acknowledgeCleanStartup: (...args: unknown[]) => mockAcknowledgeCleanStartup(...args),
  reportIntegrityFailure: (...args: unknown[]) => mockReportIntegrityFailure(...args),
  runLocalDatabaseIntegrityCheck: (...args: unknown[]) => mockRunLocalDatabaseIntegrityCheck(...args),
}));

vi.mock('../../infrastructure/local-database', () => ({
  getLocalDatabase: (...args: unknown[]) => mockGetLocalDatabase(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const createBackup = (overrides: Partial<BackupMetadata> = {}): BackupMetadata => ({
  id: 'backup-1',
  createdAt: '2026-07-14T08:00:00.000Z',
  workstationId: 'ws-1',
  appVersion: '1.0.0',
  dbSchemaVersion: 1,
  sizeBytes: 1048576,
  sha256: 'abc123',
  reason: 'MANUAL',
  containsUnpushedOperations: false,
  pendingCount: 3,
  failedCount: 0,
  maxClientSequence: 42,
  note: null,
  clockSkewSeconds: null,
  status: 'HEALTHY',
  ...overrides,
});

const createLogEntry = (overrides: Partial<RecoveryLogEntry> = {}): RecoveryLogEntry =>
  ({
    id: 'log-1',
    at: new Date('2026-07-14T10:00:00.000Z'),
    actorUserId: 'user-001',
    action: 'BACKUP_CREATED',
    backupId: 'backup-1',
    details: null,
    ...overrides,
  }) as RecoveryLogEntry;

const makeAdminSession = (): LocalSession => ({
  userId: 'admin-1',
  username: 'admin',
  fullName: 'Admin User',
  displayName: 'Admin',
  email: null,
  role: RoleType.ADMIN,
  subscriptionId: null,
  workstationId: 'ws-1',
  accessToken: 'token-abc',
  refreshToken: 'refresh-abc',
  expiresAt: new Date('2099-01-01'),
  sessionId: 'sess-1',
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
});

const makeCashierSession = (): LocalSession => ({
  ...makeAdminSession(),
  userId: 'cashier-1',
  username: 'cashier',
  displayName: 'Cashier',
  role: RoleType.CASHIER,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useRecoveryPage', () => {
  beforeEach(() => {
    mockGetStartupHealth.mockResolvedValue({ status: 'OK', message: '' });
    mockBackupService.listBackups.mockResolvedValue([]);
    mockRecoveryLogService.list.mockResolvedValue([]);
    mockBackupService.getBackupHealth.mockResolvedValue('HEALTHY');
    mockGetLocalDatabase.mockResolvedValue({
      client: {},
      prisma: { syncQueue: { count: vi.fn(), aggregate: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockSessionRef.current = null;
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  describe('initial state', () => {
    it('has loading true, hasAccess false, empty backups, and null error', () => {
      // Return a never-resolving promise so loading stays true after mount
      mockBackupService.listBackups.mockReturnValue(new Promise(() => undefined));

      const { result } = renderHook(() => useRecoveryPage());

      expect(result.current.loading).toBe(true);
      expect(result.current.hasAccess).toBe(false);
      expect(result.current.backups).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.activeTab).toBe('backups');
      expect(result.current.selectedBackup).toBeNull();
      expect(result.current.verifyReport).toBeNull();
      expect(result.current.restoreConfirmText).toBe('');
      expect(result.current.isRestoring).toBe(false);
      expect(result.current.isVerifying).toBeNull();
      expect(result.current.isCreatingBackup).toBe(false);
      expect(result.current.gapHint).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  describe('loadData', () => {
    it('calls backupService.listBackups, recoveryLogService.list, backupService.getBackupHealth, and getStartupHealth on mount', async () => {
      const backup = createBackup();
      const logEntry = createLogEntry();
      mockBackupService.listBackups.mockResolvedValue([backup]);
      mockRecoveryLogService.list.mockResolvedValue([logEntry]);
      mockBackupService.getBackupHealth.mockResolvedValue('STALE');
      mockGetStartupHealth.mockResolvedValue({ status: 'OK', message: '' });

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockBackupService.listBackups).toHaveBeenCalledOnce();
      expect(mockRecoveryLogService.list).toHaveBeenCalledOnce();
      expect(mockBackupService.getBackupHealth).toHaveBeenCalledOnce();
      expect(mockGetStartupHealth).toHaveBeenCalledOnce();
    });

    it('sets loading false and assigns data on success', async () => {
      const backup = createBackup();
      const logEntry = createLogEntry();
      mockBackupService.listBackups.mockResolvedValue([backup]);
      mockRecoveryLogService.list.mockResolvedValue([logEntry]);
      mockGetStartupHealth.mockResolvedValue({ status: 'OK', message: '' });

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeNull();
      expect(result.current.backups.length).toBe(1);
      expect(result.current.backups[0].id).toBe('backup-1');
      expect(result.current.logEntries.length).toBe(1);
      expect(result.current.logEntries[0].id).toBe('log-1');
    });

    it('sets backupHealth from getBackupHealth', async () => {
      mockBackupService.getBackupHealth.mockResolvedValue('CRITICAL');
      mockGetStartupHealth.mockResolvedValue({ status: 'OK', message: '' });

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.backupHealth).toBe('CRITICAL');
    });

    it('sets healthStatus to INTEGRITY_FAILED when startup status is INTEGRITY_FAILED', async () => {
      mockGetStartupHealth.mockResolvedValue({ status: 'INTEGRITY_FAILED', message: '' });

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.healthStatus).toBe('INTEGRITY_FAILED');
    });

    it('sets healthStatus to HEALTHY after integrity check passes on UNHEALTHY_SHUTDOWN', async () => {
      mockGetStartupHealth.mockResolvedValue({ status: 'UNHEALTHY_SHUTDOWN', message: '' });
      mockRunLocalDatabaseIntegrityCheck.mockResolvedValue({
        passed: true,
        expectedTables: [],
        actualCounts: {},
        missingTables: [],
      });
      mockAcknowledgeCleanStartup.mockResolvedValue(undefined);

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // The integrity check effect runs after loadData sets UNHEALTHY_SHUTDOWN.
      // When the check passes, healthStatus becomes HEALTHY.
      await waitFor(() => {
        expect(result.current.healthStatus).toBe('HEALTHY');
      });
    });

    it('sets healthStatus to HEALTHY when startup status is OK', async () => {
      mockGetStartupHealth.mockResolvedValue({ status: 'OK', message: '' });

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.healthStatus).toBe('HEALTHY');
    });

    it('sets error message when loadData throws', async () => {
      mockBackupService.listBackups.mockRejectedValue(new Error('Network failure'));

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Network failure');
    });

    it('sets error message from string when thrown value is not an Error', async () => {
      mockBackupService.listBackups.mockRejectedValue('string error');

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('string error');
    });
  });

  // -----------------------------------------------------------------------
  // Access control
  // -----------------------------------------------------------------------

  describe('hasAccess', () => {
    it('is false when session is null', () => {
      mockSessionRef.current = null;

      const { result } = renderHook(() => useRecoveryPage());

      expect(result.current.hasAccess).toBe(false);
    });

    it('is true when session.role is ADMIN', () => {
      mockSessionRef.current = makeAdminSession();

      const { result } = renderHook(() => useRecoveryPage());

      expect(result.current.hasAccess).toBe(true);
    });

    it('is false when session.role is CASHIER', () => {
      mockSessionRef.current = makeCashierSession();

      const { result } = renderHook(() => useRecoveryPage());

      expect(result.current.hasAccess).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // handleCreateBackup
  // -----------------------------------------------------------------------

  describe('handleCreateBackup', () => {
    beforeEach(() => {
      mockSessionRef.current = makeAdminSession();
      mockBackupService.listBackups.mockResolvedValue([]);
      mockRecoveryLogService.list.mockResolvedValue([]);
      mockGetStartupHealth.mockResolvedValue({ status: 'OK', message: '' });
      mockGetLocalDatabase.mockResolvedValue({
        client: {},
        prisma: {
          syncQueue: {
            count: vi.fn().mockResolvedValue(0),
            aggregate: vi.fn().mockResolvedValue({ _max: { clientSequence: 42n } }),
          },
        },
      });
    });

    it('calls backupService.createBackup with MANUAL reason', async () => {
      mockBackupService.createBackup.mockResolvedValue(createBackup());

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleCreateBackup();
      });

      expect(mockBackupService.createBackup).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'MANUAL' }),
      );
    });

    it('logs BACKUP_CREATED after successful creation', async () => {
      const backup = createBackup();
      mockBackupService.createBackup.mockResolvedValue(backup);

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleCreateBackup();
      });

      expect(mockRecoveryLogService.log).toHaveBeenCalledWith(
        'BACKUP_CREATED',
        'admin-1',
        backup.id,
      );
    });

    it('sets error when creation fails', async () => {
      mockBackupService.createBackup.mockRejectedValue(new Error('Disk full'));

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleCreateBackup();
      });

      expect(result.current.error).toBe('Disk full');
    });

    it('sets isCreatingBackup back to false after completion', async () => {
      mockBackupService.createBackup.mockResolvedValue(createBackup());

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleCreateBackup();
      });

      expect(result.current.isCreatingBackup).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // handleVerify
  // -----------------------------------------------------------------------

  describe('handleVerify', () => {
    beforeEach(() => {
      mockSessionRef.current = makeAdminSession();
      mockBackupService.listBackups.mockResolvedValue([createBackup()]);
      mockRecoveryLogService.list.mockResolvedValue([]);
      mockGetStartupHealth.mockResolvedValue({ status: 'OK', message: '' });
    });

    it('calls backupService.verifyBackup with the given id', async () => {
      const report: VerificationReport = {
        id: 'backup-1',
        passed: true,
        hashMatched: true,
        integrityCheckPassed: true,
        tableCounts: { Client: 10 },
      };
      mockBackupService.verifyBackup.mockResolvedValue(report);

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleVerify('backup-1');
      });

      expect(mockBackupService.verifyBackup).toHaveBeenCalledWith('backup-1');
    });

    it('sets verifyReport with the result', async () => {
      const report: VerificationReport = {
        id: 'backup-1',
        passed: false,
        hashMatched: false,
        integrityCheckPassed: false,
        tableCounts: {},
        error: 'Hash mismatch',
      };
      mockBackupService.verifyBackup.mockResolvedValue(report);

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleVerify('backup-1');
      });

      expect(result.current.verifyReport).toEqual(report);
    });

    it('logs BACKUP_VERIFIED after successful verification', async () => {
      const report: VerificationReport = {
        id: 'backup-1',
        passed: true,
        hashMatched: true,
        integrityCheckPassed: true,
        tableCounts: {},
      };
      mockBackupService.verifyBackup.mockResolvedValue(report);

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleVerify('backup-1');
      });

      expect(mockRecoveryLogService.log).toHaveBeenCalledWith(
        'BACKUP_VERIFIED',
        'admin-1',
        'backup-1',
        expect.objectContaining({ passed: true }),
      );
    });

    it('sets isVerifying back to null after completion', async () => {
      mockBackupService.verifyBackup.mockResolvedValue({
        id: 'backup-1',
        passed: true,
        hashMatched: true,
        integrityCheckPassed: true,
        tableCounts: {},
      });

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleVerify('backup-1');
      });

      expect(result.current.isVerifying).toBeNull();
    });

    it('sets error when verification fails', async () => {
      mockBackupService.verifyBackup.mockRejectedValue(new Error('Corrupt archive'));

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleVerify('backup-1');
      });

      expect(result.current.error).toBe('Corrupt archive');
      expect(result.current.isVerifying).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // handleSelectBackup
  // -----------------------------------------------------------------------

  describe('handleSelectBackup', () => {
    beforeEach(() => {
      mockSessionRef.current = makeAdminSession();
      mockBackupService.listBackups.mockResolvedValue([createBackup()]);
      mockRecoveryLogService.list.mockResolvedValue([]);
      mockGetStartupHealth.mockResolvedValue({ status: 'OK', message: '' });
    });

    it('sets selectedBackup, clears restoreConfirmText and verifyReport', async () => {
      const backup = createBackup();
      mockBackupService.fetchLocalNumberHint.mockResolvedValue(100);

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleSelectBackup(backup);
      });

      expect(result.current.selectedBackup).toEqual(backup);
      expect(result.current.restoreConfirmText).toBe('');
      expect(result.current.verifyReport).toBeNull();
    });

    it('computes gapHint from fetchLocalNumberHint minus maxClientSequence', async () => {
      const backup = createBackup({ maxClientSequence: 42 });
      mockBackupService.fetchLocalNumberHint.mockResolvedValue(100);

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleSelectBackup(backup);
      });

      // gapHint = Math.max(0, 100 - 42) = 58
      expect(result.current.gapHint).toBe(58);
    });

    it('leaves gapHint null when fetchLocalNumberHint throws', async () => {
      mockBackupService.fetchLocalNumberHint.mockRejectedValue(new Error('Offline'));

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleSelectBackup(createBackup());
      });

      // Gap hint stays null when the call fails
      expect(result.current.gapHint).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // handleRestore
  // -----------------------------------------------------------------------

  describe('handleRestore', () => {
    beforeEach(() => {
      mockSessionRef.current = makeAdminSession();
      mockBackupService.listBackups.mockResolvedValue([createBackup()]);
      mockRecoveryLogService.list.mockResolvedValue([]);
      mockGetStartupHealth.mockResolvedValue({ status: 'OK', message: '' });
    });

    it('calls backupService.restoreBackup with selectedBackup.id when confirm text is RESTORE', async () => {
      const backup = createBackup();
      mockBackupService.restoreBackup.mockResolvedValue(undefined);

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      // Select a backup first
      await act(async () => {
        await result.current.handleSelectBackup(backup);
      });

      // Type the confirmation text
      act(() => {
        result.current.setRestoreConfirmText('RESTORE');
      });

      // Execute restore
      await act(async () => {
        await result.current.handleRestore();
      });

      expect(mockBackupService.restoreBackup).toHaveBeenCalledWith(backup.id);
    });

    it('does not call restoreBackup when confirm text is not RESTORE', async () => {
      const backup = createBackup();

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleSelectBackup(backup);
      });

      act(() => {
        result.current.setRestoreConfirmText('restore');
      });

      await act(async () => {
        await result.current.handleRestore();
      });

      expect(mockBackupService.restoreBackup).not.toHaveBeenCalled();
    });

    it('does not call restoreBackup when selectedBackup is null', async () => {
      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setRestoreConfirmText('RESTORE');
      });

      await act(async () => {
        await result.current.handleRestore();
      });

      expect(mockBackupService.restoreBackup).not.toHaveBeenCalled();
    });

    it('logs RESTORE_COMPLETED on successful restore', async () => {
      const backup = createBackup();
      mockBackupService.restoreBackup.mockResolvedValue(undefined);

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleSelectBackup(backup);
      });

      act(() => {
        result.current.setRestoreConfirmText('RESTORE');
      });

      await act(async () => {
        await result.current.handleRestore();
      });

      expect(mockRecoveryLogService.log).toHaveBeenCalledWith(
        'RESTORE_COMPLETED',
        'admin-1',
        backup.id,
      );
    });

    it('sets error and logs RESTORE_ABORTED when restore fails', async () => {
      const backup = createBackup();
      mockBackupService.restoreBackup.mockRejectedValue(new Error('Checksum error'));

      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleSelectBackup(backup);
      });

      act(() => {
        result.current.setRestoreConfirmText('RESTORE');
      });

      await act(async () => {
        await result.current.handleRestore();
      });

      expect(result.current.error).toBe('Checksum error');
      expect(result.current.isRestoring).toBe(false);
      expect(mockRecoveryLogService.log).toHaveBeenCalledWith(
        'RESTORE_ABORTED',
        'admin-1',
        backup.id,
        expect.objectContaining({ error: 'Checksum error' }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // handleCancelRestore
  // -----------------------------------------------------------------------

  describe('handleCancelRestore', () => {
    it('clears selectedBackup, verifyReport, and gapHint', () => {
      const { result } = renderHook(() => useRecoveryPage());

      // Set some restore state
      act(() => {
        result.current.setRestoreConfirmText('RESTORE');
      });

      act(() => {
        result.current.handleCancelRestore();
      });

      expect(result.current.selectedBackup).toBeNull();
      expect(result.current.verifyReport).toBeNull();
      expect(result.current.gapHint).toBeNull();
      expect(result.current.restoreConfirmText).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // handleRefresh
  // -----------------------------------------------------------------------

  describe('handleRefresh', () => {
    beforeEach(() => {
      mockSessionRef.current = makeAdminSession();
      mockBackupService.listBackups.mockResolvedValue([createBackup()]);
      mockRecoveryLogService.list.mockResolvedValue([]);
      mockGetStartupHealth.mockResolvedValue({ status: 'OK', message: '' });
    });

    it('sets loading true and calls loadData', async () => {
      const { result } = renderHook(() => useRecoveryPage());

      await waitFor(() => expect(result.current.loading).toBe(false));

      // Reset the call count from the initial mount
      mockBackupService.listBackups.mockClear();

      await act(async () => {
        await result.current.handleRefresh();
      });

      // loading goes true then false after refresh
      expect(mockBackupService.listBackups).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // Setters
  // -----------------------------------------------------------------------

  describe('setActiveTab', () => {
    it('updates activeTab', () => {
      const { result } = renderHook(() => useRecoveryPage());

      expect(result.current.activeTab).toBe('backups');

      act(() => {
        result.current.setActiveTab('log');
      });

      expect(result.current.activeTab).toBe('log');

      act(() => {
        result.current.setActiveTab('backups');
      });

      expect(result.current.activeTab).toBe('backups');
    });
  });

  describe('setRestoreConfirmText', () => {
    it('updates the confirmation text', () => {
      const { result } = renderHook(() => useRecoveryPage());

      expect(result.current.restoreConfirmText).toBe('');

      act(() => {
        result.current.setRestoreConfirmText('RESTORE');
      });

      expect(result.current.restoreConfirmText).toBe('RESTORE');

      act(() => {
        result.current.setRestoreConfirmText('CANCEL');
      });

      expect(result.current.restoreConfirmText).toBe('CANCEL');
    });
  });
});
