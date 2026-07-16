/**
 * Offline mode banner — persistent amber bar shown when the app is operating
 * without server connectivity.
 *
 * - Amber/yellow background, full width, sticky to top of viewport.
 * - Shows a spinner when transitioning back to online (RECONNECTING).
 * - Dismissible only by MANAGER or OWNER role.
 * - Text conveys that offline is a normal operating mode, not an error.
 */

import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { useAppSelector } from '@/store/hooks';
import { selectConnectionState } from '@/store/slices/offline-auth-slice';
import { useLocalSessionStore, hasMinRole } from '../../../../domain/auth';
import { RoleType } from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const OfflineModeBanner: FC = () => {
  const { t } = useTranslation();
  const connectionState = useAppSelector(selectConnectionState);
  const session = useLocalSessionStore((s) => s.session);

  // Determine if user can dismiss — only MANAGER or above
  const canDismiss = session
    ? hasMinRole(session, RoleType.MANAGER)
    : false;

  const [dismissed, setDismissed] = useState(false);

  const isOffline = connectionState !== 'ONLINE';
  const isReconnecting = connectionState === 'RECONNECTING';

  if (!isOffline || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        role="status"
        aria-live="polite"
        className="sticky top-0 z-40 w-full px-4 py-2 text-sm font-medium flex items-center gap-3"
        style={{
          backgroundColor: 'var(--color-offline-bg, #FEF3C7)',
          color: 'var(--color-warning-text, #92400E)',
          borderBottom: '1px solid var(--color-warning-border, #F59E0B)',
        }}
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
      >
        {/* Icon / spinner area */}
        <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5">
          {isReconnecting ? (
            <motion.span
              className="inline-block w-3 h-3 rounded-full border-2"
              style={{
                borderColor: 'var(--color-warning-text, #92400E)',
                borderTopColor: 'transparent',
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
            />
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M1 10.5a5 5 0 0 1 7.5-4.3m-3 8.3A5 5 0 0 1 8 3c2.1 0 3.9 1.3 4.7 3.1M13 13a3 3 0 1 0-6 0m6 0a3 3 0 0 0-6 0m6 0h3m-9 0H1"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>

        {/* Message */}
        <span className="flex-1 text-left">
          {isReconnecting
            ? t('offline_banner.reconnecting', 'Reconectando al servidor…')
            : t(
                'offline_banner.message',
                'Sin conexión — modo offline. Las ventas y operaciones funcionan normal. Algunas funciones requieren conexión.',
              )}
        </span>

        {/* Dismiss (manager+) */}
        {canDismiss && !isReconnecting && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full hover:opacity-70 transition-opacity"
            aria-label={t('offline_banner.dismiss', 'Descartar')}
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
      </motion.div>
    </AnimatePresence>
  );
};
