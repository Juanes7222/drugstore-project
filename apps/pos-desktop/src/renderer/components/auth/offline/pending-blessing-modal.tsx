/**
 * Pending blessing modal — shown when there are offline sessions waiting
 * for server confirmation.
 *
 * - Overlay modal with backdrop dim.
 * - Lists each pending session with user info, login time, and status.
 * - Auto-dismisses when all sessions are blessed.
 * - Rejected sessions show specific messages per reason code.
 */

import { type FC, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { useAppSelector } from '@/store/hooks';
import {
  selectConnectionState,
  selectIsBlessingInProgress,
  selectBlessingProgress,
} from '@/store/slices/offline-auth-slice';
import { useOfflineAuth } from '../../../hooks/use-offline-auth';
import { useOfflineSessionStore } from '../../../../domain/auth/offline';
import type { OfflineSession } from '../../../../domain/auth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REJECTION_MESSAGES: Record<string, string> = {
  USER_DISABLED:
    'Tu cuenta fue deshabilitada. Contactá al manager.',
  USER_LOCKED:
    'Tu cuenta fue bloqueada. Contactá al manager.',
  WORKSTATION_REVOKED:
    'Este dispositivo fue deshabilitado. Contactá al operador del SaaS.',
  LOCATION_ACCESS_REVOKED:
    'Tu acceso a esta ubicación fue revocado. Contactá al manager.',
  TOKEN_EXPIRED:
    'Tu sesión offline expiró.',
  TOKEN_SIGNATURE_INVALID:
    'El token de sesión no es válido. Iniciá sesión de nuevo.',
  TOKEN_REVOKED:
    'Tu sesión fue revocada. Iniciá sesión de nuevo.',
  FRAUD_DETECTED:
    'Se detectó actividad sospechosa. Contactá al manager.',
  WORKSTATION_FINGERPRINT_MISMATCH:
    'El dispositivo no coincide con la sesión. Iniciá sesión de nuevo.',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PendingBlessingModal: FC = () => {
  const { t } = useTranslation();
  const connectionState = useAppSelector(selectConnectionState);
  const isBlessingInProgress = useAppSelector(selectIsBlessingInProgress);
  const blessingProgress = useAppSelector(selectBlessingProgress);
  const { triggerBlessing } = useOfflineAuth();

  const sessions = useOfflineSessionStore((s) => s.sessions);

  const [isOpen, setIsOpen] = useState(false);
  const [dismissedRejectedIds, setDismissedRejectedIds] = useState<Set<string>>(new Set());

  // Derive session groupings from the Zustand store
  const pendingSessions = sessions.filter((s) => !s.isBlessed && !s.rejectedAt);
  const rejectedSessions = sessions.filter((s) => s.rejectedAt !== undefined);
  const totalPendingCount = pendingSessions.length;

  // Show modal when there are pending sessions
  useEffect(() => {
    if (totalPendingCount > 0) {
      setIsOpen(true);
    } else if (
      sessions.length > 0 &&
      totalPendingCount === 0 &&
      rejectedSessions.every((s) => dismissedRejectedIds.has(s.localSessionId))
    ) {
      setIsOpen(false);
    }
  }, [totalPendingCount, sessions.length, rejectedSessions, dismissedRejectedIds]);

  // Auto-trigger blessing when modal opens and we're online
  useEffect(() => {
    if (isOpen && totalPendingCount > 0 && connectionState === 'ONLINE') {
      triggerBlessing();
    }
  }, [isOpen, totalPendingCount, connectionState, triggerBlessing]);

  const handleDismissRejected = useCallback((sessionId: string) => {
    setDismissedRejectedIds((prev) => new Set(prev).add(sessionId));
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const allDone =
    totalPendingCount === 0 &&
    rejectedSessions.every((s) => dismissedRejectedIds.has(s.localSessionId));

  // Build a combined list: pending first, then rejected
  const displaySessions: Array<OfflineSession & { _status: 'pending' | 'rejected' }> = [
    ...pendingSessions.map((s) => ({ ...s, _status: 'pending' as const })),
    ...rejectedSessions
      .filter((s) => !dismissedRejectedIds.has(s.localSessionId))
      .map((s) => ({ ...s, _status: 'rejected' as const })),
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          role="dialog"
          aria-modal="true"
          aria-label={t('offline_blessing.title', 'Validando sesiones offline')}
        >
          <motion.div
            className="pos-panel max-w-lg w-full mx-4 p-pos-xl"
            style={{ backgroundColor: 'var(--color-surface)' }}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          >
            {/* Header */}
            <h2
              className="text-heading font-bold mb-1"
              style={{ color: 'var(--color-ink)' }}
            >
              {t('offline_blessing.title', 'Validando sesiones offline')}
            </h2>
            <p
              className="text-body-sm mb-4"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {isBlessingInProgress
                ? t(
                    'offline_blessing.processing',
                    'Verificando sesiones con el servidor…',
                  )
                : totalPendingCount > 0
                  ? t(
                      'offline_blessing.pending_count',
                      {
                        defaultValue: '{{count}} sesión(es) pendiente(s) de validar',
                        count: totalPendingCount,
                      },
                    )
                  : t(
                      'offline_blessing.done',
                      'Todas las sesiones fueron procesadas.',
                    )}
            </p>

            {/* Progress bar */}
            {isBlessingInProgress && (
              <div
                className="w-full h-1.5 rounded-full mb-4 overflow-hidden"
                style={{ backgroundColor: 'var(--color-border)' }}
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: 'var(--color-pharma, #16A34A)' }}
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />
              </div>
            )}

            {/* Blessing progress stats */}
            {blessingProgress.total > 0 && (
              <p
                className="text-xs mb-3"
                style={{ color: 'var(--color-ink-muted)' }}
              >
                {blessingProgress.completed} / {blessingProgress.total}{' '}
                {t('offline_blessing.blessed', 'validadas')}
                {blessingProgress.failed > 0 &&
                  ` — ${blessingProgress.failed} ${t('offline_blessing.failed', 'fallidas')}`}
              </p>
            )}

            {/* Session list */}
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {displaySessions.map((session) => (
                <SessionRow
                  key={session.localSessionId}
                  session={session}
                  onDismissRejected={handleDismissRejected}
                />
              ))}
            </ul>

            {/* Footer */}
            <div className="flex justify-end mt-4">
              {allDone ? (
                <button
                  type="button"
                  onClick={handleClose}
                  className="pos-button pos-button--primary"
                >
                  {t('common.close', 'Cerrar')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClose}
                  className="pos-button pos-button--ghost"
                >
                  {t('common.minimize', 'Minimizar')}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ---------------------------------------------------------------------------
// Session row sub-component
// ---------------------------------------------------------------------------

interface SessionRowProps {
  session: OfflineSession & { _status: 'pending' | 'rejected' };
  onDismissRejected: (sessionId: string) => void;
}

const SessionRow: FC<SessionRowProps> = ({ session, onDismissRejected }) => {
  const { t } = useTranslation();
  const isPending = session._status === 'pending';

  const rejectionMessage = session.rejectionReason
    ? REJECTION_MESSAGES[session.rejectionReason] ??
      t(
        'offline_blessing.rejected_generic',
        'Sesión rechazada: {{reason}}',
        { reason: session.rejectionReason },
      )
    : null;

  return (
    <li
      className="flex items-center gap-3 p-2.5 rounded-lg text-sm"
      style={{
        backgroundColor: isPending
          ? 'var(--color-surface-muted, #F9FAFB)'
          : 'rgba(220, 38, 38, 0.06)',
        borderLeft: `3px solid ${
          isPending
            ? 'var(--color-warning-border, #F59E0B)'
            : 'var(--color-error, #DC2626)'
        }`,
      }}
    >
      {/* Avatar / icon */}
      <span
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
        style={{
          backgroundColor: isPending
            ? 'var(--color-warning-bg, #FEF3C7)'
            : 'rgba(220, 38, 38, 0.12)',
          color: isPending
            ? 'var(--color-warning-text, #92400E)'
            : 'var(--color-error, #DC2626)',
        }}
      >
        {session.displayName.charAt(0).toUpperCase()}
      </span>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate" style={{ color: 'var(--color-ink)' }}>
          {session.displayName}
        </p>
        <p className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
          {session.username} &middot;{' '}
          {new Intl.DateTimeFormat('es-CO', {
            dateStyle: 'short',
            timeStyle: 'short',
          }).format(new Date(session.createdAt))}
        </p>
        {!isPending && rejectionMessage && (
          <p
            className="text-xs mt-1 font-medium"
            style={{ color: 'var(--color-error, #DC2626)' }}
          >
            {rejectionMessage}
          </p>
        )}
      </div>

      {/* Status badge */}
      <span
        className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full"
        style={{
          backgroundColor: isPending
            ? 'var(--color-warning-bg, #FEF3C7)'
            : 'rgba(220, 38, 38, 0.1)',
          color: isPending
            ? 'var(--color-warning-text, #92400E)'
            : 'var(--color-error, #DC2626)',
        }}
      >
        {isPending
          ? t('offline_blessing.pending', 'Pendiente de validación')
          : t('offline_blessing.rejected', 'Rechazada')}
      </span>

      {/* Dismiss rejected */}
      {!isPending && (
        <button
          type="button"
          onClick={() => onDismissRejected(session.localSessionId)}
          className="flex-shrink-0 p-1 rounded hover:opacity-70 transition-opacity"
          aria-label={t('common.dismiss', 'Descartar')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </li>
  );
};
