/**
 * Purchases helpers — shared formatting, state configs, and utilities
 * for all purchasing sub-pages.
 *
 * Eliminates duplication of formatCOP, formatDate, STATE_CONFIG, and
 * skeleton patterns across 7+ files.
 *
 * @category Helpers
 */

import type { FC } from 'react';

// ── Currency formatting ────────────────────────────────────────────────

export const formatCOP = (amount: number): string =>
  `$${Math.round(amount).toLocaleString('es-CO')}`;

// ── Date formatting ────────────────────────────────────────────────────

export const formatDate = (dateStr: string): string => {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
};

export const formatShortDate = (dateStr: string | null): string => {
  if (!dateStr) return '—';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
};

// ── State configs ──────────────────────────────────────────────────────

export interface StateBadgeConfig {
  label: string;
  className: string;
}

/**
 * State display config for purchase orders.
 */
export const PURCHASE_ORDER_STATES: Record<string, StateBadgeConfig> = {
  DRAFT: { label: 'Borrador', className: 'bg-gray-100 text-gray-700' },
  CONFIRMED: { label: 'Confirmada', className: 'bg-blue-100 text-blue-700' },
  PARTIALLY_RECEIVED: { label: 'Recibida parcialmente', className: 'bg-yellow-100 text-yellow-700' },
  FULLY_RECEIVED: { label: 'Recibida totalmente', className: 'bg-green-100 text-green-700' },
  ANNULLED: { label: 'Anulada', className: 'bg-red-100 text-red-700' },
};

/**
 * State display config for purchase receptions.
 */
export const RECEPTION_STATES: Record<string, StateBadgeConfig> = {
  DRAFT: { label: 'Borrador', className: 'bg-gray-100 text-gray-700' },
  CONFIRMED: { label: 'Confirmada', className: 'bg-green-100 text-green-700' },
  ANNULLED: { label: 'Anulada', className: 'bg-red-100 text-red-700' },
};

/**
 * State display config for supplier returns.
 */
export const SUPPLIER_RETURN_STATES: Record<string, StateBadgeConfig> = {
  DRAFT: { label: 'Borrador', className: 'bg-gray-100 text-gray-700' },
  CONFIRMED: { label: 'Confirmada', className: 'bg-blue-100 text-blue-700' },
  APPROVED: { label: 'Aprobada', className: 'bg-green-100 text-green-700' },
  ANNULLED: { label: 'Anulada', className: 'bg-red-100 text-red-700' },
};

/**
 * Resolve a state config from any state map, with a safe fallback.
 */
export const resolveStateConfig = (
  state: string,
  configMap: Record<string, StateBadgeConfig>,
): StateBadgeConfig =>
  configMap[state] ?? { label: state, className: 'bg-gray-100 text-gray-700' };

// ── Skeleton helpers ───────────────────────────────────────────────────

export const TableSkeletonRows: FC<{
  rows?: number;
  cols?: number;
}> = ({ rows = 8, cols = 6 }) => (
  <>
    {Array.from({ length: rows }).map((_, i) => (
      <tr key={i} className="animate-pulse border-b border-gray-50">
        {Array.from({ length: cols }).map((_, j) => (
          <td key={j} className="py-3 px-3">
            <div className="h-4 bg-gray-100 rounded w-3/4" />
          </td>
        ))}
      </tr>
    ))}
  </>
);

export const DetailSkeleton: FC = () => (
  <div className="animate-pulse space-y-4">
    <div className="h-6 bg-gray-200 rounded w-1/3" />
    <div className="h-4 bg-gray-100 rounded w-1/2" />
    <div className="h-32 bg-gray-100 rounded" />
  </div>
);

// ── Pagination component ───────────────────────────────────────────────

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  resultsLabel?: string;
  pageLabel?: string;
  ofLabel?: string;
}

export const TablePagination: FC<PaginationProps> = ({
  page,
  totalPages,
  total,
  onPageChange,
  resultsLabel,
  pageLabel,
  ofLabel,
}) => {
  const { t } = useTranslation();

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-3 py-3 border-t border-gray-100">
      <span className="text-xs text-gray-500">
        {total} {resultsLabel ?? t('purchases.orders.results')} — {pageLabel ?? t('purchases.orders.page')} {page} {ofLabel ?? t('purchases.orders.of')} {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="pos-button pos-button-secondary text-xs py-1 px-3"
          aria-label={t('common.previous')}
        >
          <ChevronLeft size={14} aria-hidden="true" />
          {t('common.previous')}
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="pos-button pos-button-secondary text-xs py-1 px-3"
          aria-label={t('common.next')}
        >
          {t('common.next')}
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
