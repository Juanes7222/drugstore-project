/**
 * SupplierSearchBar — debounced search input with search icon and clear button.
 *
 * Fires onChange after a 300ms debounce. The clear button resets the query.
 *
 * @category Component
 */

import {
  type FC,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

export interface SupplierSearchBarProps {
  value: string;
  onChange: (query: string) => void;
  disabled?: boolean;
}

export const SupplierSearchBar: FC<SupplierSearchBarProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const debouncedOnChange = useCallback(
    (query: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onChange(query);
      }, 300);
    },
    [onChange],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setLocal(q);
      debouncedOnChange(q);
    },
    [debouncedOnChange],
  );

  const handleClear = useCallback(() => {
    setLocal('');
    onChange('');
  }, [onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (timerRef.current) clearTimeout(timerRef.current);
        onChange(local);
      }
    },
    [local, onChange],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="px-4 py-2 border-b border-gray-100">
      <div className="relative flex items-center">
        {/* Search icon */}
        <span
          className="absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'color-mix(in srgb, var(--color-ink) 40%, transparent)' }}
          aria-hidden="true"
        >
          <Search size={14} aria-hidden="true" />
        </span>

        <input
          type="text"
          value={local}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={t('purchases.suppliers.searchPlaceholder')}
          className="pos-input pl-9 pr-8"
          aria-label={t('purchases.suppliers.searchLabel')}
          autoComplete="off"
        />

        {/* Clear button */}
        {local.length > 0 && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
            aria-label={t('common.clear')}
            tabIndex={-1}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
