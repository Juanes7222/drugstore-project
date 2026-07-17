/**
 * ConfigPreviewModal — shows a human-readable summary of the current config.
 *
 * "Con esta configuración:" list explaining what each strictness setting
 * means in practice. Used by the strictness section's "Vista previa" button.
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'motion/react';
import type { EffectiveConfig } from '../../../domain/config';

export interface ConfigPreviewModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Close handler. */
  onOpenChange: (open: boolean) => void;
  /** The effective config to preview. */
  effectiveConfig: EffectiveConfig | null;
}

export const ConfigPreviewModal: FC<ConfigPreviewModalProps> = ({
  open,
  onOpenChange,
  effectiveConfig,
}) => {
  const { t } = useTranslation();

  if (!effectiveConfig) {
    return null;
  }

  const { strictness } = effectiveConfig;

  const items: Array<{ label: string; value: string }> = [
    {
      label: t('config.strictness.lots'),
      value:
        strictness.lots === 'STRICT'
          ? t('config.preview.action_required')
          : strictness.lots === 'OPTIONAL'
            ? t('config.preview.action_optional')
            : t('config.preview.action_hidden'),
    },
    {
      label: t('config.strictness.expiry_dates'),
      value:
        strictness.expiryDates === 'STRICT'
          ? t('config.preview.action_required')
          : strictness.expiryDates === 'OPTIONAL'
            ? t('config.preview.action_optional')
            : t('config.preview.action_hidden'),
    },
    {
      label: t('config.strictness.client_required'),
      value:
        strictness.clientRequired === 'ALWAYS'
          ? t('config.preview.requirement_required')
          : strictness.clientRequired === 'ABOVE_AMOUNT'
            ? t('config.preview.requirement_above', {
                amount: strictness.clientRequiredThreshold.toLocaleString('es-CO'),
              })
            : t('config.preview.requirement_never'),
    },
    {
      label: t('config.strictness.prescription_enforcement'),
      value:
        strictness.prescriptionEnforcement === 'STRICT'
          ? t('config.preview.action_required')
          : strictness.prescriptionEnforcement === 'WARN'
            ? t('config.preview.action_optional')
            : t('config.preview.action_hidden'),
    },
    {
      label: t('config.strictness.stock_validation'),
      value: t(
        strictness.stockValidation === 'STRICT'
          ? 'preview.action_required'
          : strictness.stockValidation === 'WARN'
            ? 'preview.action_optional'
            : 'preview.action_hidden',
      ),
    },
    {
      label: t('config.strictness.cash_shift_required'),
      value: strictness.cashShiftRequired
        ? t('config.preview.action_required')
        : t('config.preview.action_hidden'),
    },
    {
      label: t('config.strictness.receipt_print_required'),
      value:
        strictness.receiptPrintRequired === 'STRICT'
          ? t('config.preview.action_required')
          : strictness.receiptPrintRequired === 'OPTIONAL'
            ? t('config.preview.action_optional')
            : t('config.preview.action_hidden'),
    },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40 bg-black/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-panel p-6 shadow-xl dark:bg-gray-800"
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.2 }}
              >
                <Dialog.Title className="text-lg font-semibold text-ink dark:text-gray-100">
                  {t('config.preview.title')}
                </Dialog.Title>

                <Dialog.Description className="mt-2 text-sm text-ink-muted dark:text-gray-400">
                  {t('config.preview.what_it_means')}
                </Dialog.Description>

                <div className="mt-4 space-y-3">
                  {items.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-lg bg-surface-variant px-3 py-2 dark:bg-gray-700/50"
                    >
                      <span className="text-sm text-ink-muted dark:text-gray-300">
                        {item.label}
                      </span>
                      <span
                        className={`ml-2 text-xs font-medium ${
                          item.value === t('config.preview.action_required')
                            ? 'text-error dark:text-red-400'
                            : item.value === t('config.preview.action_hidden')
                              ? 'text-ink-muted dark:text-gray-500'
                              : 'text-ink dark:text-gray-400'
                        }`}
                      >
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex justify-end">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg bg-surface-variant px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                    >
                      {t('common.close')}
                    </button>
                  </Dialog.Close>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};
