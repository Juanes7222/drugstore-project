/**
 * Hook that owns all state, effects, and event handlers for the recovery page.
 *
 * Extracted from the monolithic recovery.page.tsx so the logic can be
 * unit-tested without rendering the full dialog tree, and to keep the
 * page component as a thin wiring container.
 */

import { useCallback, useEffect, useState } from 'react';
import { RoleType } from '@pharmacy/shared-types';
import { useLocalSessionStore } from '../../domain/auth/local-session.store';
import {
  useBackupService,
  useRecoveryLogService,
} from '../../renderer/components/common/service-context';
import type {
  BackupHealthLevel,
  BackupMetadata,
  VerificationReport,
} from '../../domain/backup/backup.service';
import type { RecoveryLogEntry } from '../../domain/backup/recovery-log.service';
import type { PrismaClient } from '@pharmacy/database/local';
import { formatAge } from '../../common/format-age';
import {
  getStartupHealth,
  acknowledgeCleanStartup,
  reportIntegrityFailure,
  runLocalDatabaseIntegrityCheck,
} from '../../infrastructure/startup-health';
import { getLocalDatabase } from '../../infrastructure/local-database';
import type { BackupViewModel, RecoveryHealthStatus } from '../../renderer/components/recovery/recovery-page-view';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_REFRESH_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseRecoveryPageReturn {
  /** Whether data is still loading. */
  loading: boolean;
  /** User-visible error message, or null. */
  error: string | null;
  /** List of backups enriched for display. */
  backups: BackupViewModel[];
  /** Recovery audit log entries. */
  logEntries: RecoveryLogEntry[];
  /** Current database health status. */
  healthStatus: RecoveryHealthStatus;
  /** Current backup health level. */
  backupHealth: BackupHealthLevel;
  /** The backup selected for restore (or null). */
  selectedBackup: BackupMetadata | null;
  /** Verification report for the selected backup, or null. */
  verifyReport: VerificationReport | null;
  /** Text typed by the user in the restore confirmation field. */
  restoreConfirmText: string;
  /** Whether a restore operation is in progress. */
  isRestoring: boolean;
  /** ID of the backup currently being verified, or null. */
  isVerifying: string | null;
  /** Whether a backup creation is in progress. */
  isCreatingBackup: boolean;
  /** Number of operations that may be lost on restore, or null. */
  gapHint: number | null;
  /** Currently active tab. */
  activeTab: 'backups' | 'log';
  /** Switch between the backups and log tabs. */
  setActiveTab: (tab: 'backups' | 'log') => void;
  /** Update the restore confirmation text. */
  setRestoreConfirmText: (text: string) => void;
  /** Create a manual backup. */
  handleCreateBackup: () => Promise<void>;
  /** Verify a specific backup by id. */
  handleVerify: (id: string) => Promise<void>;
  /** Select a backup for potential restore. */
  handleSelectBackup: (backup: BackupMetadata) => Promise<void>;
  /** Execute the restore for the selected backup. */
  handleRestore: () => Promise<void>;
  /** Cancel the restore flow and return to the list. */
  handleCancelRestore: () => void;
  /** Re-fetch all data from services. */
  handleRefresh: () => Promise<void>;
  /** Whether the current user has permission to view this page. */
  hasAccess: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRecoveryPage(): UseRecoveryPageReturn {
  const session = useLocalSessionStore((s) => s.session);
  const backupService = useBackupService();
  const recoveryLogService = useRecoveryLogService();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupMetadata[]>([]);
  const [logEntries, setLogEntries] = useState<RecoveryLogEntry[]>([]);
  const [healthStatus, setHealthStatus] = useState<RecoveryHealthStatus>('HEALTHY');
  const [backupHealth, setBackupHealth] = useState<BackupHealthLevel>('CRITICAL');
  const [selectedBackup, setSelectedBackup] = useState<BackupMetadata | null>(null);
  const [verifyReport, setVerifyReport] = useState<VerificationReport | null>(null);
  const [activeTab, setActiveTab] = useState<'backups' | 'log'>('backups');
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [isVerifying, setIsVerifying] = useState<string | null>(null);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [gapHint, setGapHint] = useState<number | null>(null);

  const hasAccess = session !== null && session.role === RoleType.ADMIN;

  // -- Data loading --

  const loadData = useCallback(async () => {
    try {
      const [list, log, health, startup] = await Promise.all([
        backupService.listBackups(),
        recoveryLogService.list(),
        backupService.getBackupHealth(),
        getStartupHealth(),
      ]);
      setBackups(list);
      setLogEntries(log);
      setBackupHealth(health);

      if (startup.status === 'INTEGRITY_FAILED') {
        setHealthStatus('INTEGRITY_FAILED');
      } else if (startup.status === 'UNHEALTHY_SHUTDOWN') {
        setHealthStatus('UNHEALTHY_SHUTDOWN');
      } else {
        setHealthStatus('HEALTHY');
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [backupService, recoveryLogService]);

  // Initial load + periodic auto-refresh
  useEffect(() => {
    void loadData();
    const timer = setInterval(() => void loadData(), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadData]);

  // Integrity check on mount when the previous shutdown was unclean
  useEffect(() => {
    if (healthStatus !== 'UNHEALTHY_SHUTDOWN') return;

    let cancelled = false;
    (async () => {
      try {
        const { client } = await getLocalDatabase();
        const report = await runLocalDatabaseIntegrityCheck(client);
        if (cancelled) return;
        if (report.passed) {
          await acknowledgeCleanStartup();
          setHealthStatus('HEALTHY');
        } else {
          await reportIntegrityFailure();
          setHealthStatus('INTEGRITY_FAILED');
        }
      } catch (err) {
        if (!cancelled) {
          await reportIntegrityFailure();
          setHealthStatus('INTEGRITY_FAILED');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [healthStatus]);

  // -- Handlers --

  const handleCreateBackup = useCallback(async () => {
    if (!session) return;
    setIsCreatingBackup(true);
    try {
      const { prisma } = await getLocalDatabase();
      const [pendingCount, failedCount, maxSeqRow] = await Promise.all([
        (prisma as PrismaClient).syncQueue.count({ where: { status: 'PENDING' } }),
        (prisma as PrismaClient).syncQueue.count({ where: { status: 'FAILED' } }),
        (prisma as PrismaClient).syncQueue.aggregate({ _max: { clientSequence: true } }),
      ]);
      const metadata = await backupService.createBackup({
        reason: 'MANUAL',
        workstationId: session.workstationId,
        dbSchemaVersion: 1,
        pendingCount,
        failedCount,
        maxClientSequence: Number(maxSeqRow._max.clientSequence ?? 0n),
        note: undefined,
      });
      await recoveryLogService.log('BACKUP_CREATED', session.userId, metadata.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreatingBackup(false);
    }
  }, [backupService, loadData, recoveryLogService, session]);

  const handleVerify = useCallback(
    async (id: string) => {
      setIsVerifying(id);
      try {
        const report = await backupService.verifyBackup(id);
        setVerifyReport(report);
        if (session) {
          await recoveryLogService.log('BACKUP_VERIFIED', session.userId, id, {
            passed: report.passed,
            hashMatched: report.hashMatched,
            integrityCheckPassed: report.integrityCheckPassed,
          });
        }
        await loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsVerifying(null);
      }
    },
    [backupService, loadData, recoveryLogService, session],
  );

  const handleSelectBackup = useCallback(
    async (backup: BackupMetadata) => {
      setSelectedBackup(backup);
      setRestoreConfirmText('');
      setVerifyReport(null);
      setGapHint(null);
      if (!session) return;
      try {
        const hint = await backupService.fetchLocalNumberHint(
          backup.workstationId,
          session.accessToken,
        );
        if (hint != null) {
          setGapHint(Math.max(0, hint - backup.maxClientSequence));
        }
      } catch {
        // Gap hint is advisory; offline/unreachable is handled by the UI.
      }
    },
    [backupService, session],
  );

  const handleRestore = useCallback(async () => {
    if (!selectedBackup || restoreConfirmText !== 'RESTORE' || !session) return;
    setIsRestoring(true);
    try {
      await backupService.restoreBackup(selectedBackup.id);
      await recoveryLogService.log('RESTORE_COMPLETED', session.userId, selectedBackup.id);
      // On success the page reloads; log is written before reload.
    } catch (err) {
      setIsRestoring(false);
      setError(err instanceof Error ? err.message : String(err));
      await recoveryLogService.log('RESTORE_ABORTED', session.userId, selectedBackup.id, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [backupService, recoveryLogService, restoreConfirmText, selectedBackup, session]);

  const handleCancelRestore = useCallback(() => {
    setSelectedBackup(null);
    setRestoreConfirmText('');
    setVerifyReport(null);
    setGapHint(null);
  }, []);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    await loadData();
  }, [loadData]);

  // Derive BackupViewModels for the presentational component
  const backupViewModels: BackupViewModel[] = backups.map((b) => ({
    ...b,
    ageText: formatAge(b.createdAt),
    isVerifying: isVerifying === b.id,
  }));

  return {
    loading,
    error,
    backups: backupViewModels,
    logEntries,
    healthStatus,
    backupHealth,
    selectedBackup,
    verifyReport,
    restoreConfirmText,
    isRestoring,
    isVerifying,
    isCreatingBackup,
    gapHint,
    activeTab,
    setActiveTab,
    setRestoreConfirmText,
    handleCreateBackup,
    handleVerify,
    handleSelectBackup,
    handleRestore,
    handleCancelRestore,
    handleRefresh,
    hasAccess,
  };
}
