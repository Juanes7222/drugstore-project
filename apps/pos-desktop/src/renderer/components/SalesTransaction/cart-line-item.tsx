/**
 * Single cart line item with quantity controls and inline safety badges.
 *
 * Prices and quantities use the data/mono face with tabular figures so the
 * cart stays readable and aligned when amounts have different digit counts.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { CartItem } from "@/store/slices/sales-types";
import { isNearExpiry } from "@/services/catalog-service";
import { formatCurrency } from "@/utils/format-currency";
import { formatShortDate } from "@/utils/format-date";

interface CartLineItemProps {
  item: CartItem;
  onUpdateQuantity: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
}

export const CartLineItem: FC<CartLineItemProps> = ({
  item,
  onUpdateQuantity,
  onRemove,
}) => {
  const { t } = useTranslation();
  const lineTotal = item.unitPriceCents * item.quantity;
  const nearExpiry = isNearExpiry(item.lotExpirationDate);

  return (
    <tr
      className="border-b border-ink/10"
      style={{
        borderBottomColor: "color-mix(in srgb, var(--color-ink) 8%, transparent)",
      }}
    >
      <td className="py-pos-sm pr-pos-md align-top">
        <p className="text-body font-semibold" style={{ color: "var(--color-ink)" }}>
          {item.name}
        </p>
        <p
          className="text-caption"
          style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
        >
          {t("sales.product.lot")}: {item.lotCode} — {t("sales.product.expires")}:{" "}
          {formatShortDate(item.lotExpirationDate)}
        </p>
        <div className="mt-pos-xs flex flex-wrap gap-pos-xs">
          {nearExpiry && (
            <span className="pos-badge pos-badge-urgency">
              {t("sales.product.near_expiry")}
            </span>
          )}
          {item.isRestricted && (
            <span className="pos-badge pos-badge-restrict">
              {t("sales.product.restricted")}
            </span>
          )}
        </div>
      </td>

      <td className="py-pos-sm px-pos-md align-top text-right">
        <div className="flex items-center justify-end gap-pos-xs">
          <button
            type="button"
            onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
            className="pos-button pos-button-secondary h-6 w-6 p-0"
            aria-label={t("common.remove")}
          >
            −
          </button>
          <span className="font-data text-body w-6 text-center tabular-nums">
            {item.quantity}
          </span>
          <button
            type="button"
            onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
            className="pos-button pos-button-secondary h-6 w-6 p-0"
            aria-label={t("common.add")}
          >
            +
          </button>
        </div>
      </td>

      <td className="py-pos-sm px-pos-md align-top text-right">
        <p className="font-data text-body tabular-nums">
          {formatCurrency(item.unitPriceCents)}
        </p>
      </td>

      <td className="py-pos-sm px-pos-md align-top text-right">
        <p className="font-data text-body font-semibold tabular-nums">
          {formatCurrency(lineTotal)}
        </p>
      </td>

      <td className="py-pos-sm pl-pos-md align-top text-right">
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          className="pos-button pos-button-secondary h-6 w-6 p-0 text-caption"
          aria-label={t("common.remove")}
        >
          ×
        </button>
      </td>
    </tr>
  );
};
