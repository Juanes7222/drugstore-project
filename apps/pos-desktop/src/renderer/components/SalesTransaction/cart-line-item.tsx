/**
 * One cart line as a ledger entry: identity on the left, an arithmetic stack
 * on the right that prints the meaning of every figure (`2 × $12.400`,
 * `−10% −$2.480`) so the row needs no column headers.
 *
 * A line whose price or discount departs from the catalog is *amended*. An
 * overridden price keeps its catalog figure in the column, struck through the
 * way a fiscal document notates a superseded amount — still legible, still in
 * force as history, no longer the charge. A discount alone amends a line
 * without a strike, because the unit price itself was never touched.
 * Either way the change is legible from structure and ink weight alone, never
 * from colour.
 */
import { type FC, useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CartItem } from "@/store/slices/sales-types";
import { computeCartItemMoney } from "@/store/slices/cart-money";
import { isNearExpiry } from "@/services/catalog-service";
import { formatCurrency } from "@/utils/format-currency";
import { formatShortDate } from "@/utils/format-date";
import { CommissionBadge } from "@/components/common/commission-badge";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import type { MovementsTarget } from "./product-movements-context-action";

interface CartLineItemProps {
  item: CartItem;
  /** Highlights the row as the keyboard-selected cart line. */
  isSelected?: boolean;
  onUpdateQuantity: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
  onUpdatePrice: (id: string, unitPriceCents: number) => void;
  onUpdateDiscount: (id: string, discountPercentage: number | null) => void;
  /** Right-click on the line — parent opens the movement history menu. */
  onMovementsContext?: (
    target: MovementsTarget,
    position: { x: number; y: number },
  ) => void;
}

const PRICE_OVERRIDE_ROLES = new Set([
  "OWNER",
  "MANAGER",
  "ADMIN",
  "SAAS_ADMIN",
]);

const MUTED_INK = "color-mix(in srgb, var(--color-ink) 50%, transparent)";
const FAINT_INK = "color-mix(in srgb, var(--color-ink) 35%, transparent)";

