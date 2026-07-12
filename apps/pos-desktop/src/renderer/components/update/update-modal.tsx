/**
 * Update-modal — Blocking modal for CRITICAL and MANDATORY updates.
 *
 * Behaviour:
 * - CRITICAL: Cannot be dismissed; only "Instalar ahora" is available
 *   (before the mandatory deadline) or force-installs.
 * - MANDATORY (before deadline): "Instalar ahora" + "Recordarme en 4 horas".
 * - MANDATORY (after deadline): Same as CRITICAL.
 *
 * Modal cannot be dismissed by clicking outside or pressing Escape
 * for CRITICAL updates (or MANDATORY after deadline).
 */

import { type FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the open state changes (only for dismissable variants). */
  onOpenChange?: (open: boolean) => void;
  /** The available version string. */
  version: string;
  /** Update type. */
  updateType: 'CRITICAL' | 'MANDATORY' | string;
  /** HTML release notes to display. */
  releaseNotes?: string;
  /** ISO-8601 deadline timestamp (for MANDATORY). */
  mandatoryFrom?: string;
  /** Called when user clicks "Instalar ahora". */
  onInstallNow: () => void;
  /** Called when user clicks "Recordarme en 4 horas". */
  onRemindLater?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAfterDeadline(mandatoryFrom?: string): boolean {
  if (!mandatoryFrom) return false;
  return Date.now() >= new Date(mandatoryFrom).getTime();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const UpdateModal: FC<UpdateModalProps> = ({
  open,
  onOpenChange,
  version,
  updateType,
  releaseNotes,
  mandatoryFrom,
  onInstallNow,
  onRemindLater,
}) => {
  const { t } = useTranslation();
  const afterDeadline = isAfterDeadline(mandatoryFrom);
  const isBlocking =
    updateType === 'CRITICAL' ||
    (updateType === 'MANDATORY' && afterDeadline);

  const handleInstallNow = useCallback(() => {
    onInstallNow();
  }, [onInstallNow]);

  const handleRemindLater = useCallback(() => {
    onRemindLater?.();
  }, [onRemindLater]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (isBlocking && !nextOpen) return; // Cannot close
        onOpenChange?.(nextOpen);
      }}
    >
      <Dialog.Portal>
        {/* Overlay */}
        <Dialog.Overlay
          className="fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out"
          style={
            isBlocking
              ? { cursor: 'default' }
              : { cursor: 'pointer' }
          }
        />

        {/* Content */}
        <Dialog.Content
          className="
            fixed left-1/2 top-1/2 z-50 w-full max-w-lg
            -translate-x-1/2 -translate-y-1/2
            rounded-xl p-6 shadow-xl
            data-[state=open]:animate-in data-[state=open]:fade-in
            data-[state=open]:zoom-in-95
            data-[state=closed]:animate-out data-[state=closed]:fade-out
            data-[state=closed]:zoom-out-95
          "
          style={{ backgroundColor: 'var(--color-surface)' }}
          onEscapeKeyDown={(e) => {
            if (isBlocking) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (isBlocking) e.preventDefault();
          }}
        >
          {/* Close button (hidden for blocking updates) */}
          {!isBlocking && (
            <Dialog.Close
              className="absolute right-4 top-4 text-lg leading-none"
              style={{
                color: 'color-mix(in srgb, var(--color-ink) 40%, transparent)',
              }}
              aria-label={t('common.close')}
            >
              &times;
            </Dialog.Close>
          )}

          <div className="space-y-4">
            {/* Header */}
            <div>
              {updateType === 'CRITICAL' && (
                <span
                  className="inline-block rounded px-2 py-0.5 text-xs font-bold uppercase"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--color-urgency, #dc2626) 15%, transparent)',
                    color: 'var(--color-urgency, #dc2626)',
                  }}
                >
                  {t('update.modal.critical_badge')}
                </span>
              )}
              {updateType === 'MANDATORY' && (
                <span
                  className="inline-block rounded px-2 py-0.5 text-xs font-bold uppercase"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--color-pharma) 15%, transparent)',
                    color: 'var(--color-pharma)',
                  }}
                >
                  {t('update.modal.mandatory_badge')}
                </span>
              )}

              <Dialog.Title
                className="mt-2 text-lg font-bold"
                style={{ color: 'var(--color-ink)' }}
              >
                {t('update.modal.title', { version })}
              </Dialog.Title>
            </div>

            {/* Release notes */}
            {releaseNotes && (
              <div
                className="max-h-48 overflow-y-auto rounded-md p-3 text-sm leading-relaxed"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-ink) 4%, transparent)',
                  color: 'color-mix(in srgb, var(--color-ink) 80%, transparent)',
                }}
                dangerouslySetInnerHTML={{ __html: releaseNotes }}
              />
            )}

            {/* Blocking notice for CRITICAL / after-deadline MANDATORY */}
            {isBlocking && (
              <p
                className="text-sm font-medium"
                style={{ color: 'var(--color-urgency, #dc2626)' }}
              >
                {t('update.modal.blocking_notice')}
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              {!isBlocking && onRemindLater && (
                <button
                  type="button"
                  className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)',
                    color: 'var(--color-ink)',
                  }}
                  onClick={handleRemindLater}
                >
                  {t('update.modal.remind_later')}
                </button>
              )}

              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--color-pharma, #2563eb)' }}
                onClick={handleInstallNow}
              >
                {t('update.modal.install_now')}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
