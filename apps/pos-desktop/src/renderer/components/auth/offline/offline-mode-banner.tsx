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
import { WifiOffIcon, XIcon } from "@/components/ui/icons";

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
            <WifiOffIcon size={16} strokeWidth={1.2} />
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
            <XIcon size={14} strokeWidth={1.5} />
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
