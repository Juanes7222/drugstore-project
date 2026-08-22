/**
 * Product search input and results list.
 *
 * Supports three keyboard interaction patterns:
 * 1. **Type-to-search** — a global `window` keydown listener captures any
 *    printable character keypress anywhere on the page and auto-focuses the
 *    search input (unless another input/textarea/select is already focused).
 *    This ensures barcode scanners work regardless of where focus currently is.
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
  type RefObject,
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
import { SearchIcon } from "@/components/ui/icons";
import type { SearchSubmitResult } from "../../hooks/use-sales-keyboard";

const PRINTABLE_KEY_RE = /^[a-zA-Z0-9ñáéíóúü.,;:ñÑ\-_@#$%&*()+=<>?¡¿!]/;

interface ProductSearchProps {
  catalogService: CatalogService;
  onSelect: (item: CatalogItem) => void;
  /** External ref to the search input (used by the keyboard-flow parent to refocus after quick edits). */
  searchInputRef?: RefObject<HTMLInputElement | null>;
  /** Resolve a query via the keyboard hook; called on Enter in the input. */
  onSubmitSearch?: (query: string) => Promise<SearchSubmitResult>;
}

export const ProductSearch: FC<ProductSearchProps> = ({
  catalogService,
  onSelect,
  searchInputRef,
  onSubmitSearch,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
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

  // ---- Focus the search input when the user types anywhere on the page
  // Captures keyboard input globally (including from barcode scanners) and
  // redirects focus to the search input unless focus is already in a form
  // control or the key is a navigation/modifier key.
  useEffect(() => {
    const handleGlobalKeyDown = (event: Event) => {
      const ke = event as globalThis.KeyboardEvent;

      // Ignore if already typing in an input, textarea, or select
      const tag = (ke.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Ignore control keys, meta keys
      if (ke.ctrlKey || ke.metaKey || ke.altKey) return;
      if (
        ke.key === "Tab" ||
        ke.key === "Escape" ||
        ke.key === "Enter" ||
        ke.key === "ArrowUp" ||
        ke.key === "ArrowDown" ||
        ke.key === "ArrowLeft" ||
        ke.key === "ArrowRight"
      ) {
        return;
      }

      // Only auto-focus for printable characters (covers barcode scanners
      // which simulate rapid keyboard input)
      if (PRINTABLE_KEY_RE.test(ke.key)) {
        inputRef.current?.focus();
        // Don't preventDefault — let the character reach the input
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // ---- Handle keys on the search input
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setFeedback(null);
  }, []);

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        setQuery("");
        setResults([]);
        setFeedback(null);
        return;
      }

      // Enter resolves the query through the keyboard hook: added/restricted
      // clears the input and keeps focus for the next scan; not-found and
      // incomplete show brief feedback and clear so the scanner can retry
      // immediately. ArrowDown from the search input moves focus to results.
      if (event.key === "Enter" && onSubmitSearch) {
        const trimmed = query.trim();
        if (trimmed.length === 0) return;
        event.preventDefault();
        void onSubmitSearch(trimmed)
          .then((result) => {
            if (result.status === "added" || result.status === "restricted") {
              setFeedback(null);
              setQuery("");
              setResults([]);
              return;
            }
            if (result.status === "not-found") {
              setFeedback(t("sales.search.not_found"));
            } else if (result.status === "incomplete") {
              setFeedback(t("sales.search.incomplete"));
            } else {
              return;
            }
            setQuery("");
            setResults([]);
          })
          .catch(() => {
            setFeedback(t("sales.search.error"));
            setQuery("");
            setResults([]);
          });
        return;
      }

      if (event.key === "ArrowDown" && results.length > 0) {
        event.preventDefault();
        resultsContainerRef.current?.focus();
      }
    },
    [query, results.length, onSubmitSearch, t],
  );

  const handleEscapeFromResults = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const resultCount = results.length;

  return (
    <section
      role="search"
      className="pos-panel flex min-h-0 flex-col p-pos-md"
    >
      {/* Search input row */}
      <div className="flex items-center gap-pos-sm">
        <div className="relative flex-1">
          <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "color-mix(in srgb, var(--color-ink) 35%, transparent)" }} />
          <input
            ref={(node) => {
              inputRef.current = node;
              if (searchInputRef) searchInputRef.current = node;
            }}
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

      {/* Scanner feedback — brief inline message after a failed submit */}
      {feedback && (
        <div
          className="mt-pos-xs rounded px-pos-md py-pos-xs text-caption"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-urgency) 10%, white)",
            color: "var(--color-urgency)",
          }}
          role="alert"
        >
          {feedback}
        </div>
      )}

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
