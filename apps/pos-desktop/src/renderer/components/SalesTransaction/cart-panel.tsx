/**
 * Cart panel: client selection, line items, totals, and checkout action.
 *
 * Reads cart state from Redux and dispatches quantity/remove updates.
 * Integrates the ClientSelector for customer selection during a sale.
 * Respects tenant config for whether client is required/optional/hidden.
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
  selectSelectedClient,
  updateItemDiscount,
  updateItemPrice,
  updateQuantity,
} from "@/store/slices/sales-slice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { ClientSelector } from "./client-selector";
import { CartLineItem } from "./cart-line-item";
import { TotalsSummary } from "./totals-summary";
import type { ClientSelection } from "../../hooks/use-sales-transaction";
import type { CreateClientInput } from "../../../domain/clients";
import { InfoIcon, ShoppingBagIcon } from "@/components/ui/icons";

interface CartPanelProps {
  onCheckout: () => void;
  onSelectClient: (client: ClientSelection) => void;
  onClearClient: () => void;
  onCreateClient?: (input: CreateClientInput) => Promise<ClientSelection>;
  actionError: string | null;
  onClearError: () => void;
  isCreating: boolean;
}

export const CartPanel: FC<CartPanelProps> = ({
  onCheckout,
  onSelectClient,
  onClearClient,
  onCreateClient,
  actionError,
  onClearError,
  isCreating,
}: CartPanelProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const items = useAppSelector(selectCartItems);
  const count = useAppSelector(selectCartItemCount);
  const subtotal = useAppSelector(selectSubtotalCents);
  const tax = useAppSelector(selectTaxCents);
  const total = useAppSelector(selectTotalCents);
  const selectedClient = useAppSelector(selectSelectedClient);

  const handleUpdateQuantity = (id: string, quantity: number) => {
    dispatch(updateQuantity({ id, quantity }));
  };

  const handleRemove = (id: string) => {
    dispatch(removeItem(id));
  };

  const handleUpdatePrice = (id: string, unitPriceCents: number) => {
    dispatch(updateItemPrice({ id, unitPriceCents }));
  };

  const handleUpdateDiscount = (
    id: string,
    discountPercentage: number | null,
  ) => {
    dispatch(updateItemDiscount({ id, discountPercentage }));
  };

  /**
   * Unique taxPercentage across all cart items.
   * null when items have mixed rates (e.g. one exempt 0%, another 19%).
   * The label omits the rate in that case.
   */
  const uniqueRate: number | null =
    items.length === 0
      ? null
      : items.every((item) => item.taxPercentage === items[0].taxPercentage)
        ? (items[0].taxPercentage ?? 0)
        : null;

  const isEmpty = items.length === 0;

  return (
    <section className="pos-panel flex min-h-0 flex-col p-pos-md">
      {/* Client selector — always at top, config-aware */}
      <ClientSelector
        selectedClient={selectedClient}
        onSelectClient={onSelectClient}
        onClearClient={onClearClient}
        onCreateClient={onCreateClient}
      />

      {/* Divider after client */}
      <div
        className="mb-pos-md mt-pos-sm"
        style={{
          borderTop: "1px solid",
          borderColor: "color-mix(in srgb, var(--color-ink) 8%, transparent)",
        }}
      />

      {/* Cart header with item count */}
      <h2
        className="text-ui font-semibold"
        style={{ color: "var(--color-ink)" }}
      >
        {t("sales.cart.title_with_count", { count })}
      </h2>

      {/* Cart items area — scrollable */}
      <div className="mt-pos-sm min-h-0 flex-1 overflow-y-auto">
        {isEmpty ? (
          <p
            className="mt-pos-md text-body"
            style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
          >
            {t("sales.cart.empty")}
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sr-only">
              <tr>
                <th>{t("sales.cart.title")}</th>
                <th>{t("sales.product.stock")}</th>
                <th>{t("sales.product.price")}</th>
                <th>{t("sales.cart.discount")}</th>
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
                  onUpdatePrice={handleUpdatePrice}
                  onUpdateDiscount={handleUpdateDiscount}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Error banner — shown when checkout fails */}
      {actionError && (
        <div
          role="alert"
          className="mx-0 my-pos-sm flex items-start gap-2 rounded-pos-sm px-pos-md py-pos-sm text-body"
          style={{ backgroundColor: "color-mix(in srgb, var(--color-danger) 12%, transparent)", color: "var(--color-danger)" }}
        >
          <InfoIcon size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            onClick={onClearError}
            className="shrink-0 cursor-pointer bg-transparent border-none p-0 leading-none"
            aria-label={t("sales.cart.error_dismiss")}
            style={{ color: "inherit" }}
          >
            ×
          </button>
        </div>
      )}

      {/* Totals & checkout — always at bottom */}
      {!isEmpty && (
        <>
          <TotalsSummary
            subtotalCents={subtotal}
            taxCents={tax}
            totalCents={total}
            uniqueRate={uniqueRate}
          />

          <button
            type="button"
            onClick={onCheckout}
            disabled={isCreating}
            className="pos-button pos-button-primary mt-pos-md w-full text-ui py-pos-md"
          >
            <span className="flex items-center justify-center gap-2">
              <ShoppingBagIcon size={18} />
              {isCreating ? t("common.processing") : t("sales.cart.checkout")}
            </span>
          </button>
        </>
      )}
    </section>
  );
};
