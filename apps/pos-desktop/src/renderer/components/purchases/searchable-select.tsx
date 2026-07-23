/**
 * SearchableSelect — combobox with keyboard navigation.
 *
 * Renders a text input that filters a provided list of options. The parent
 * keeps `options` updated via `onSearch`. Arrow keys navigate, Enter selects,
 * Escape closes. Click outside also closes.
 *
 * Uses design system tokens (`pos-input`, Pharma Teal highlights) per
 * design-system.md.
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
import { ChevronDown, Loader2, Plus } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchableSelectOption {
  id: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}

export interface SearchableSelectProps {
  /** Current list of filtered options to display. */
  options: SearchableSelectOption[];
  /** Called whenever the user types in the input. */
  onSearch: (query: string) => void;
  /** Called when an option is selected (via click or keyboard). */
  onSelect: (option: SearchableSelectOption) => void;
  /** Currently selected option id, or null. */
  selectedId: string | null;
  /** Input placeholder text. */
  placeholder: string;
  disabled?: boolean;
  /** Optional button at the bottom of the dropdown to create a new item. */
  onCreateNew?: () => void;
  createNewLabel?: string;
  /** If true, show a loading indicator inside the input. */
  isLoading?: boolean;
  /** Error message shown below the input. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SearchableSelect: FC<SearchableSelectProps> = ({
  options,
  onSearch,
  onSelect,
  selectedId,
  placeholder,
  disabled = false,
  onCreateNew,
  createNewLabel,
  isLoading = false,
  error,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.id === selectedId);
  const selectedLabel = selectedOption?.label ?? '';
  const listboxId = `searchable-listbox-${placeholder.replace(/\s+/g, '-').toLowerCase()}`;

  // ── Close on click outside ────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // ── Scroll highlighted item into view ─────────────────────────────────

  useEffect(() => {
    if (!listRef.current || highlightedIndex < 0) return;
    const items = listRef.current.children;
    const item = items[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  // ── Reset highlight when options change ───────────────────────────────

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [options.length]);

  // ── Input change handler ─────────────────────────────────────────────

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      onSearch(value);
      setIsOpen(true);
      setHighlightedIndex(-1);
    },
    [onSearch],
  );

  // ── Focus handler ────────────────────────────────────────────────────

  const handleFocus = useCallback(() => {
    if (options.length > 0 || query) {
      setIsOpen(true);
    }
  }, [options.length, query]);

  // ── Select an option ─────────────────────────────────────────────────

  const handleSelect = useCallback(
    (option: SearchableSelectOption) => {
      if (option.disabled) return;
      setQuery('');
      setIsOpen(false);
      setHighlightedIndex(-1);
      onSelect(option);
      inputRef.current?.blur();
    },
    [onSelect],
  );

  // ── Keyboard navigation ─────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const filtered = options.filter((o) => !o.disabled);

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) { setIsOpen(true); return; }
          setHighlightedIndex((prev) =>
            prev < filtered.length - 1 ? prev + 1 : 0,
          );
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (!isOpen) { setIsOpen(true); return; }
          setHighlightedIndex((prev) =>
            prev > 0 ? prev - 1 : filtered.length - 1,
          );
          break;

        case 'Enter':
          e.preventDefault();
          if (isOpen && highlightedIndex >= 0 && highlightedIndex < filtered.length) {
            handleSelect(filtered[highlightedIndex]);
          } else if (isOpen && filtered.length === 1) {
            handleSelect(filtered[0]);
          }
          break;

        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setHighlightedIndex(-1);
          break;
      }
    },
    [isOpen, options, highlightedIndex, handleSelect],
  );

  // ── Render ────────────────────────────────────────────────────────────

  const showDropdown = isOpen && (options.length > 0 || onCreateNew);
  const inputValue = selectedId && !isOpen ? selectedLabel : query;

  return (
    <div ref={wrapperRef} className="relative">
      {/* Input trigger */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={`pos-input w-full pr-8 ${error ? 'border-error' : ''}`}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={
            highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined
          }
        />

        {/* Loading spinner */}
        {isLoading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sync">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          </span>
        )}

        {/* Chevron when not loading */}
        {!isLoading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none">
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="mt-0.5 text-xs text-error" role="alert">{error}</p>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <ul
          id={listboxId}
          ref={listRef}
          role="listbox"
          className="absolute z-40 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-border rounded shadow-pos-elevated"
        >
          {options.length === 0 && onCreateNew && (
            <li className="px-3 py-2 text-xs text-ink-muted italic" role="option">
              Sin resultados
            </li>
          )}

          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === highlightedIndex || option.id === selectedId}
              className={`px-3 py-2 cursor-pointer text-sm flex flex-col ${
                index === highlightedIndex
                  ? 'bg-pharma/10 text-pharma'
                  : 'hover:bg-surface'
              } ${option.disabled ? 'opacity-40 cursor-default' : ''}`}
              onClick={() => handleSelect(option)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <span className="font-medium">{option.label}</span>
              {option.sublabel && (
                <span className="text-xs text-ink-muted">{option.sublabel}</span>
              )}
            </li>
          ))}

          {onCreateNew && (
            <li
              role="option"
              className={`px-3 py-2 cursor-pointer text-sm border-t border-border text-pharma font-semibold inline-flex items-center gap-1 hover:bg-pharma/5 ${
                highlightedIndex === options.length ? 'bg-pharma/10' : ''
              }`}
              onClick={(e) => { e.stopPropagation(); setIsOpen(false); onCreateNew(); }}
              onMouseEnter={() => setHighlightedIndex(options.length)}
            >
              <Plus size={14} aria-hidden="true" />
              {createNewLabel ?? 'Crear nuevo'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
};
