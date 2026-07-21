/**
 * Local network management page (manager-facing).
 *
 * Shows the current LAN sync state, discovered peers, sync activity
 * (placeholder), conflicts, and settings.
 *
 * @category Local Sync
 */

import { type FC, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalSync } from '../../hooks/use-local-sync';
import { PeerStatusCard } from './peer-status-card';
import { HubElectionInfo } from './hub-election-info';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Current-hub indicator section.
 */
const HubIndicator: FC<{ hubName: string | null; isLoading: boolean; onForceSync: () => void }> = ({
  hubName,
  isLoading,
  onForceSync,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between rounded-lg border bg-white px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
          {t('local_sync.current_hub')}:
        </span>
        <span style={{ color: 'var(--color-ink)' }}>
          {hubName ?? (
            <span style={{ color: 'var(--color-ink-muted)' }}>
              {t('local_sync.current_hub_none')}
            </span>
          )}
        </span>
      </div>

      <button
        type="button"
        onClick={onForceSync}
        disabled={isLoading}
        className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          backgroundColor: 'var(--color-accent)',
          color: '#fff',
        }}
        onMouseEnter={(e) => {
          if (!isLoading) e.currentTarget.style.opacity = '0.9';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '1';
        }}
      >
        {isLoading && (
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        )}
        {isLoading ? t('local_sync.force_sync_running') : t('local_sync.force_sync')}
      </button>
    </div>
  );
};

/**
 * Empty state for the peer list.
 */
const PeersEmptyState: FC = () => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-10" style={{ borderColor: 'var(--color-border)' }}>
      <p className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
        {t('local_sync.peers_empty')}
      </p>
      <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
        {t('local_sync.peers_empty_action')}
      </p>
    </div>
  );
};

/**
 * Conflict item row.
 */
const ConflictRow: FC<{ operationUuid: string; reason: string; winningOperationUuid: string }> = ({
  operationUuid,
  reason,
  winningOperationUuid,
}) => {
  const { t } = useTranslation();

  return (
    <div className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between">
        <span className="font-medium" style={{ color: 'var(--color-ink)' }}>
          {t('local_sync.conflict_operation', { uuid: operationUuid.slice(0, 8) })}
        </span>
      </div>
      <p className="mt-0.5" style={{ color: 'var(--color-ink-muted)' }}>
        {t('local_sync.conflict_reason', { reason })}
      </p>
      <p className="mt-0.5" style={{ color: 'var(--color-ink-muted)' }}>
        {t('local_sync.conflict_winner', { uuid: winningOperationUuid.slice(0, 8) })}
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export const LocalNetworkPage: FC = () => {
  const { t } = useTranslation();

  const {
    peers,
    currentHub,
    hubOverride,
    hubScores,
    conflicts,
    isLoading,
    forceSync,
    setHubOverride,
  } = useLocalSync();

  const [showElectionInfo, setShowElectionInfo] = useState(false);

  const handleMakeHub = useCallback(
    (workstationId: string) => {
      void setHubOverride(workstationId);
    },
    [setHubOverride],
  );

  const handleRemovePeer = useCallback(
    (workstationId: string) => {
      // Placeholder — remove from local network.
      // Future: dispatch a service call to blacklist the peer.
      console.warn('Remove peer not yet implemented:', workstationId);
    },
    [],
  );

  const handleHubOverrideChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      void setHubOverride(value === '__auto__' ? null : value);
    },
    [setHubOverride],
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto" style={{ backgroundColor: 'var(--color-surface)' }}>
      <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-6">
        {/* Page header */}
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--color-ink)' }}>
            {t('local_sync.page_title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
            {t('local_sync.page_description')}
          </p>
        </div>

        {/* Hub indicator + Force sync */}
        <HubIndicator
          hubName={currentHub?.friendlyName ?? null}
          isLoading={isLoading}
          onForceSync={() => void forceSync()}
        />

        {/* Discovered peers */}
        <section>
          <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            {t('local_sync.peers_title')} ({peers.length})
          </h2>

          {peers.length === 0 ? (
            <PeersEmptyState />
          ) : (
            <div className="space-y-2">
              {peers.map((peer) => (
                <PeerStatusCard
                  key={peer.workstationId}
                  peer={peer}
                  isCurrentHub={peer.workstationId === currentHub?.workstationId}
                  onMakeHub={handleMakeHub}
                  onRemove={handleRemovePeer}
                  showActions
                />
              ))}
            </div>
          )}
        </section>

        {/* Hub election scores (collapsible) */}
        {hubScores.length > 0 && (
          <section>
            <button
              type="button"
              onClick={() => setShowElectionInfo((prev) => !prev)}
              className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-70"
              style={{ color: 'var(--color-accent)' }}
            >
              <span
                className="inline-block transition-transform"
                style={{ transform: showElectionInfo ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                ▶
              </span>
              {t('local_sync.hub_scores_title')}
            </button>

            {showElectionInfo && (
              <HubElectionInfo scores={hubScores} currentHubId={currentHub?.workstationId ?? null} />
            )}
          </section>
        )}

        {/* Sync activity log (placeholder) */}
        <section>
          <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            {t('local_sync.activity_log')}
          </h2>
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              {t('local_sync.activity_empty')}
            </p>
          </div>
        </section>

        {/* Conflicts */}
        <section>
          <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            {t('local_sync.conflicts_title')} ({conflicts.length})
          </h2>

          {conflicts.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              {t('local_sync.conflicts_empty')}
            </p>
          ) : (
            <div className="space-y-2">
              {conflicts.map((conflict) => (
                <ConflictRow
                  key={conflict.operationUuid}
                  operationUuid={conflict.operationUuid}
                  reason={conflict.reason}
                  winningOperationUuid={conflict.winningOperationUuid}
                />
              ))}
            </div>
          )}
        </section>

        {/* Settings */}
        <section className="rounded-lg border bg-white p-4" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="mb-4 text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            {t('local_sync.settings_title')}
          </h2>

          {/* Hub override selector */}
          <div className="mb-4">
            <label
              htmlFor="hub-override-select"
              className="mb-1.5 block text-xs font-medium"
              style={{ color: 'var(--color-ink)' }}
            >
              {t('local_sync.hub_override')}
            </label>
            <select
              id="hub-override-select"
              value={hubOverride ?? '__auto__'}
              onChange={handleHubOverrideChange}
              className="block w-full max-w-xs rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: '#fff',
                color: 'var(--color-ink)',
              }}
            >
              <option value="__auto__">{t('local_sync.hub_override_none')}</option>
              {peers
                .filter((p) => p.hubEligible)
                .map((p) => (
                  <option key={p.workstationId} value={p.workstationId}>
                    {p.friendlyName} ({p.ipAddress})
                  </option>
                ))}
            </select>
          </div>

          {/* Key rotation button (placeholder) */}
          <button
            type="button"
            onClick={() => {
              // Placeholder for key rotation — wire later.
              const confirmed = window.confirm(t('local_sync.settings_key_rotation_confirm'));
              if (confirmed) {
                console.warn('Key rotation not yet implemented');
              }
            }}
            className="rounded-md px-4 py-2 text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
              color: 'var(--color-accent)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-accent) 18%, transparent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-accent) 10%, transparent)';
            }}
          >
            {t('local_sync.settings_key_rotation')}
          </button>
        </section>
      </div>
    </div>
  );
};
