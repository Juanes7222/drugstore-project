/**
 * Product search input and results list.
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
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { CatalogItem, CatalogService } from "@/services/catalog-service";
import { ProductSearchResults } from "./product-search-results";

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

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    let cancelled = false;

    if (trimmedQuery.length === 0) {
      setResults([]);
      setIsLoading(false);
      setError(null);
      return undefined;
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

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        setQuery("");
        setResults([]);
      }
    },
    [],
  );

  return (
    <section role="search" className="pos-panel flex flex-col p-pos-md h-full">
      <input
        type="search"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={t("sales.search.placeholder")}
        aria-label={t("sales.search.placeholder")}
        className="pos-input"
        autoFocus
      />

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

      <div className="mt-pos-md flex-1 overflow-y-auto">
        {isLoading ? (
          <p
            className="text-caption"
            style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
          >
            {t("common.loading")}
          </p>
        ) : (
          <ProductSearchResults results={results} onSelect={onSelect} />
        )}
      </div>
    </section>
  );
};
