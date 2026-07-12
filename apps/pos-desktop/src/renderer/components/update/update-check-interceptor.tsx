/**
 * Update-check interceptor.
 *
 * Runs at startup (after auth check completes) to:
 * 1. Check the rollback detector for crash detection.
 * 2. Check for updates via the server.
 * 3. Show the appropriate UX (toast for OPTIONAL/HOTFIX, modal for
 *    CRITICAL/MANDATORY, progress overlay during install).
 *
 * Mounted as a sibling to the main screen router inside InnerApp so it has
 * access to the service context and Redux store.
 *
 * This component manages the full lifecycle: check → notify → download →
 * install → restart.
 */

import { type FC, useEffect, useState, useCallback, useRef } from 'react';
import { useUpdateService } from '../common/service-context';
import { useUpdateStore } from '../../../domain/updates/update.store';
import { getLocalDatabase } from '../../../infrastructure/local-database';
import { isOnline } from '../../../common/is-online';
import { UpdateToast } from './update-toast';
import { UpdateModal } from './update-modal';
import { UpdateProgress } from './update-progress';
import { UpdateType } from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const UpdateCheckInterceptor: FC = () => {
  const updateService = useUpdateService();

  // Store state
  const storeState = useUpdateStore();

  // UI state
  const [showToast, setShowToast] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [toastVersion, setToastVersion] = useState('');
  const [toastType, setToastType] = useState<string>('OPTIONAL');
  const [modalVersion, setModalVersion] = useState('');
  const [modalType, setModalType] = useState<string>('MANDATORY');
  const [modalReleaseNotes, setModalReleaseNotes] = useState<string | undefined>();
  const [modalMandatoryFrom, setModalMandatoryFrom] = useState<string | undefined>();

  // Progress state
  const [progressVersion, setProgressVersion] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressPhase, setProgressPhase] = useState<
    'downloading' | 'verifying' | 'installing' | 'migrating' | 'restarting'
  >('downloading');
  const [progressEta, setProgressEta] = useState<number | null>(null);
  const [progressSpeed, setProgressSpeed] = useState<string | undefined>();
  const [progressError, setProgressError] = useState<string | undefined>();

  const initialCheckDone = useRef(false);
  const downloadUnsubscribeRef = useRef<(() => void) | null>(null);

  // Subscribe to state machine transitions
  useEffect(() => {
    const unsub = updateService.stateMachine.onTransition((newState) => {
      storeState.setStateMachineState(newState);
    });
    return unsub;
  }, [updateService, storeState]);

  // Startup: rollback check + update check
  useEffect(() => {
    if (initialCheckDone.current) return;
    initialCheckDone.current = true;

    (async () => {
      try {
        // 1. Check for rollback on startup
        const rollbackResult = await updateService.checkStartupRollback();
        if (rollbackResult.needsRollback) {
          console.warn(
            '[update-interceptor] Rollback detected:',
            rollbackResult.reason,
          );
          // The onRollbackRecommended callback in UpdateService handles this.
          return;
        }

        // 2. Wait a moment for auth to finish, then check for updates
        // (APP_START trigger)
        await new Promise((resolve) => setTimeout(resolve, 3000));

        if (!isOnline()) return;

        // Check the user's last dismissed version
        const storeStateSnapshot = useUpdateStore.getState();
        const result = await updateService.checkForUpdate('APP_START');

        if (
          result.updateAvailable &&
          result.version &&
          result.version !== storeStateSnapshot.userDismissedVersion
        ) {
          const updateType = result.updateType ?? UpdateType.OPTIONAL;

          // Update the store with latest available info
          const { prisma } = await getLocalDatabase();
          await useUpdateStore.getState().updateAndPersist(prisma as any, {
            lastAvailableVersion: result.version,
            lastAvailableType: updateType,
            lastAvailableChangelog: result.releaseNotes ?? null,
            lastCheckAt: new Date().toISOString(),
          });

          // Show appropriate UX
          if (updateType === UpdateType.CRITICAL || updateType === UpdateType.MANDATORY) {
            setModalVersion(result.version);
            setModalType(updateType);
            setModalReleaseNotes(result.releaseNotes);
            setModalMandatoryFrom(result.mandatoryFrom);
            setShowModal(true);
          } else {
            // OPTIONAL or HOTFIX
            setToastVersion(result.version);
            setToastType(updateType);
            setShowToast(true);
          }
        }
      } catch {
        // Silent failure on startup check — will retry on next periodic cycle.
      }
    })();
  }, [updateService, storeState]);

  // Cleanup download subscriptions
  useEffect(() => {
    return () => {
      downloadUnsubscribeRef.current?.();
    };
  }, []);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleInstallNow = useCallback(async () => {
    setShowModal(false);
    setShowToast(false);
    setShowProgress(true);
    setProgressError(undefined);

    const storeSnapshot = useUpdateStore.getState();
    const version = storeSnapshot.lastAvailableVersion ?? '';

    setProgressVersion(version);
    setProgressPhase('downloading');

    try {
      // Step 1: Download
      const downloadPromise = updateService.startDownload();

      // Wire progress updates
      const unsub = updateService.stateMachine.onTransition((state) => {
        if (state === 'DOWNLOADING') {
          setProgressPhase('downloading');
        }
      });
      downloadUnsubscribeRef.current = unsub;

      // Poll for progress
      const progressInterval = setInterval(() => {
        const progress = updateService.downloadProgress;
        if (progress) {
          setProgressPercent(progress.percent);
          const speedMb = progress.bytesPerSecond / (1024 * 1024);
          setProgressSpeed(
            speedMb >= 1
              ? `${speedMb.toFixed(1)} MB/s`
              : `${Math.round(progress.bytesPerSecond / 1024)} KB/s`,
          );
          setProgressEta(
            progress.etaMs !== Infinity
              ? Math.round(progress.etaMs / 1000)
              : null,
          );
        }
      }, 500);

      try {
        await downloadPromise;
        clearInterval(progressInterval);

        // Step 2: Install
        setProgressPhase('verifying');
        await new Promise((resolve) => setTimeout(resolve, 500));

        setProgressPhase('installing');
        setProgressPercent(0);

        const report = await updateService.installUpdate();

        if (report.success) {
          setProgressPhase('restarting');
          setProgressPercent(100);

          // The app will restart — nothing more to do here.
        }
      } catch (err) {
        clearInterval(progressInterval);
        setProgressError(
          err instanceof Error ? err.message : 'Installation failed',
        );
        setProgressPhase('downloading'); // Keep showing progress with error
      }
    } catch (err) {
      setProgressError(
        err instanceof Error ? err.message : 'Download failed',
      );
    }
  }, [updateService]);

  const handleDismissToast = useCallback(() => {
    setShowToast(false);
  }, []);

  const handleViewDetails = useCallback(() => {
    setShowToast(false);
    const storeSnapshot = useUpdateStore.getState();
    if (storeSnapshot.lastAvailableVersion) {
      setModalVersion(storeSnapshot.lastAvailableVersion);
      setModalType(storeSnapshot.lastAvailableType ?? 'OPTIONAL');
      setModalReleaseNotes(storeSnapshot.lastAvailableChangelog ?? undefined);
      setShowModal(true);
    }
  }, []);

  const handleRemindLater = useCallback(async () => {
    setShowModal(false);
    // The periodic checker will show the modal again after 4 hours.
    // No special handling needed — the minIntervalMs for PERIODIC checks is 6h.
  }, []);

  const handleDismissModal = useCallback(
    async (version: string) => {
      storeState.dismissVersion(version);
      const { prisma } = await getLocalDatabase();
      await storeState.persistToDb(prisma as any);
      setShowModal(false);
    },
    [storeState],
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <>
      {/* Toast for OPTIONAL / HOTFIX updates */}
      {showToast && (
        <UpdateToast
          version={toastVersion}
          updateType={toastType}
          onViewDetails={handleViewDetails}
          onDismiss={handleDismissToast}
        />
      )}

      {/* Modal for CRITICAL / MANDATORY updates */}
      {showModal && (
        <UpdateModal
          open={showModal}
          onOpenChange={(open) => {
            if (!open && modalType !== 'CRITICAL') {
              handleDismissModal(modalVersion);
            }
          }}
          version={modalVersion}
          updateType={modalType}
          releaseNotes={modalReleaseNotes}
          mandatoryFrom={modalMandatoryFrom}
          onInstallNow={handleInstallNow}
          onRemindLater={modalType === 'MANDATORY' ? handleRemindLater : undefined}
        />
      )}

      {/* Full-screen progress overlay during install */}
      <UpdateProgress
        visible={showProgress}
        version={progressVersion}
        progressPercent={progressPercent}
        phase={progressPhase}
        etaSeconds={progressEta ?? undefined}
        speed={progressSpeed}
        errorMessage={progressError}
      />
    </>
  );
};
