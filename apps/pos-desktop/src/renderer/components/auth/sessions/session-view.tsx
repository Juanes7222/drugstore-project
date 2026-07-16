/**
 * Session management view — shows all active sessions (online and offline).
 *
 * Manager-level view for monitoring and managing offline sessions that
 * are pending server blessing or have been rejected.
 */

import { type FC, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  selectConnectionState,
  selectIsBlessingInProgress,
} from '@/store/slices/offline-auth-slice';
import { setActiveScreen } from '@/store/slices/ui-slice';
import { useOfflineAuth } from '../../../hooks/use-offline-auth';
import { useLocalSessionStore } from '../../../../domain/auth';
import { useOfflineSessionStore } from '../../../../domain/auth/offline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionFilter = 'all' | 'online' | 'offline-pending' | 'offline-blessed' | 'offline-rejected';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SessionView: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const currentSession = useLocalSessionStore((s) => s.session);
  const connectionState = useAppSelector(selectConnectionState);
  const isBlessingInProgress = useAppSelector(selectIsBlessingInProgress);
  const { triggerBlessing } = useOfflineAuth();

  const offlineSessions = useOfflineSessionStore((s) => s.sessions);

  const [filter, setFilter] = useState<SessionFilter>('all');
  const [showOfflineOnly, setShowOfflineOnly] = useState(false);

  // Build online sessions list from the local session store
  const onlineSessions = useMemo(() => {
    if (!currentSession) return [];
    return [
      {
        id: 'current-online',
        type: 'online' as const,
        displayName: currentSession.fullName,
        username: currentSession.username,
        role: currentSession.role,
        createdAt: currentSession.expiresAt
          ? new Date(currentSession.expiresAt).toISOString()
          : new Date().toISOString(),
        isCurrent: true,
      },
    ];
  }, [currentSession]);

  // Offline sessions mapped to display format
  const mappedOfflineSessions = useMemo(
    () =>
      offlineSessions.map((s) => ({
        id: s.localSessionId,
        type: (s.isBlessed
          ? 'offline-blessed'
          : s.rejectedAt
            ? 'offline-rejected'
            : 'offline-pending') as
          | 'offline-pending'
          | 'offline-blessed'
          | 'offline-rejected',
        displayName: s.displayName,
        username: s.username,
        role: s.role,
        createdAt: s.createdAt.toISOString(),
        rejectionReason: s.rejectionReason,
      })),
    [offlineSessions],
  );

  const allSessions = useMemo(
    () => [...onlineSessions, ...mappedOfflineSessions],
    [onlineSessions, mappedOfflineSessions],
  );

  const filteredSessions = useMemo(() => {
    if (showOfflineOnly) {
      return allSessions.filter((s) => s.type !== 'online');
    }
    if (filter === 'all') return allSessions;
    if (filter === 'online') return allSessions.filter((s) => s.type === 'online');
    return allSessions.filter((s) => s.type === filter);
  }, [allSessions, filter, showOfflineOnly]);

  const totalPendingCount = useMemo(
    () => offlineSessions.filter((s) => !s.isBlessed && !s.rejectedAt).length,
    [offlineSessions],
  );

  const handleBack = useCallback(() => {
    dispatch(setActiveScreen('admin-menu'));
  }, [dispatch]);

  const handleRevalidate = useCallback(() => {
    triggerBlessing();
  }, [triggerBlessing]);

  // Check if all sessions for a user are offline-only
  const hasOfflineOnlyUser = useMemo(
    () => offlineSessions.length > 0,
    [offlineSessions],
  );

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="p-1.5 rounded-md hover:opacity-70 transition-opacity"
            aria-label={t('common.back', 'Volver')}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 4l-6 6 6 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h1
            className="text-heading font-bold"
            style={{ color: 'var(--color-ink)' }}
          >
            {t('session_view.title', 'Sesiones activas')}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {totalPendingCount > 0 && (
            <button
              type="button"
              onClick={handleRevalidate}
              disabled={isBlessingInProgress}
              className="pos-button pos-button--secondary text-sm"
            >
              {isBlessingInProgress
                ? t('session_view.revalidating', 'Revalidando…')
                : t('session_view.revalidate', 'Revalidar pendientes')}
            </button>
          )}
          <span
            className="text-xs"
            style={{ color: 'var(--color-ink-muted)' }}
          >
            {connectionState === 'OFFLINE'
              ? t('session_view.status_offline', 'Sin conexión')
              : connectionState === 'RECONNECTING'
                ? t('session_view.status_reconnecting', 'Reconectando…')
                : t('session_view.status_online', 'Online')}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b text-sm"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-ink-muted)' }}
      >
        <span>{t('session_view.filter', 'Filtrar:')}</span>
        {(['all', 'online', 'offline-pending', 'offline-blessed', 'offline-rejected'] as const).map(
          (f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="px-2 py-1 rounded transition-colors"
              style={{
                backgroundColor:
                  filter === f ? 'var(--color-primary-container, #E0E7FF)' : 'transparent',
                color:
                  filter === f
                    ? 'var(--color-primary, #4F46E5)'
                    : 'var(--color-ink-muted)',
                fontWeight: filter === f ? 600 : 400,
              }}
            >
              {filterLabel(f, t)}
            </button>
          ),
        )}

        <label className="flex items-center gap-1.5 ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={showOfflineOnly}
            onChange={(e) => setShowOfflineOnly(e.target.checked)}
            className="rounded"
          />
          {t('session_view.offline_only', 'Solo offline')}
        </label>
      </div>

      {/* Offline-only warning */}
      {hasOfflineOnlyUser && !showOfflineOnly && (
        <div
          className="mx-4 mt-3 px-3 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: 'var(--color-warning-bg, #FEF3C7)',
            color: 'var(--color-warning-text, #92400E)',
          }}
        >
          {t(
            'session_view.offline_only_warning',
            'Hay sesiones offline pendientes. Asegurate de validar la conexión.',
          )}
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {filteredSessions.length === 0 ? (
          <div
            className="flex items-center justify-center h-full text-sm"
            style={{ color: 'var(--color-ink-muted)' }}
          >
            {t('session_view.no_sessions', 'No hay sesiones para mostrar.')}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SessionCardData {
  id: string;
  type:
    | 'online'
    | 'offline-pending'
    | 'offline-blessed'
    | 'offline-rejected';
  displayName: string;
  username: string;
  role: string;
  createdAt: string;
  rejectionReason?: string;
}

interface SessionCardProps {
  session: SessionCardData;
}

const SessionCard: FC<SessionCardProps> = ({ session }) => {
  const { t } = useTranslation();

  const statusConfig = (() => {
    switch (session.type) {
      case 'online':
        return {
          label: t('session_view.status_online', 'Online'),
          bgColor: 'rgba(22, 163, 74, 0.08)',
          textColor: '#16A34A',
          borderColor: '#16A34A',
        };
      case 'offline-pending':
        return {
          label: t('session_view.status_offline_pending', 'Offline (pendiente de validar)'),
          bgColor: 'var(--color-warning-bg, #FEF3C7)',
          textColor: 'var(--color-warning-text, #92400E)',
          borderColor: 'var(--color-warning-border, #F59E0B)',
        };
      case 'offline-blessed':
        return {
          label: t('session_view.status_offline_blessed', 'Offline (validada)'),
          bgColor: 'rgba(22, 163, 74, 0.06)',
          textColor: '#16A34A',
          borderColor: '#16A34A',
        };
      case 'offline-rejected':
        return {
          label: t('session_view.status_offline_rejected', 'Offline (rechazada)'),
          bgColor: 'rgba(220, 38, 38, 0.06)',
          textColor: '#DC2626',
          borderColor: '#DC2626',
        };
    }
  })();

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg"
      style={{
        backgroundColor: statusConfig.bgColor,
        borderLeft: `3px solid ${statusConfig.borderColor}`,
      }}
    >
      {/* Avatar */}
      <span
        className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
        style={{
          backgroundColor: statusConfig.bgColor,
          color: statusConfig.textColor,
        }}
      >
        {session.displayName.charAt(0).toUpperCase()}
      </span>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm" style={{ color: 'var(--color-ink)' }}>
          {session.displayName}
        </p>
        <p className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
          {session.username} &middot; {session.role}
        </p>
      </div>

      <div className="text-right text-xs" style={{ color: 'var(--color-ink-muted)' }}>
        <p>
          {new Intl.DateTimeFormat('es-CO', {
            dateStyle: 'short',
            timeStyle: 'short',
          }).format(new Date(session.createdAt))}
        </p>
      </div>

      <span
        className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full"
        style={{
          backgroundColor: statusConfig.bgColor,
          color: statusConfig.textColor,
        }}
      >
        {statusConfig.label}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterLabel(
  filter: SessionFilter,
  translate: (key: string, fallback: string) => string,
): string {
  switch (filter) {
    case 'all':
      return translate('session_view.filter_all', 'Todas');
    case 'online':
      return translate('session_view.filter_online', 'Online');
    case 'offline-pending':
      return translate('session_view.filter_pending', 'Pendientes');
    case 'offline-blessed':
      return translate('session_view.filter_blessed', 'Validadas');
    case 'offline-rejected':
      return translate('session_view.filter_rejected', 'Rechazadas');
  }
}
