/**
 * Update-toast — Non-blocking notification for OPTIONAL / HOTFIX updates.
 *
 * Shows a brief message when an update is available but does not require
 * immediate action. The update will be installed on next app close if
 * `installOnClose` is enabled.
 *
 * Behaviour per update type:
 * - OPTIONAL: "Actualización v{version} disponible. Se instalará al cerrar
 *   la app. [Ver detalles] [Ahora no]"
 * - HOTFIX: Same layout but with HOTFIX badge.
 */

import { type FC, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateToastProps {
  /** The available version string. */
  version: string;
  /** Update type (OPTIONAL or HOTFIX). */
  updateType?: 'OPTIONAL' | 'HOTFIX' | string;
  /** Called when user clicks "Ver detalles". */
  onViewDetails?: () => void;
  /** Called when user clicks "Ahora no". */
  onDismiss?: () => void;
  /** Auto-dismiss timeout in ms (default: 8000). */
  autoDismissMs?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const UpdateToast: FC<UpdateToastProps> = ({
  version,
  updateType = 'OPTIONAL',
  onViewDetails,
  onDismiss,
  autoDismissMs = 8000,
}) => {
  const { t } = useTranslation();
  const [exiting, setExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      onDismiss?.();
    }, 300); // Match CSS exit animation duration
  }, [onDismiss]);

  // Auto-dismiss
  useState(() => {
    if (autoDismissMs > 0) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, autoDismissMs);
      return () => clearTimeout(timer);
    }
  });

  const isHotfix = updateType === 'HOTFIX';

  return (
    <div
      className={`
        pos-toast pointer-events-auto fixed bottom-4 right-4 z-50
        max-w-sm rounded-lg border p-4 shadow-lg
        ${exiting ? 'pos-toast--exiting' : ''}
      `}
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: isHotfix
          ? 'var(--color-urgency, #dc2626)'
          : 'var(--color-pharma, #2563eb)',
        borderLeftWidth: '4px',
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <span
          className="mt-0.5 flex-shrink-0 text-lg"
          aria-hidden="true"
        >
          {isHotfix ? '⚡' : '📦'}
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold"
            style={{ color: 'var(--color-ink)' }}
          >
            {isHotfix
              ? t('update.toast.hotfix_available', { version })
              : t('update.toast.optional_available', { version })}
          </p>
          <p
            className="mt-1 text-xs"
            style={{
              color: 'color-mix(in srgb, var(--color-ink) 60%, transparent)',
            }}
          >
            {t('update.toast.install_on_close')}
          </p>

          <div className="mt-2 flex gap-3">
            <button
              type="button"
              className="text-xs font-medium underline underline-offset-2 hover:no-underline"
              style={{ color: 'var(--color-pharma)' }}
              onClick={() => {
                onViewDetails?.();
                handleDismiss();
              }}
            >
              {t('update.toast.view_details')}
            </button>
            <button
              type="button"
              className="text-xs font-medium underline underline-offset-2 hover:no-underline"
              style={{
                color: 'color-mix(in srgb, var(--color-ink) 50%, transparent)',
              }}
              onClick={handleDismiss}
            >
              {t('update.toast.dismiss')}
            </button>
          </div>
        </div>

        {/* Close button */}
        <button
          type="button"
          className="flex-shrink-0 text-lg leading-none"
          style={{
            color: 'color-mix(in srgb, var(--color-ink) 40%, transparent)',
          }}
          onClick={handleDismiss}
          aria-label={t('common.close')}
        >
          &times;
        </button>
      </div>
    </div>
  );
};
