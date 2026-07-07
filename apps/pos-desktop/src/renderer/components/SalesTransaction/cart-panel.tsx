/**
 * Cart panel: title, line items table, totals, and checkout action.
 *
 * Reads cart state from Redux and dispatches quantity/remove updates.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  removeItem,
  selectCartItems,
  selectCartItemCount,
  selectSubtotalCents,
  selectTaxCents,
  selectTotalCents,
  updateQuantity,
} from "@/store/slices/sales-slice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { CartLineItem } from "./cart-line-item";
import { TotalsSummary } from "./totals-summary";

interface CartPanelProps {
  onCheckout: () => void;
}

export const CartPanel: FC<CartPanelProps> = ({ onCheckout }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const items = useAppSelector(selectCartItems);
  const count = useAppSelector(selectCartItemCount);
  const subtotal = useAppSelector(selectSubtotalCents);
  const tax = useAppSelector(selectTaxCents);
  const total = useAppSelector(selectTotalCents);

  const handleUpdateQuantity = (id: string, quantity: number) => {
    dispatch(updateQuantity({ id, quantity }));
  };

  const handleRemove = (id: string) => {
    dispatch(removeItem(id));
  };

  const isEmpty = items.length === 0;

  return (
    <section className="pos-panel flex h-full flex-col p-pos-md">
      <h2
        className="text-ui font-semibold"
        style={{ color: "var(--color-ink)" }}
      >
        {t("sales.cart.title_with_count", { count })}
      </h2>

      {isEmpty ? (
        <p
          className="mt-pos-md text-body"
          style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
        >
          {t("sales.cart.empty")}
        </p>
      ) : (
        <>
          <div className="mt-pos-md flex-1 overflow-y-auto">
            <table className="w-full border-collapse">
              <thead className="sr-only">
                <tr>
                  <th>{t("sales.cart.title")}</th>
                  <th>{t("sales.product.stock")}</th>
                  <th>{t("sales.product.price")}</th>
                  <th>{t("sales.cart.total")}</th>
                  <th>{t("common.remove")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <CartLineItem
                    key={item.id}
                    item={item}
                    onUpdateQuantity={handleUpdateQuantity}
                    onRemove={handleRemove}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <TotalsSummary
            subtotalCents={subtotal}
            taxCents={tax}
            totalCents={total}
          />
        </>
      )}

      <button
        type="button"
        onClick={onCheckout}
        disabled={isEmpty}
        className="pos-button pos-button-primary mt-pos-md w-full text-ui py-pos-md"
      >
        {t("sales.cart.checkout")}
      </button>
    </section>
  );
};
