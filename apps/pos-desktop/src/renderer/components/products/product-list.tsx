/**
 * ProductList — searchable, filterable table of products.
 *
 * Displays products in a scrollable table with columns for code, name,
 * lab, stock, price, and status. Supports client-side search filtering.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { DisplayProduct, CategoryOption } from "./products.types";

interface ProductListProps {
  /** Products already filtered by parent (search + category + status). */
  products: DisplayProduct[];
  categories: CategoryOption[];
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  showInactive: boolean;
  onShowInactiveChange: (value: boolean) => void;
  isLoading: boolean;
  selectedProductId: string | null;
  onSelectProduct: (product: DisplayProduct) => void;
  onEditProduct: (product: DisplayProduct) => void;
}

export const ProductList: FC<ProductListProps> = ({
  products,
  categories,
  searchQuery,
  onSearchQueryChange,
  categoryFilter,
  onCategoryFilterChange,
  showInactive,
  onShowInactiveChange,
  isLoading,
  selectedProductId,
  onSelectProduct,
  onEditProduct,
}) => {
  const { t } = useTranslation();

  // Products from parent are already filtered (search + category + status).
  // This component is purely presentational — no local filtering needed.

  return (
    <section
      className="flex flex-col overflow-hidden"
      aria-label={t("products.list_label")}
    >
      {/* ── Search & filter bar ─────────────────────────────────────── */}
      <div className="mb-pos-sm flex items-center gap-pos-sm">
        {/* Search input */}
        <div className="relative flex-1">
          <input
            id="product-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={t("products.search_placeholder")}
            disabled={isLoading}
            className="pos-input w-full pl-pos-lg"
          />
          <svg
            className="absolute left-pos-sm top-1/2 -translate-y-1/2"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 40%, transparent)",
            }}
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>

        {/* Category filter */}
        <select
          value={categoryFilter}
          onChange={(e) => onCategoryFilterChange(e.target.value)}
          className="pos-input w-44"
          aria-label={t("products.filter_category")}
        >
          <option value="">{t("products.all_categories")}</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>

        {/* Show inactive toggle */}
        <label
          className="flex cursor-pointer items-center gap-pos-xs text-body-sm"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => onShowInactiveChange(e.target.checked)}
            className="h-4 w-4 rounded"
            style={{ accentColor: "var(--color-pharma)" }}
          />
          {t("products.show_inactive")}
        </label>

        {/* Count badge */}
        <span
          className="flex-shrink-0 rounded-full px-pos-sm py-pos-xs font-data text-caption tabular-nums"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-ink) 8%, transparent)",
            color:
              "color-mix(in srgb, var(--color-ink) 55%, transparent)",
          }}
        >
          {products.length}
        </span>
      </div>

      {/* ── Product table ──────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-pos-xl">
            <p
              className="text-body-sm"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 50%, transparent)",
              }}
            >
              {t("common.loading")}
            </p>
          </div>
        )}

        {!isLoading && products.length === 0 && (
          <div className="flex items-center justify-center py-pos-xl">
            <p
              className="text-body-sm"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 40%, transparent)",
              }}
            >
              {searchQuery.trim()
                ? t("products.no_results")
                : t("products.no_products")}
            </p>
          </div>
        )}

        {!isLoading && products.length > 0 && (
          <table
            className="w-full border-collapse"
            style={{
              color: "var(--color-ink)",
            }}
          >
            <thead>
              <tr
                className="sticky top-0 text-caption font-semibold uppercase tracking-wider"
                style={{
                  backgroundColor: "var(--color-panel)",
                  color:
                    "color-mix(in srgb, var(--color-ink) 55%, transparent)",
                }}
              >
                <th className="px-pos-md py-pos-sm text-left">
                  {t("products.table_code")}
                </th>
                <th className="px-pos-md py-pos-sm text-left">
                  {t("products.table_name")}
                </th>
                <th className="px-pos-md py-pos-sm text-left">
                  {t("products.table_lab")}
                </th>
                <th className="px-pos-md py-pos-sm text-left">
                  {t("products.table_sale_type")}
                </th>
                <th className="px-pos-md py-pos-sm text-right">
                  {t("products.table_price")}
                </th>
                <th className="px-pos-md py-pos-sm text-center">
                  {t("products.table_status")}
                </th>
                <th className="px-pos-md py-pos-sm text-right">
                  {t("common.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const isSelected = selectedProductId === product.id;
                return (
                  <tr
                    key={product.id}
                    onClick={() => onSelectProduct(product)}
                    className={`cursor-pointer transition-colors duration-100 ${
                      isSelected ? "" : "hover:opacity-80"
                    }`}
                    style={{
                      backgroundColor: isSelected
                        ? "color-mix(in srgb, var(--color-pharma) 8%, transparent)"
                        : "transparent",
                      borderBottom:
                        "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
                    }}
                  >
                    <td className="px-pos-md py-pos-sm font-data text-body-sm tabular-nums">
                      {product.internalCode.length > 16
                        ? `${product.internalCode.slice(0, 16)}…`
                        : product.internalCode}
                    </td>
                    <td className="px-pos-md py-pos-sm">
                      <div>
                        <p className="text-body-sm font-medium">
                          {product.commercialName}
                        </p>
                        <p
                          className="text-caption"
                          style={{
                            color:
                              "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                          }}
                        >
                          {product.genericName}
                        </p>
                      </div>
                    </td>
                    <td className="px-pos-md py-pos-sm text-body-sm">
                      {product.laboratory}
                    </td>
                    <td className="px-pos-md py-pos-sm">
                      <span
                        className="rounded px-pos-xs py-0.5 text-caption font-medium"
                        style={{
                          backgroundColor:
                            "color-mix(in srgb, var(--color-pharma) 10%, transparent)",
                          color: "var(--color-pharma)",
                        }}
                      >
                        {t(`products.sale_type_${product.saleType.toLowerCase()}`)}
                      </span>
                    </td>
                    <td className="px-pos-md py-pos-sm text-right font-data text-body-sm tabular-nums">
                      {product.currentPrice
                        ? `$${Number(product.currentPrice).toLocaleString(
                            "es-CO",
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            },
                          )}`
                        : "—"}
                    </td>
                    <td className="px-pos-md py-pos-sm text-center">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: product.isActive
                            ? "var(--color-pharma)"
                            : "color-mix(in srgb, var(--color-ink) 30%, transparent)",
                        }}
                        aria-label={
                          product.isActive
                            ? t("products.status_active")
                            : t("products.status_inactive")
                        }
                        title={
                          product.isActive
                            ? t("products.status_active")
                            : t("products.status_inactive")
                        }
                      />
                    </td>
                    <td className="px-pos-md py-pos-sm text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditProduct(product);
                        }}
                        className="pos-button pos-button-secondary px-pos-sm py-pos-xs text-caption"
                        aria-label={t("products.edit_product")}
                      >
                        {t("common.edit")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
