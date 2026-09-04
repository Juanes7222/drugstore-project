/**
 * Local network management page (manager-facing).
 *
 * Shows the current LAN sync state, discovered peers, sync activity
 * (placeholder), conflicts, and settings.
 *
 * @category Local Sync
 */

import { type FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalSync } from '../../hooks/use-local-sync';
import { PeerStatusCard } from './peer-status-card';
import { HubElectionInfo } from './hub-election-info';
import { LoaderIcon } from "@/components/ui/icons/animated";
import {
  createLocalSyncService,
  type DiagnosticEntry,
  type LocalSyncDebugInfo,
} from '../../services/local-sync/local-sync.service';

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
          <LoaderIcon className="h-4 w-4" />
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

/**
 * Diagnostics panel — polls Rust diagnostics buffer and debug snapshot.
 * Visible in dev and when hub fails, so the operator can copy logs.
 */
const DiagnosticsPanel: FC = () => {
  const [entries, setEntries] = useState<DiagnosticEntry[]>([]);
  const [debug, setDebug] = useState<LocalSyncDebugInfo | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const service = createLocalSyncService();

  const refresh = useCallback(async () => {
    try {
      const [logs, info] = await Promise.all([
        service.getDiagnostics().catch(() => [] as DiagnosticEntry[]),
        service.getDebugInfo().catch(() => null as unknown as LocalSyncDebugInfo),
      ]);
      setEntries(logs.slice(-80).reverse());
      setDebug(info);
    } catch {
      // Tauri not available (browser dev) — silently ignore
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!autoRefresh) return;
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  const handleCopy = useCallback(async () => {
    const text = entries.map((e) => `${e.timestamp} [${e.level}] ${e.target}: ${e.message}`).join('\n');
    const debugText = debug ? `\n--- DEBUG ---\n${JSON.stringify(debug, null, 2)}` : '';
    try {
      await navigator.clipboard.writeText(text + debugText);
    } catch {
      // Fallback: console
      console.log(text + debugText);
    }
  }, [entries, debug]);

  const handleClear = useCallback(async () => {
    try {
      await service.clearDiagnostics();
    } catch {}
    void refresh();
  }, [refresh]);

  return (
    <section className="rounded-lg border bg-white p-4" style={{ borderColor: 'var(--color-border)' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
          Diagnóstico Red Local {debug ? `— ws=${debug.workstationId.slice(0, 8)} hub=${debug.currentHub?.slice(0, 8) ?? 'ninguno'} mdns=${debug.mdnsPeers} file=${debug.filePeers}` : ''}
        </h2>
        <span style={{ color: 'var(--color-accent)' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {debug && (
            <div className="grid grid-cols-2 gap-2 rounded-md bg-zinc-50 p-3 text-xs" style={{ color: 'var(--color-ink)' }}>
              <div><span className="font-medium">workstationId:</span> {debug.workstationId || '—'}</div>
              <div><span className="font-medium">friendlyName:</span> {debug.friendlyName || '—'}</div>
              <div><span className="font-medium">hubEligible:</span> {String(debug.hubEligible)}</div>
              <div><span className="font-medium">isCurrentHub:</span> {String(debug.isCurrentHubFlag)}</div>
              <div><span className="font-medium">hostIp:</span> {debug.hostIp || '—'}:{debug.port}</div>
              <div><span className="font-medium">daemon:</span> {String(debug.daemonAvailable)}</div>
              <div className="col-span-2 truncate"><span className="font-medium">heartbeatDir:</span> {debug.heartbeatDir ?? '—'}</div>
              <div><span className="font-medium">mdnsPeers:</span> {debug.mdnsPeers}</div>
              <div><span className="font-medium">filePeers:</span> {debug.filePeers}</div>
              <div><span className="font-medium">merged:</span> {debug.mergedPeers}</div>
              <div><span className="font-medium">currentHub:</span> {debug.currentHub ?? 'Sin hub'} {debug.hubIsSelf ? '(yo)' : ''}</div>
              <div><span className="font-medium">server:</span> {String(debug.serverRunning)}:{debug.serverPort}</div>
              <div className="col-span-2 truncate"><span className="font-medium">clientHub:</span> {debug.clientHubAddress ?? '—'}</div>
            </div>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={() => void refresh()} className="rounded-md border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--color-border)' }}>Actualizar</button>
            <button type="button" onClick={handleCopy} className="rounded-md border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--color-border)' }}>Copiar</button>
            <button type="button" onClick={handleClear} className="rounded-md border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--color-border)' }}>Limpiar</button>
            <label className="ml-auto flex items-center gap-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              auto
            </label>
          </div>

          <div className="max-h-72 overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100">
            {entries.length === 0 ? (
              <span className="text-zinc-400">Sin logs — abre la app con `cargo tauri dev` y revisa consola si sigue vacío</span>
            ) : (
              entries.map((e, i) => (
                <div key={i} className={e.level === 'ERROR' ? 'text-red-300' : e.level === 'WARN' ? 'text-amber-300' : 'text-zinc-100'}>
                  <span className="text-zinc-500">{e.timestamp.slice(11, 23)}</span> <span className="font-bold">[{e.target}]</span> {e.message}
                </div>
              ))
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
            Busca líneas <code className="text-[11px]">[local_sync]</code> push/pull — ahí ves el relay de ventas.
            Heartbeat y elección ya no saturan este panel.
          </p>
        </div>
      )}
    </section>
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

        {/* Diagnostics — what is being identified and what it does */}
        <DiagnosticsPanel />
      </div>
    </div>
  );
};
