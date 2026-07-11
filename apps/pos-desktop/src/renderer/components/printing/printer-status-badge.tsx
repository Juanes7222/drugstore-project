/**
 * PrinterStatusBadge — small coloured dot + label for printer status.
 *
 * Used inside PrinterCard and anywhere a printer's health state needs
 * an at-a-glance indicator.
 */

import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrinterStatusCode } from '../../../domain/printing';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_META: Record<
  PrinterStatusCode,
  { dot: string; label: string }
> = {
  ONLINE: { dot: 'bg-green-500', label: 'En línea' },
  OFFLINE: { dot: 'bg-gray-400', label: 'Sin conexión' },
  ERROR: { dot: 'bg-red-500', label: 'Error' },
  NO_PAPER: { dot: 'bg-yellow-500', label: 'Sin papel' },
  UNKNOWN: { dot: 'bg-gray-300', label: 'Desconocido' },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PrinterStatusBadgeProps {
  /** The printer's current status code. */
  status: PrinterStatusCode;
  /** Optional: show only the dot, no label. */
  dotOnly?: boolean;
  /** Extra classes for the wrapper. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PrinterStatusBadge: FC<PrinterStatusBadgeProps> = ({
  status,
  dotOnly = false,
  className = '',
}) => {
  const { t } = useTranslation();
  const meta = STATUS_META[status] ?? STATUS_META.UNKNOWN;

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      role="status"
      aria-label={t(`printing.status.${status}`, meta.label)}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${meta.dot}`}
        aria-hidden="true"
      />
      {!dotOnly && (
        <span className="text-xs font-medium text-gray-500">
          {t(`printing.status.${status}`, meta.label)}
        </span>
      )}
    </span>
  );
};