export const CartLineItem: FC<CartLineItemProps> = ({
  item,
  isSelected = false,
  onUpdateQuantity,
  onRemove,
  onUpdatePrice,
  onUpdateDiscount,
  onMovementsContext,
}) => {
  const { t } = useTranslation();
  const session = useLocalSessionStore((s) => s.session);
  const canOverridePrice = PRICE_OVERRIDE_ROLES.has(session?.role ?? "");

  const { lineTotalCents } = computeCartItemMoney(item);
  const nearExpiry = isNearExpiry(item.lotExpirationDate);

  // The discounted figure the invoice actually charged, derived from the
  // line total — never a second rounding of a discounted unit price.
  const grossLineCents = item.unitPriceCents * item.quantity;
  const discountCents = grossLineCents - lineTotalCents;
  const hasDiscount =
    item.discountPercentage !== null && item.discountPercentage > 0;

  /* The catalog price worth striking, or null when there is nothing to strike.
     The `typeof` check is the guard that matters: held carts persisted before
     this field existed rehydrate from localStorage with the key absent, and
     `undefined !== null` would happily pass a null-only check and print
     `$ NaN`. A missing baseline, or one equal to the live price (the override
     was typed back to catalog), renders nothing rather than a bogus mark. */
  const supersededPriceCents =
    typeof item.originalUnitPriceCents === "number" &&
    item.originalUnitPriceCents !== item.unitPriceCents
      ? item.originalUnitPriceCents
      : null;

  const isAmended =
    item.overrideUnitPriceCents !== null ||
    supersededPriceCents !== null ||
    hasDiscount;

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

  const handlePriceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitPrice();
      else if (e.key === "Escape") {
        setEditingPrice(false);
        setPriceError(null);
      }
    },
    [commitPrice],
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

  const handleDiscountKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitDiscount();
      else if (e.key === "Escape") setEditingDiscount(false);
    },
    [commitDiscount],
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

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      onMovementsContext?.(
        { productId: item.productId, productName: item.name },
        { x: event.clientX, y: event.clientY },
      );
    },
    [item.productId, item.name, onMovementsContext],
  );

  return (
    <li
      className="border-b border-l-4 px-pos-md py-pos-sm"
      data-selected={isSelected}
      data-amended={isAmended}
      aria-current={isSelected ? "true" : undefined}
      onContextMenu={handleContextMenu}
      style={{
        borderBottomColor:
          "color-mix(in srgb, var(--color-ink) 8%, transparent)",
        // Selection wins over amendment — the row that takes the next
        // keystroke must never be in doubt.
        borderLeftColor: isSelected
          ? "var(--color-pharma)"
          : isAmended
            ? "var(--color-ink)"
            : "transparent",
        backgroundColor: isSelected
          ? "color-mix(in srgb, var(--color-pharma) 8%, transparent)"
          : "transparent",
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-pos-md">
        {/* ── identity ── */}
        <div className="min-w-0">
          <div className="flex items-start gap-pos-sm">
            <p
              className="min-w-0 flex-1 text-body font-semibold"
              style={{ color: "var(--color-ink)" }}
            >
              {item.name}
            </p>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="pos-button pos-button-secondary h-6 w-6 shrink-0 p-0 text-caption"
              aria-label={t("common.remove")}
            >
              ×
            </button>
          </div>

          {/* Quantity stepper sits with the product name — the most-used
              control on the line — and carries the `0-9` shortcut only
              while this row owns the next keystroke. */}
          <div className="mt-pos-xs flex items-center gap-pos-xs">
            <button
              type="button"
              onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
              className="pos-button pos-button-secondary h-6 w-6 p-0"
              aria-label={t("common.remove")}
            >
              −
            </button>
            <span className="font-data w-6 text-center text-body tabular-nums">
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
            {isSelected && (
              <kbd className="pos-kbd ml-1" aria-hidden="true">
                0-9
              </kbd>
            )}
          </div>

          {/* Lot and expiry are the safety-critical datum: the data face is
              what keeps `0`/`O` and `1`/`l` apart at a glance. */}
          <p className="mt-pos-xs font-data text-caption">
            <span style={{ color: MUTED_INK }}>{t("sales.product.lot")}</span>{" "}
            <span style={{ color: "var(--color-ink)" }}>{item.lotCode}</span>
            <span aria-hidden="true" style={{ color: FAINT_INK }}>
              {" · "}
            </span>
            <span style={{ color: MUTED_INK }}>
              {t("sales.product.expires")}
            </span>{" "}
            <span style={{ color: "var(--color-ink)" }}>
              {formatShortDate(item.lotExpirationDate)}
            </span>
          </p>

          <div className="mt-pos-xs flex flex-wrap gap-pos-xs">
            <CommissionBadge
              commissionType={item.commissionType}
              commissionValue={item.commissionValue}
              commissionStartsAt={item.commissionStartsAt}
              commissionEndsAt={item.commissionEndsAt}
            />
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
        </div>

        {/* ── arithmetic stack: the right-aligned money column ── */}
        <div className="flex flex-col items-end gap-pos-xs">
          {/* quantity × unit price. An overridden price prints its catalog
              figure struck through ahead of the live one, so the charge and
              the figure it replaced are read in that order without a legend. */}
          {editingPrice ? (
            <div className="flex flex-col items-end gap-pos-xs">
              <input
                ref={priceRef}
                type="number"
                className={`pos-input w-28 text-right font-data tabular-nums ${
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
                  className="max-w-40 text-right text-caption leading-tight"
                  style={{ color: "var(--color-danger)" }}
                  role="alert"
                >
                  {priceError}
                </p>
              )}
            </div>
          ) : (
            <p className="font-data text-body tabular-nums whitespace-nowrap">
              <span style={{ color: FAINT_INK }}>{item.quantity} × </span>
              {supersededPriceCents !== null && (
                <>
                  <span aria-hidden="true" className="pos-superseded">
                    {formatCurrency(supersededPriceCents)}
                  </span>{" "}
                  {/* Assistive tech has no strikethrough, so the superseded
                      amount is announced as such instead of read as a second,
                      competing price. */}
                  <span className="sr-only">
                    {t("sales.cart.superseded_price", {
                      price: formatCurrency(supersededPriceCents),
                    })}
                  </span>
                </>
              )}
              {canOverridePrice ? (
                <button
                  type="button"
                  onClick={startPriceEdit}
                  className="pos-editable"
                  aria-label={t("sales.cart.editPrice")}
                  title={t("sales.cart.editPrice")}
                >
                  {formatCurrency(item.unitPriceCents)}
                </button>
              ) : (
                formatCurrency(item.unitPriceCents)
              )}
              {isSelected && (
                <kbd className="pos-kbd ml-1" aria-hidden="true">
                  =
                </kbd>
              )}
            </p>
          )}

          {/* Discount term. Always rendered and always a button — including the
              em-dash placeholder — so the control a mouse-only user needs to
              *add* a discount exists before one exists, and so the row does
              not change height when the selection moves. */}
          {editingDiscount ? (
            <input
              ref={discountRef}
              type="number"
              className="pos-input w-24 text-right font-data tabular-nums"
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
            <p className="font-data text-body-sm tabular-nums whitespace-nowrap">
              <button
                type="button"
                onClick={startDiscountEdit}
                className="pos-editable"
                aria-label={t("sales.cart.editDiscount")}
                title={t("sales.cart.editDiscount")}
              >
                {hasDiscount ? (
                  <>
                    <span style={{ color: MUTED_INK }}>
                      −{item.discountPercentage}%{" "}
                    </span>
                    <span style={{ color: "var(--color-ink)" }}>
                      −{formatCurrency(discountCents)}
                    </span>
                  </>
                ) : (
                  <span aria-hidden="true" style={{ color: FAINT_INK }}>
                    —
                  </span>
                )}
              </button>
              {isSelected && (
                <kbd className="pos-kbd ml-1" aria-hidden="true">
                  %
                </kbd>
              )}
            </p>
          )}

          {isAmended && (
            <>
              <hr className="pos-divider w-full" />
              {/* The amendment is carried by structure and ink weight, so it
                  needs a name in the accessibility tree too. */}
              <span className="sr-only">{t("sales.cart.line_amended")}</span>
            </>
          )}

          <p
            className="font-data text-price font-bold tabular-nums whitespace-nowrap"
            style={{ color: "var(--color-ink)" }}
          >
            {formatCurrency(lineTotalCents)}
          </p>
        </div>
      </div>
    </li>
  );
};
