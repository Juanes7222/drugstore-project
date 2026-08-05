/**
 * Supplier details dialog — read-only overlay modal.
 *
 * Opens when a supplier row is clicked so the user can inspect all fields
 * without entering the edit form. Uses Radix Dialog for focus-trapping,
 * Esc-to-close, and ARIA compliance, animated with motion (fade + scale)
 * and respecting prefers-reduced-motion. The "Edit" action hands off to
 * the supplier edit form.
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, useReducedMotion } from 'motion/react';
import {
  Building2Icon,
  CalendarIcon,
  CreditCardIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  UserIcon,
  XIcon,
} from '@/components/ui/icons';
import { formatCOP } from './purchases-helpers';
import type { SupplierSearchResult } from '../../../domain/purchases';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SupplierDetailDialogProps {
  supplier: SupplierSearchResult | null;
  onClose: () => void;
  onEdit: (supplier: SupplierSearchResult) => void;
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const contentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SupplierDetailDialog: FC<SupplierDetailDialogProps> = ({
  supplier,
  onClose,
  onEdit,
}) => {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const isOpen = supplier !== null;

  const location =
    [supplier?.city, supplier?.country].filter(Boolean).join(', ') || '—';

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {supplier && (
        <Dialog.Portal>
          {/* Overlay */}
          <Dialog.Overlay asChild>
            <motion.div
              className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px]"
              variants={overlayVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              transition={{ duration: shouldReduceMotion ? 0.01 : 0.2 }}
            />
          </Dialog.Overlay>

          {/* Content */}
          <Dialog.Content asChild>
            <motion.div
              className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2"
              variants={contentVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              transition={{
                duration: shouldReduceMotion ? 0.01 : 0.2,
                ease: 'easeOut',
              }}
            >
              <div className="max-h-[calc(100dvh-2.5rem)] overflow-y-auto rounded border border-border bg-panel p-6 shadow-pos-elevated">
                {/* ===== Header: eyebrow + identity + status + close ===== */}
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-pharma/80">
                  {t('purchases.suppliers.details')}
                </p>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-pharma/10 text-pharma">
                      <Building2Icon size={22} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <Dialog.Title
                        className="m-0 truncate text-base font-semibold text-ink"
                      >
                        {supplier.businessName}
                      </Dialog.Title>
                      <Dialog.Description
                        className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted"
                      >
                        <span className="rounded bg-surface px-1 py-0.5 font-semibold uppercase text-ink-muted">
                          {supplier.identificationType}
                        </span>
                        <span className="font-data tabular-nums">
                          {supplier.identificationNumber}
                        </span>
                      </Dialog.Description>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {/* Status badge */}
                    <span
                      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold ${
                        supplier.isActive
                          ? 'bg-success-container text-success'
                          : 'bg-surface text-ink-muted'
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          supplier.isActive ? 'bg-success' : 'bg-ink-muted'
                        }`}
                        aria-hidden="true"
                      />
                      {supplier.isActive
                        ? t('purchases.suppliers.active')
                        : t('purchases.suppliers.inactive')}
                    </span>

                    {/* Close (X) button */}
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="flex size-6 items-center justify-center rounded text-ink-muted opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
                        aria-label={t('common.close')}
                      >
                        <XIcon size={16} aria-hidden="true" />
                      </button>
                    </Dialog.Close>
                  </div>
                </div>

                {/* ===== Contact / location details ===== */}
                <div className="border-t border-border pt-3">
                  <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                    <DetailRow
                      icon={<UserIcon size={16} aria-hidden="true" />}
                      label={t('purchases.suppliers.contactName')}
                      value={supplier.contactName ?? '—'}
                    />
                    <DetailRow
                      icon={<MailIcon size={16} aria-hidden="true" />}
                      label={t('purchases.suppliers.email')}
                      value={supplier.email ?? '—'}
                    />
                    <DetailRow
                      icon={<PhoneIcon size={16} aria-hidden="true" />}
                      label={t('purchases.suppliers.phone')}
                      value={supplier.phone ?? '—'}
                    />
                    <DetailRow
                      icon={<MapPinIcon size={16} aria-hidden="true" />}
                      label={t('purchases.suppliers.address')}
                      value={supplier.address ?? '—'}
                      className="sm:col-span-2"
                    />
                    <DetailRow
                      icon={<Building2Icon size={16} aria-hidden="true" />}
                      label={t('purchases.suppliers.city')}
                      value={location}
                      className="sm:col-span-2"
                    />
                  </div>
                </div>

                {/* ===== Commercial terms ===== */}
                <div
                  className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border pt-3"
                >
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                    <CalendarIcon size={14} className="opacity-60" aria-hidden="true" />
                    {t('purchases.suppliers.paymentTermsDays')}:{' '}
                    <span className="font-medium text-ink">
                      {supplier.paymentTermsDays} {t('purchases.suppliers.days')}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                    <CreditCardIcon size={14} className="opacity-60" aria-hidden="true" />
                    {t('purchases.suppliers.creditLimit')}:{' '}
                    <span className="font-data tabular-nums font-medium text-ink">
                      {formatCOP(supplier.creditLimit)}
                    </span>
                  </span>
                </div>

                {/* ===== Actions ===== */}
                <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="pos-button pos-button-secondary"
                    >
                      <XIcon size={16} aria-hidden="true" />
                      {t('common.close')}
                    </button>
                  </Dialog.Close>

                  <button
                    type="button"
                    onClick={() => onEdit(supplier)}
                    className="pos-button pos-button-primary"
                  >
                    <PencilIcon size={16} aria-hidden="true" />
                    {t('purchases.suppliers.editTitle')}
                  </button>
                </div>
              </div>
            </motion.div>
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Labeled detail row with a leading icon. */
const DetailRow: FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
}> = ({ icon, label, value, className = '' }) => (
  <div className={`flex items-start gap-2.5 py-1.5 ${className}`}>
    <span className="mt-px shrink-0 text-ink-muted">{icon}</span>
    <div className="min-w-0">
      <p className="m-0 text-xs text-ink-muted">{label}</p>
      <p className="m-0 truncate text-sm font-medium text-ink">{value}</p>
    </div>
  </div>
);
