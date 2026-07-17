/**
 * Product search input and results list.
 *
 * Supports three keyboard interaction patterns:
 * 1. **Type-to-search** — any printable character keypress on the panel
 *    auto-focuses the search input (unless another input/textarea is focused).
 * 2. **ArrowDown** from the input moves focus into the results list.
 * 3. **Escape** in results returns focus to the search input.
 *
 * Uses the provided `CatalogService` interface so the real Tauri-backed
 * implementation can be swapped in without changing this component.
 */
import {
  type ChangeEvent,
  type FC,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { type CatalogItem, type CatalogService } from "@/services/catalog-service";
import { ProductSearchResults } from "./product-search-results";
import { HelpBar } from "./help-bar";

const PRINTABLE_KEY_RE = /^[a-zA-Z0-9ñáéíóúü.,;:ñÑ\-_@#$%&*()+=<>?¡¿!]/;

interface ProductSearchProps {
  catalogService: CatalogService;
  onSelect: (item: CatalogItem) => void;
}

export const ProductSearch: FC<ProductSearchProps> = ({
  catalogService,
  onSelect,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    let cancelled = false;

    if (trimmedQuery.length === 0) {
      setResults([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    catalogService
      .search(trimmedQuery)
      .then((items) => {
        if (!cancelled) {
          setResults(items);
          setIsLoading(false);
        }
      })
      .catch((searchError) => {
        if (!cancelled) {
          setResults([]);
          setIsLoading(false);
          setError(
            searchError instanceof Error
              ? searchError.message
              : t("sales.search.error"),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [trimmedQuery, catalogService, t]);

  // ---- Focus the search input when the user starts typing anywhere on the panel
  const handlePanelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // Ignore if already typing in an input or textarea
      const tag = (event.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Ignore control keys, meta keys
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        event.key === "Tab" ||
        event.key === "Escape" ||
        event.key === "Enter" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight"
      ) {
        return;
      }

      // Only auto-focus for printable characters
      if (PRINTABLE_KEY_RE.test(event.key)) {
        inputRef.current?.focus();
        // Don't preventDefault — let the character reach the input
      }
    },
    [],
  );

  // ---- Handle keys on the search input
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  }, []);

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        setQuery("");
        setResults([]);
        return;
      }

      // ArrowDown from search input → move focus to results list
      if (event.key === "ArrowDown" && results.length > 0) {
        event.preventDefault();
        resultsContainerRef.current?.focus();
      }
    },
    [results.length],
  );

  const handleEscapeFromResults = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const resultCount = results.length;

  return (
    <section
      role="search"
      className="pos-panel flex min-h-0 flex-col p-pos-md"
      onKeyDown={handlePanelKeyDown}
    >
      {/* Search input row */}
      <div className="flex items-center gap-pos-sm">
        <div className="relative flex-1">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 35%, transparent)",
            }}
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={handleChange}
            onKeyDown={handleInputKeyDown}
            placeholder={t("sales.search.placeholder")}
            aria-label={t("sales.search.placeholder")}
            className="pos-input w-full pl-8"
            autoFocus
          />
        </div>
        {/* Result count badge */}
        {resultCount > 0 && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 font-data text-caption-xs tabular-nums"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-pharma) 10%, white)",
              color: "var(--color-pharma)",
            }}
          >
            {resultCount}
          </span>
        )}
      </div>

      {/* Help bar — shows below search input */}
      <HelpBar className="mt-pos-xs" />

      {error && (
        <div
          className="mt-pos-md rounded px-pos-md py-pos-sm text-body-sm"
          style={{
            backgroundColor: "color-mix(in srgb, var(--color-sync) 10%, white)",
            color: "var(--color-sync)",
          }}
          role="alert"
        >
          {t("sales.search.error")}: {error}
        </div>
      )}

      {/* Results area — scrollable, focusable for keyboard nav */}
      <div
        ref={resultsContainerRef}
        tabIndex={-1}
        className="mt-pos-md min-h-0 flex-1 overflow-y-auto focus-visible:outline-none"
      >
        {isLoading ? (
          <p
            className="text-caption"
            style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
          >
            {t("common.loading")}
          </p>
        ) : (
          <ProductSearchResults
            results={results}
            onSelect={onSelect}
            onEscape={handleEscapeFromResults}
          />
        )}
      </div>
    </section>
  );
};
