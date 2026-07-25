/**
 * Sales history empty state — friendly placeholder when no confirmed sales
 * match the current filters.
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { FileSearch, X } from 'lucide-react';

export interface SalesHistoryEmptyProps {
  hasFilters: boolean;
  onReset: () => void;
}

export const SalesHistoryEmpty: FC<SalesHistoryEmptyProps> = ({
  hasFilters,
  onReset,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div
        className="mb-4 flex size-14 items-center justify-center rounded-full"
        style={{
          backgroundColor:
            'color-mix(in srgb, var(--color-ink) 5%, transparent)',
        }}
      >
        <FileSearch
          className="size-7"
          style={{ color: 'var(--color-ink-muted)' }}
          aria-hidden="true"
        />
      </div>

      <h3
        className="text-ui font-semibold"
        style={{ color: 'var(--color-ink)' }}
      >
        {t('salesHistory.empty.title')}
      </h3>

      <p
        className="mt-1 max-w-xs text-caption"
        style={{
          color: 'color-mix(in srgb, var(--color-ink) 55%, transparent)',
        }}
      >
        {hasFilters ? t('salesHistory.list.empty') : t('salesHistory.empty.description')}
      </p>

      {hasFilters && (
        <button
          type="button"
          onClick={onReset}
          className="pos-button pos-button-secondary mt-4 inline-flex items-center gap-1.5 text-body-sm"
        >
          <X className="size-4" aria-hidden="true" />
          {t('salesHistory.empty.reset')}
        </button>
      )}
    </div>
  );
};
