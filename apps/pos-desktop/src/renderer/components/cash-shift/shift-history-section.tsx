/**
 * Shift history section — table with pagination.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "../../utils/format-currency";
import type { CashShiftRecord } from "../../../domain/cash-shift/cash-shift.service";
import { StickyScrollX } from "../ui/sticky-scroll-x";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ShiftHistorySectionProps {
  history: CashShiftRecord[];
  historyTotal: number;
  /** True while the first page is loading (replaces the whole table). */
  historyLoading: boolean;
  /** True while a subsequent page is being appended. */
  loadingMore: boolean;
  /** Whether more rows exist past the currently loaded ones. */
  hasMore: boolean;
  onLoadMore: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ShiftHistorySection: FC<ShiftHistorySectionProps> = ({
  history,
  historyTotal,
  historyLoading,
  loadingMore,
  hasMore,
  onLoadMore,
}) => {
  const { t } = useTranslation();

  return (
    <section
      className="rounded-pos"
      style={{
        backgroundColor: "var(--color-panel)",
        border:
          "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
      }}
    >
      <div className="flex items-center justify-between px-pos-xl pb-pos-md pt-pos-xl">
        <h2 className="text-body-lg font-semibold">
          {t("cash_shift.history_title")}
        </h2>
        <span
          className="text-caption"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {t("cash_shift.history_count", { count: historyTotal })}
        </span>
      </div>

      {historyLoading ? (
        <div className="flex items-center justify-center py-pos-xl">
          <p
            className="text-body-sm"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {t("common.loading")}
          </p>
        </div>
      ) : history.length === 0 ? (
        <div className="flex items-center justify-center py-pos-xl">
          <p
            className="text-body-sm"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {t("cash_shift.history_empty")}
          </p>
        </div>
      ) : (
        <>
          <StickyScrollX radius={4}>
            <table className="w-full text-left text-body-sm">
            <thead>
              <tr
                style={{
                  borderBottom:
                    "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
                }}
              >
                <th
                  className="px-pos-xl py-pos-sm text-caption font-medium"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  {t("cash_shift.history_table_id")}
                </th>
                <th
                  className="px-pos-xl py-pos-sm text-caption font-medium"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  {t("cash_shift.history_table_opened")}
                </th>
                <th
                  className="px-pos-xl py-pos-sm text-caption font-medium"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  {t("cash_shift.history_table_closed")}
                </th>
                <th
                  className="px-pos-xl py-pos-sm text-caption font-medium"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  {t("cash_shift.opening_balance")}
                </th>
                <th
                  className="px-pos-xl py-pos-sm text-caption font-medium"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  {t("cash_shift.state")}
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((shift) => (
                <tr
                  key={shift.id}
                  style={{
                    borderBottom:
                      "1px solid color-mix(in srgb, var(--color-ink) 5%, transparent)",
                  }}
                  className="hover:opacity-80"
                >
                  <td className="px-pos-xl py-pos-sm font-data text-caption">
                    {shift.id.slice(0, 8).toUpperCase()}
                  </td>
                  <td className="px-pos-xl py-pos-sm font-data tabular-nums">
                    {new Date(shift.openedAt).toLocaleString("es-CO")}
                  </td>
                  <td className="px-pos-xl py-pos-sm font-data tabular-nums">
                    {shift.closedAt
                      ? new Date(shift.closedAt).toLocaleString("es-CO")
                      : "—"}
                  </td>
                  <td className="px-pos-xl py-pos-sm font-data tabular-nums">
                    {formatCurrency(Number(shift.openingBalance) * 100)}
                  </td>
                  <td className="px-pos-xl py-pos-sm">
                    {shift.state === "OPEN" ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-pos-sm py-0.5 font-data text-caption font-medium"
                        style={{
                          backgroundColor:
                            "color-mix(in srgb, var(--color-verified) 15%, transparent)",
                          color: "var(--color-verified)",
                        }}
                      >
                        {t("cash_shift.state_open")}
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-pos-sm py-0.5 font-data text-caption font-medium"
                        style={{
                          backgroundColor:
                            "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                          color: "var(--color-ink-muted)",
                        }}
                      >
                        {t("cash_shift.state_closed")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StickyScrollX>

        {/* Load more */}
        {hasMore && (
          <div
            className="flex justify-center rounded-b-pos border-t px-4 py-3"
            style={{
              borderColor:
                "color-mix(in srgb, var(--color-ink) 8%, transparent)",
            }}
          >
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="pos-button pos-button-secondary text-body-sm"
            >
              {loadingMore
                ? t("common.loading")
                : t("cash_shift.history_load_more")}
            </button>
          </div>
        )}
        </>
      )}
    </section>
  );
};
