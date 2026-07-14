/**
 * Recovery page — thin wiring container.
 *
 * Role-gated to MANAGER and ADMIN. Delegates all state and effects to
 * useRecoveryPage, passes the result to the presentational RecoveryPageView.
 */

import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useRecoveryPage } from '../../hooks/use-recovery-page';
import { RecoveryPageView } from './recovery-page-view';

export const RecoveryPage: FC = () => {
  const { t } = useTranslation();
  const {
    loading,
    error,
    backups,
    logEntries,
    healthStatus,
    backupHealth,
    selectedBackup,
    verifyReport,
    restoreConfirmText,
    isRestoring,
    isCreatingBackup,
    gapHint,
    activeTab,
    hasAccess,
    setActiveTab,
    setRestoreConfirmText,
    handleCreateBackup,
    handleVerify,
    handleSelectBackup,
    handleRestore,
    handleCancelRestore,
    handleRefresh,
  } = useRecoveryPage();

  if (!hasAccess) {
    return (
      <section
        aria-label={t('recovery.title')}
        style={{
          display: 'flex',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <p>{t('common.insufficient_role')}</p>
      </section>
    );
  }

  return (
    <RecoveryPageView
      loading={loading}
      error={error}
      healthStatus={healthStatus}
      backupHealth={backupHealth}
      backups={backups}
      logEntries={logEntries}
      activeTab={activeTab}
      selectedBackup={selectedBackup}
      verifyReport={verifyReport}
      restoreConfirmText={restoreConfirmText}
      isRestoring={isRestoring}
      isCreatingBackup={isCreatingBackup}
      gapHint={gapHint}
      onRefresh={handleRefresh}
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
