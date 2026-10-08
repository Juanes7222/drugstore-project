/**
 * Selectable items table of a sale being returned.
 *
 * Shared by the verified and unverified flows: both return against a real
 * stored sale, so both need the same rows and selection behaviour.
 *
 * @category Component
 */

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { StickyScrollX } from "@/components/ui/sticky-scroll-x";
import type { SaleSearchResult } from "./returns.types";
import { formatCents } from "./returns.types";

interface ReturnSaleItemsTableProps {
  sale: SaleSearchResult;
  selectedItemIds: Set<string>;
  onToggleItem: (itemId: string) => void;
  isProcessing: boolean;
}

export const ReturnSaleItemsTable: FC<ReturnSaleItemsTableProps> = ({
  sale,
  selectedItemIds,
  onToggleItem,
  isProcessing,
}) => {
  const { t } = useTranslation();

  return (
    <StickyScrollX radius={4}>
      <table className="pos-return-table w-full">
        <thead>
          <tr>
            <th className="pos-return-table__th" style={{ width: 48 }}>
              <span className="sr-only">{t("returns.select_item")}</span>
            </th>
            <th className="pos-return-table__th">
              {t("returns.table_product")}
            </th>
            <th className="pos-return-table__th">{t("returns.table_lot")}</th>
            <th className="pos-return-table__th pos-return-table__th--numeric">
              {t("returns.table_qty")}
            </th>
            <th className="pos-return-table__th pos-return-table__th--numeric">
              {t("returns.table_price")}
            </th>
            <th className="pos-return-table__th pos-return-table__th--numeric">
              {t("returns.table_refund")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item) => {
            const isSelected = selectedItemIds.has(item.id);

            return (
              <tr
                key={item.id}
                className={`pos-return-table__row ${
                  isSelected ? "pos-return-table__row--selected" : ""
                }`}
                onClick={() => onToggleItem(item.id)}
              >
                <td className="pos-return-table__td" style={{ width: 48 }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleItem(item.id)}
                    aria-label={`${t("returns.select_item")} ${item.productName}`}
                    disabled={isProcessing}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      accentColor: "var(--color-pharma)",
                      cursor: "pointer",
                    }}
                  />
                </td>
                <td className="pos-return-table__td font-medium">
                  {item.productName}
                </td>
                <td className="pos-return-table__td font-data tabular-nums">
                  {item.lotCode}
                </td>
                <td className="pos-return-table__td pos-return-table__td--numeric font-data">
                  {item.quantity}
                </td>
                <td className="pos-return-table__td pos-return-table__td--numeric font-data">
                  {formatCents(item.unitPriceCents)}
                </td>
                <td className="pos-return-table__td pos-return-table__td--numeric font-data">
                  {formatCents(item.totalCents)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </StickyScrollX>
  );
};
