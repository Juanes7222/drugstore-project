/**
 * ConfigPreviewModal — shows a human-readable summary of the current config.
 *
 * "Con esta configuración:" list explaining what each strictness setting
 * means in practice. Uses Radix dialog with POS-styled close button.
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
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-sm bg-panel p-6"
                style={{ boxShadow: 'var(--shadow-pos-elevated)' }}
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ type: "spring", stiffness: 350, damping: 30 }}
              >
                <Dialog.Title className="text-heading font-bold text-ink">
                  {t('config.preview.title')}
                </Dialog.Title>

                <Dialog.Description className="mt-pos-sm text-body text-ink-muted">
                  {t('config.preview.what_it_means')}
                </Dialog.Description>

                <div className="mt-pos-md space-y-pos-xs">
                  {items.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-sm bg-surface-variant px-pos-md py-pos-sm"
                    >
                      <span className="text-body-sm text-ink-muted">
                        {item.label}
                      </span>
                      <span
                        className={`ml-pos-sm text-caption font-semibold ${
                          item.value === t('config.preview.action_required')
                            ? 'text-error'
                            : item.value === t('config.preview.action_hidden')
                              ? 'text-ink-muted'
                              : 'text-ink'
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
                      className="pos-button pos-button-secondary"
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
