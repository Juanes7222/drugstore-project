/**
 * Sales history list — production table with inline filters, accessible rows,
 * and load-more pagination for confirmed sales.
 */
import {
  type FC,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarIcon, ChevronDownIcon, FileTextIcon, RefreshCwIcon, SearchIcon, XIcon } from "@/components/ui/icons";
import type {
  SaleHistoryListItem,
  SaleHistoryFilters,
} from '../../../domain/sales-pos/sales-history.service';
import { SalesHistoryEmpty } from './sales-history-empty';

export interface SalesHistoryListProps {
  sales: SaleHistoryListItem[];
  totalCount: number;
  loading: boolean;
  filters: SaleHistoryFilters;
  onSelect: (saleId: string) => void;
  onRefresh: () => void;
  onFiltersChange: (filters: Partial<SaleHistoryFilters>) => void;
  onLoadMore: () => void;
}

const formatDateInput = (date: Date | undefined): string => {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDateInput = (value: string, endOfDay = false): Date | undefined => {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  const date = new Date(y, m - 1, d);
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
};

const statusKeyMap: Record<string, string> = {
  CONTINGENCY_PENDING_TRANSMISSION: 'fiscal.status_pending',
  TRANSMITTED_AUTHORIZED: 'fiscal.status_authorized',
  TRANSMITTED_REJECTED: 'fiscal.status_rejected',
  EXPIRED_CONTINGENCY: 'fiscal.status_expired',
  CANCELLED: 'fiscal.status_cancelled',
};

export const SalesHistoryList: FC<SalesHistoryListProps> = ({
  sales,
  totalCount,
  loading,
  filters,
  onSelect,
  onRefresh,
  onFiltersChange,
  onLoadMore,
}) => {
  const { t, i18n } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  const locale = i18n.language === 'en' ? 'en-US' : 'es-CO';

  const filteredSales = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter((sale) => {
      const haystack = [
        sale.localNumber,
        sale.clientName,
        sale.invoiceNumber ?? '',
        sale.invoiceStatus ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sales, searchQuery]);

  const hasFilters = Boolean(
    filters.since || filters.until || filters.clientId || searchQuery,
  );

  const handleDateChange = useCallback(
    (field: 'since' | 'until', value: string) => {
      onFiltersChange({
        [field]: parseDateInput(value, field === 'until'),
      });
    },
    [onFiltersChange],
  );

  const handleReset = useCallback(() => {
    setSearchQuery('');
    onFiltersChange({ since: undefined, until: undefined, clientId: undefined });
  }, [onFiltersChange]);

  const formatCurrency = (amount: string): string => {
    const n = Number(amount);
    if (Number.isNaN(n)) return amount;
    return `$${n.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatDateTime = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex flex-col gap-3 border-b px-6 py-4"
        style={{
          borderColor:
            'color-mix(in srgb, var(--color-ink) 8%, transparent)',
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-heading font-bold"
              style={{ color: 'var(--color-ink)' }}
            >
              {t('salesHistory.title')}
            </h1>
            <p
              className="mt-0.5 text-caption"
              style={{
                color: 'color-mix(in srgb, var(--color-ink) 50%, transparent)',
              }}
            >
              {t('salesHistory.subtitle')}
            </p>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="pos-button pos-button-secondary inline-flex items-center gap-1.5 text-body-sm"
            aria-label={t('salesHistory.retry')}
          >
            <RefreshCwIcon
              className={`size-4 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">{t('salesHistory.retry')}</span>
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[12rem]">
            <SearchIcon
              className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
              style={{
                color: 'color-mix(in srgb, var(--color-ink) 35%, transparent)',
              }}
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('salesHistory.filters.search_placeholder')}
              className="pos-input w-full py-1.5 pl-8 pr-8 text-body-sm"
              aria-label={t('salesHistory.filters.search_placeholder')}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm opacity-50 transition-opacity hover:opacity-100"
                aria-label={t('common.clear')}
              >
                <XIcon className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span
              className="text-caption font-medium"
              style={{
                color: 'color-mix(in srgb, var(--color-ink) 55%, transparent)',
              }}
            >
              {t('salesHistory.filters.from_date')}
            </span>
            <div className="relative">
              <CalendarIcon
                className="absolute left-2 top-1/2 size-4 -translate-y-1/2"
                style={{
                  color:
                    'color-mix(in srgb, var(--color-ink) 35%, transparent)',
                }}
                aria-hidden="true"
              />
              <input
                type="date"
                value={formatDateInput(filters.since)}
                onChange={(e) => handleDateChange('since', e.target.value)}
                className="pos-input py-1.5 pl-8 text-body-sm"
                aria-label={t('salesHistory.filters.from_date')}
              />
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span
              className="text-caption font-medium"
              style={{
                color: 'color-mix(in srgb, var(--color-ink) 55%, transparent)',
              }}
            >
              {t('salesHistory.filters.to_date')}
            </span>
            <div className="relative">
              <CalendarIcon
                className="absolute left-2 top-1/2 size-4 -translate-y-1/2"
                style={{
                  color:
                    'color-mix(in srgb, var(--color-ink) 35%, transparent)',
                }}
                aria-hidden="true"
              />
              <input
                type="date"
                value={formatDateInput(filters.until)}
                onChange={(e) => handleDateChange('until', e.target.value)}
                className="pos-input py-1.5 pl-8 text-body-sm"
                aria-label={t('salesHistory.filters.to_date')}
              />
            </div>
          </label>

          {hasFilters && (
            <button
              type="button"
              onClick={handleReset}
              className="pos-button pos-button-secondary inline-flex items-center gap-1 text-body-sm"
            >
              <XIcon className="size-4" aria-hidden="true" />
              {t('salesHistory.filters.reset')}
            </button>
          )}
        </div>
      </div>

      {/* Results count */}
      <div
        className="flex items-center justify-between border-b px-6 py-2 text-caption"
        style={{
          borderColor:
            'color-mix(in srgb, var(--color-ink) 8%, transparent)',
          color: 'color-mix(in srgb, var(--color-ink) 55%, transparent)',
        }}
      >
        <span>
          {t('salesHistory.filters.showing', {
            count: filteredSales.length,
            total: totalCount,
          })}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && filteredSales.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-pos"
                style={{
                  height: '2.75rem',
                  backgroundColor:
                    'color-mix(in srgb, var(--color-ink) 6%, transparent)',
                }}
              />
            ))}
          </div>
        ) : filteredSales.length === 0 ? (
          <SalesHistoryEmpty hasFilters={hasFilters} onReset={handleReset} />
        ) : (
          <div
            className="overflow-hidden rounded-pos"
            style={{
              border: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
            }}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] border-collapse text-body-sm">
                <thead>
                  <tr
                    style={{
                      backgroundColor:
                        'color-mix(in srgb, var(--color-surface) 70%, white)',
                      borderBottom:
                        '2px solid color-mix(in srgb, var(--color-pharma) 15%, transparent)',
                    }}
                  >
                    <th
                      scope="col"
                      className="px-3 py-2 text-left text-caption font-semibold uppercase tracking-wider"
                      style={{
                        color:
                          'color-mix(in srgb, var(--color-ink) 50%, transparent)',
                      }}
                    >
                      {t('salesHistory.list.number')}
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-left text-caption font-semibold uppercase tracking-wider"
                      style={{
                        color:
                          'color-mix(in srgb, var(--color-ink) 50%, transparent)',
                      }}
                    >
                      {t('salesHistory.list.date')}
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-left text-caption font-semibold uppercase tracking-wider"
                      style={{
                        color:
                          'color-mix(in srgb, var(--color-ink) 50%, transparent)',
                      }}
                    >
                      {t('salesHistory.list.client')}
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-right text-caption font-semibold uppercase tracking-wider"
                      style={{
                        color:
                          'color-mix(in srgb, var(--color-ink) 50%, transparent)',
                      }}
                    >
                      {t('salesHistory.list.total')}
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-left text-caption font-semibold uppercase tracking-wider"
                      style={{
                        color:
                          'color-mix(in srgb, var(--color-ink) 50%, transparent)',
                      }}
                    >
                      {t('salesHistory.list.invoice')}
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-left text-caption font-semibold uppercase tracking-wider"
                      style={{
                        color:
                          'color-mix(in srgb, var(--color-ink) 50%, transparent)',
                      }}
                    >
                      {t('salesHistory.list.status')}
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-center text-caption font-semibold uppercase tracking-wider"
                      style={{
                        color:
                          'color-mix(in srgb, var(--color-ink) 50%, transparent)',
                      }}
                    >
                      {t('salesHistory.list.has_adjustments')}
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-right text-caption font-semibold uppercase tracking-wider"
                      style={{
                        color:
                          'color-mix(in srgb, var(--color-ink) 50%, transparent)',
                      }}
                    >
                      <span className="sr-only">{t('common.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSales.map((sale) => (
                    <tr
                      key={sale.saleId}
                      className="cursor-pointer transition-colors"
                      style={{
                        borderBottom:
                          '1px solid color-mix(in srgb, var(--color-ink) 5%, transparent)',
                      }}
                      onClick={() => onSelect(sale.saleId)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor =
                          'color-mix(in srgb, var(--color-pharma) 4%, white)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <td
                        className="px-3 py-2.5 font-data tabular-nums font-semibold"
                        style={{ color: 'var(--color-pharma)' }}
                      >
                        #{sale.localNumber}
                      </td>
                      <td
                        className="px-3 py-2.5"
                        style={{
                          color: 'color-mix(in srgb, var(--color-ink) 75%, transparent)',
                        }}
                      >
                        {formatDateTime(sale.confirmedAt)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col">
                          <span
                            className="max-w-[16rem] truncate font-medium"
                            style={{ color: 'var(--color-ink)' }}
                          >
                            {sale.clientName}
                          </span>
                          {sale.clientIdentificationNumber && (
                            <span
                              className="font-data tabular-nums text-caption"
                              style={{
                                color:
                                  'color-mix(in srgb, var(--color-ink) 45%, transparent)',
                              }}
                            >
                              {sale.clientIdentificationNumber}
                            </span>
                          )}
                      </div>
                    </td>
                    <td
                      className="px-3 py-2.5 text-right font-data tabular-nums font-semibold"
                      style={{ color: 'var(--color-ink)' }}
                    >
                      {formatCurrency(sale.totalAmount)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <FileTextIcon
                          className="size-3.5"
                          style={{
                            color:
                              'color-mix(in srgb, var(--color-ink) 35%, transparent)',
                          }}
                          aria-hidden="true"
                        />
                        <span
                          className="font-data tabular-nums text-caption"
                          style={{
                            color:
                              'color-mix(in srgb, var(--color-ink) 65%, transparent)',
                          }}
                        >
                          {sale.invoiceNumber ?? '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {sale.invoiceStatus ? (
                        <span
                          className="pos-badge text-caption"
                          style={{
                            backgroundColor:
                              'color-mix(in srgb, var(--color-pharma) 10%, white)',
                            color: 'var(--color-pharma)',
                          }}
                        >
                          {t(statusKeyMap[sale.invoiceStatus] ?? sale.invoiceStatus)}
                        </span>
                      ) : (
                        <span
                          className="text-caption"
                          style={{
                            color:
                              'color-mix(in srgb, var(--color-ink) 40%, transparent)',
                          }}
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {sale.hasAdjustments ? (
                        <span
                          className="pos-badge text-caption"
                          style={{
                            backgroundColor:
                              'color-mix(in srgb, var(--color-urgency) 10%, white)',
                            color: 'var(--color-urgency)',
                          }}
                        >
                          {t('salesHistory.list.has_adjustments')}
                        </span>
                      ) : (
                        <span
                          className="text-caption"
                          style={{
                            color:
                              'color-mix(in srgb, var(--color-ink) 25%, transparent)',
                          }}
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(sale.saleId);
                        }}
                        className="pos-button pos-button-secondary py-1 px-2 text-caption"
                        aria-label={t('salesHistory.detail.title', { number: sale.localNumber })}
                      >
                        {t('salesHistory.detail.title')}
                        <ChevronDownIcon
                          className="ml-1 size-3.5 rotate-[-90deg]"
                          aria-hidden="true"
                        />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {filteredSales.length < totalCount && (
              <div
                className="flex justify-center border-t px-4 py-3"
                style={{
                  borderColor:
                    'color-mix(in srgb, var(--color-ink) 8%, transparent)',
                }}
              >
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loading}
                  className="pos-button pos-button-secondary text-body-sm"
                >
                  {loading ? t('salesHistory.loading') : t('salesHistory.filters.load_more')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

