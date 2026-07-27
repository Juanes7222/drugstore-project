/**
 * Single cart line item with quantity controls, inline price override,
 * discount editing, and safety badges.
 *
 * Prices and quantities use the data/mono face with tabular figures so the
 * cart stays readable and aligned when amounts have different digit counts.
 */
import { type FC, useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CartItem } from "@/store/slices/sales-types";
import { isNearExpiry } from "@/services/catalog-service";
import { formatCurrency } from "@/utils/format-currency";
import { formatShortDate } from "@/utils/format-date";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";

interface CartLineItemProps {
  item: CartItem;
  onUpdateQuantity: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
  onUpdatePrice: (id: string, unitPriceCents: number) => void;
  onUpdateDiscount: (id: string, discountPercentage: number | null) => void;
}

export const CartLineItem: FC<CartLineItemProps> = ({
  item,
  onUpdateQuantity,
  onRemove,
  onUpdatePrice,
  onUpdateDiscount,
}) => {
  const { t } = useTranslation();
  const session = useLocalSessionStore((s) => s.session);
  const canOverridePrice =
    session?.role === "OWNER" ||
    session?.role === "MANAGER" ||
    session?.role === "ADMIN" ||
    session?.role === "SAAS_ADMIN";

  const effectivePrice = item.discountPercentage
    ? Math.round(item.unitPriceCents * (1 - item.discountPercentage / 100))
    : item.unitPriceCents;
  const lineTotal = effectivePrice * item.quantity;
  const nearExpiry = isNearExpiry(item.lotExpirationDate);

  /* ── price inline edit with cost-floor validation ── */
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  const startPriceEdit = useCallback(() => {
    setPriceDraft((item.unitPriceCents / 100).toFixed(2));
    setPriceError(null);
    setEditingPrice(true);
  }, [item.unitPriceCents]);

  const validatePrice = useCallback(
    (newCents: number): string | null => {
      // When cost is unknown we cannot validate inline — server will reject.
      if (item.costCents === null) return null;
      if (newCents < item.costCents) {
        return t("sales.cart.error_price_below_cost", {
          name: item.name,
          price: formatCurrency(newCents),
          floor: formatCurrency(item.costCents),
        });
      }
      return null;
    },
    [item.costCents, item.name, t],
  );

  const commitPrice = useCallback(() => {
    const parsed = parseFloat(priceDraft);
    if (isNaN(parsed) || parsed < 0) {
      setEditingPrice(false);
      setPriceError(null);
      return;
    }
    const newCents = Math.round(parsed * 100);
    const error = validatePrice(newCents);
    if (error) {
      setPriceError(error);
      return; // keep input open with error
    }
    if (newCents !== item.unitPriceCents) {
      onUpdatePrice(item.id, newCents);
    }
    setEditingPrice(false);
    setPriceError(null);
  }, [priceDraft, item.id, item.unitPriceCents, onUpdatePrice, validatePrice]);

  const cancelPrice = useCallback(() => {
    setEditingPrice(false);
    setPriceError(null);
  }, []);

  const handlePriceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        commitPrice();
      } else if (e.key === "Escape") {
        cancelPrice();
      }
    },
    [commitPrice, cancelPrice],
  );

  /* ── discount inline edit ── */
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [discountDraft, setDiscountDraft] = useState("");
  const discountRef = useRef<HTMLInputElement>(null);

  const startDiscountEdit = useCallback(() => {
    setDiscountDraft(
      item.discountPercentage !== null ? String(item.discountPercentage) : "",
    );
    setEditingDiscount(true);
  }, [item.discountPercentage]);

  const commitDiscount = useCallback(() => {
    const trimmed = discountDraft.trim();
    if (trimmed === "") {
      onUpdateDiscount(item.id, null);
    } else {
      const val = parseFloat(trimmed);
      if (!isNaN(val) && val >= 0 && val <= 100) {
        onUpdateDiscount(item.id, val);
      }
    }
    setEditingDiscount(false);
  }, [discountDraft, item.id, onUpdateDiscount]);

  const cancelDiscount = useCallback(() => {
    setEditingDiscount(false);
  }, []);

  const handleDiscountKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        commitDiscount();
      } else if (e.key === "Escape") {
        cancelDiscount();
      }
    },
    [commitDiscount, cancelDiscount],
  );

  /* auto-focus when edit inputs appear */
  useEffect(() => {
    if (editingPrice && priceRef.current) {
      priceRef.current.focus();
      priceRef.current.select();
    }
  }, [editingPrice]);

  useEffect(() => {
    if (editingDiscount && discountRef.current) {
      discountRef.current.focus();
      discountRef.current.select();
    }
  }, [editingDiscount]);

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

      {/* Unit price column — editable when role permits */}
      <td className="py-pos-sm px-pos-md align-top text-right">
        {editingPrice ? (
          <div className="flex flex-col items-end gap-pos-xs">
            <input
              ref={priceRef}
              type="number"
              className={`pos-input w-28 text-right tabular-nums ${
                priceError ? "border-red-500" : ""
              }`}
              value={priceDraft}
              onChange={(e) => {
                setPriceDraft(e.target.value);
                if (priceError) setPriceError(null);
              }}
              onBlur={commitPrice}
              onKeyDown={handlePriceKeyDown}
              min={0}
              step={1}
              aria-label={t("sales.cart.editPrice")}
              aria-invalid={!!priceError}
            />
            {priceError && (
              <p
                className="text-caption leading-tight max-w-40 text-right"
                style={{ color: "var(--color-danger)" }}
                role="alert"
              >
                {priceError}
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={canOverridePrice ? startPriceEdit : undefined}
            className={`font-data text-body tabular-nums ${
              canOverridePrice
                ? "cursor-pointer underline-offset-2 hover:underline"
                : "cursor-default"
            }`}
            aria-label={
              canOverridePrice ? t("sales.cart.editPrice") : undefined
            }
            title={
              canOverridePrice ? t("sales.cart.editPrice") : undefined
            }
          >
            {formatCurrency(item.unitPriceCents)}
          </button>
        )}
      </td>

      {/* Discount column */}
      <td className="py-pos-sm px-pos-md align-top text-right">
        {editingDiscount ? (
          <input
            ref={discountRef}
            type="number"
            className="pos-input w-20 text-right tabular-nums"
            value={discountDraft}
            onChange={(e) => setDiscountDraft(e.target.value)}
            onBlur={commitDiscount}
            onKeyDown={handleDiscountKeyDown}
            min={0}
            max={100}
            step={1}
            aria-label={t("sales.cart.editDiscount")}
          />
        ) : (
          <button
            type="button"
            onClick={startDiscountEdit}
            className="font-data text-body tabular-nums cursor-pointer underline-offset-2 hover:underline"
            aria-label={t("sales.cart.editDiscount")}
            title={t("sales.cart.editDiscount")}
          >
            {item.discountPercentage !== null
              ? `${item.discountPercentage}%`
              : "—"}
          </button>
        )}
      </td>

      {/* Line total — reflects discount */}
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
