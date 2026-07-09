/**
 * Recovery page wiring container.
 *
 * Role-gated to MANAGER and ADMIN. Owns all backup/restore state and calls
 * the BackupService / RecoveryLogService. The visual markup lives in the
 * presentational component under src/renderer/components/recovery/.
 */

import { type FC, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RoleType } from "@pharmacy/shared-types";
import { useLocalSessionStore } from "../auth/local-session.store";
import {
  useBackupService,
  useRecoveryLogService,
} from "../../renderer/components/common/service-context";
import {
  RecoveryPageView,
  type BackupViewModel,
  type RecoveryHealthStatus,
} from "../../renderer/components/recovery/recovery-page-view";
import type {
  BackupHealthLevel,
  BackupMetadata,
  VerificationReport,
} from "../backup/backup.service";
import type { RecoveryLogEntry } from "../backup/recovery-log.service";
import {
  getStartupHealth,
  acknowledgeCleanStartup,
  reportIntegrityFailure,
  runLocalDatabaseIntegrityCheck,
} from "../../infrastructure/startup-health";
import { getLocalDatabase } from "../../infrastructure/local-database";
import type { PrismaClient } from "@pharmacy/database/local";

const AUTO_REFRESH_MS = 30_000;

export const RecoveryPage: FC = () => {
  const { t } = useTranslation();
  const session = useLocalSessionStore((s) => s.session);
  const backupService = useBackupService();
  const recoveryLogService = useRecoveryLogService();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupMetadata[]>([]);
  const [logEntries, setLogEntries] = useState<RecoveryLogEntry[]>([]);
  const [healthStatus, setHealthStatus] = useState<RecoveryHealthStatus>("HEALTHY");
  const [backupHealth, setBackupHealth] = useState<BackupHealthLevel>("CRITICAL");
  const [selectedBackup, setSelectedBackup] = useState<BackupMetadata | null>(null);
  const [verifyReport, setVerifyReport] = useState<VerificationReport | null>(null);
  const [activeTab, setActiveTab] = useState<"backups" | "log">("backups");
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [isRestoring, setIsRestoring] = useState(false);
  const [isVerifying, setIsVerifying] = useState<string | null>(null);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [gapHint, setGapHint] = useState<number | null>(null);

  const hasAccess = session && session.role === RoleType.ADMIN;

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

      if (startup.status === "INTEGRITY_FAILED") {
        setHealthStatus("INTEGRITY_FAILED");
      } else if (startup.status === "UNHEALTHY_SHUTDOWN") {
        setHealthStatus("UNHEALTHY_SHUTDOWN");
      } else {
        setHealthStatus("HEALTHY");
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [backupService, recoveryLogService]);

  useEffect(() => {
    void loadData();
    const timer = setInterval(() => void loadData(), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadData]);

  // Run an integrity check on mount and clear the sentinel if healthy.
  useEffect(() => {
    if (healthStatus !== "UNHEALTHY_SHUTDOWN") return;

    let cancelled = false;
    (async () => {
      try {
        const { client } = await getLocalDatabase();
        const report = await runLocalDatabaseIntegrityCheck(client);
        if (cancelled) return;
        if (report.passed) {
          await acknowledgeCleanStartup();
          setHealthStatus("HEALTHY");
        } else {
          await reportIntegrityFailure();
          setHealthStatus("INTEGRITY_FAILED");
        }
      } catch (err) {
        if (!cancelled) {
          await reportIntegrityFailure();
          setHealthStatus("INTEGRITY_FAILED");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [healthStatus]);

  const handleCreateBackup = useCallback(async () => {
    if (!session) return;
    setIsCreatingBackup(true);
    try {
      const { prisma } = await getLocalDatabase();
      const [pendingCount, failedCount, maxSeqRow] = await Promise.all([
        (prisma as PrismaClient).syncQueue.count({ where: { status: "PENDING" } }),
        (prisma as PrismaClient).syncQueue.count({ where: { status: "FAILED" } }),
        (prisma as PrismaClient).syncQueue.aggregate({ _max: { clientSequence: true } }),
      ]);
      const metadata = await backupService.createBackup({
        reason: "MANUAL",
        workstationId: session.workstationId,
        dbSchemaVersion: 1,
        pendingCount,
        failedCount,
        maxClientSequence: Number(maxSeqRow._max.clientSequence ?? 0n),
        note: undefined,
      });
      await recoveryLogService.log("BACKUP_CREATED", session.userId, metadata.id);
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
          await recoveryLogService.log("BACKUP_VERIFIED", session.userId, id, {
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

  const handleSelectBackup = useCallback(async (backup: BackupMetadata) => {
    setSelectedBackup(backup);
    setRestoreConfirmText("");
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
  }, [backupService, session]);

  const handleRestore = useCallback(async () => {
    if (!selectedBackup || restoreConfirmText !== "RESTORE" || !session) return;
    setIsRestoring(true);
    try {
      await backupService.restoreBackup(selectedBackup.id);
      await recoveryLogService.log("RESTORE_COMPLETED", session.userId, selectedBackup.id);
      // On success the page reloads; log is written before reload.
    } catch (err) {
      setIsRestoring(false);
      setError(err instanceof Error ? err.message : String(err));
      await recoveryLogService.log("RESTORE_ABORTED", session.userId, selectedBackup.id, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [backupService, recoveryLogService, restoreConfirmText, selectedBackup, session]);

  const handleCancelRestore = useCallback(() => {
    setSelectedBackup(null);
    setRestoreConfirmText("");
    setVerifyReport(null);
    setGapHint(null);
  }, []);

  if (!hasAccess) {
    return (
      <section
        aria-label={t("recovery.title")}
        style={{
          display: "flex",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p>{t("common.insufficient_role")}</p>
      </section>
    );
  }

  const backupViewModels: BackupViewModel[] = backups.map((b) => ({
    ...b,
    ageText: formatAge(b.createdAt),
    isVerifying: isVerifying === b.id,
  }));

  return (
    <RecoveryPageView
      loading={loading}
      error={error}
      healthStatus={healthStatus}
      backupHealth={backupHealth}
      backups={backupViewModels}
      logEntries={logEntries}
      activeTab={activeTab}
      selectedBackup={selectedBackup}
      verifyReport={verifyReport}
      restoreConfirmText={restoreConfirmText}
      isRestoring={isRestoring}
      isCreatingBackup={isCreatingBackup}
      gapHint={gapHint}
      onRefresh={loadData}
      onCreateBackup={handleCreateBackup}
      onVerify={handleVerify}
      onSelectBackup={handleSelectBackup}
      onRestore={handleRestore}
      onCancelRestore={handleCancelRestore}
      onConfirmTextChange={setRestoreConfirmText}
      onTabChange={setActiveTab}
    />
  );
};

function formatAge(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
