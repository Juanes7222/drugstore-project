/**
 * Cart panel: client selection, line items, the command rail, totals, and
 * checkout action.
 *
 * Cart lines render as a list rather than a table — the arithmetic stack on
 * each line prints what every column would have labelled, so the panel needs
 * no column headers at all. Reads cart state from Redux and dispatches
 * quantity/remove updates. Respects tenant config for client selection.
 */
import {
  Fragment,
  type FC,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  discardHeldCart,
  recallHeldCart,
  removeItem,
  selectCartItems,
  selectCartItemCount,
  selectHeldCarts,
  selectSelectedLineId,
  selectSubtotalCents,
  selectTaxCents,
  selectGrandTotalCents,
  selectDeliveryFeeCents,
  selectSelectedClient,
  updateItemDiscount,
  updateItemPrice,
  updateQuantity,
} from "@/store/slices/sales-slice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { ClientSelector } from "./client-selector";
import { CartCommandRail } from "./cart-command-rail";
import { CartLineItem } from "./cart-line-item";
import { LineQuickEdit } from "./line-quick-edit";
import { TotalsSummary } from "./totals-summary";
import { DeliveryToggle } from "./delivery-toggle";
import type { LineQuickEdit as LineQuickEditState } from "../../hooks/use-sales-keyboard";
import type { ClientSelection } from "../../hooks/use-sales-transaction";
import type { CreateClientInput } from "../../../domain/clients";
import {
  BarcodeIcon,
  EnterIcon,
  InfoIcon,
  ShoppingBagIcon,
} from "@/components/ui/icons";
import type { MovementsTarget } from "./product-movements-context-action";

/** How long the "nothing to repeat" notice stays up after a failed F7. */
const REPEAT_NOTICE_MS = 3000;

/**
 * Epoch ms → local "HH:mm" label for a held-cart recall button.
 * Padded digits keep every time label the same width (tabular rhythm).
 */
const formatHeldTime = (savedAt: number): string => {
  const date = new Date(savedAt);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

interface CartPanelProps {
  onCheckout: () => void;
  onSelectClient: (client: ClientSelection) => void;
  onClearClient: () => void;
  onCreateClient?: (input: CreateClientInput) => Promise<ClientSelection>;
  actionError: string | null;
  onClearError: () => void;
  isCreating: boolean;
  /** Active keyboard quick-edit buffer; renders the inline editor on its line. */
  quickEdit?: LineQuickEditState | null;
  onQuickEditDraftChange?: (draft: string) => void;
  onQuickEditCommit?: () => void;
  onQuickEditCancel?: () => void;
  onQuickEditDone?: () => void;
  /** F7 — replays the last confirmed sale; resolves false when there is none. */
  onRepeatLastSale?: () => Promise<boolean>;
  /** F8 — holds a non-empty cart, recalls the latest held cart when empty. */
  onToggleHoldCart?: () => void;
  /** Ctrl+Z — restores the cart to its previous state. */
  onUndoLastChange?: () => void;
  /** Right-click on a cart line — parent opens the movement history menu. */
  onMovementsContext?: (
    target: MovementsTarget,
    position: { x: number; y: number },
  ) => void;
}

export const CartPanel: FC<CartPanelProps> = ({
  onCheckout,
  onSelectClient,
  onClearClient,
  onCreateClient,
  actionError,
  onClearError,
  isCreating,
  quickEdit = null,
  onQuickEditDraftChange = () => {},
  onQuickEditCommit = () => {},
  onQuickEditCancel = () => {},
  onQuickEditDone = () => {},
  onRepeatLastSale = async () => false,
  onToggleHoldCart = () => {},
  onUndoLastChange = () => {},
  onMovementsContext = () => {},
}: CartPanelProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const sectionRef = useRef<HTMLElement>(null);
  const checkoutButtonRef = useRef<HTMLButtonElement>(null);
  const [repeatUnavailable, setRepeatUnavailable] = useState(false);
  const repeatNoticeTimer = useRef<number | null>(null);

  // Zone activation (Enter from the zone-navigation loop): jump straight
  // to the money action — the checkout button — so Enter twice confirms.
  useEffect(() => {
    const handleZoneActivate = () => {
      checkoutButtonRef.current?.focus();
    };
    const section = sectionRef.current;
    if (!section) return;
    section.addEventListener("zone-activate", handleZoneActivate);
    return () =>
      section.removeEventListener("zone-activate", handleZoneActivate);
  }, []);

  useEffect(() => {
    return () => {
      if (repeatNoticeTimer.current !== null) {
        window.clearTimeout(repeatNoticeTimer.current);
      }
    };
  }, []);

  const items = useAppSelector(selectCartItems);
  const count = useAppSelector(selectCartItemCount);
  const selectedLineId = useAppSelector(selectSelectedLineId);
  const subtotal = useAppSelector(selectSubtotalCents);
  const tax = useAppSelector(selectTaxCents);
  const grandTotal = useAppSelector(selectGrandTotalCents);
  const deliveryFee = useAppSelector(selectDeliveryFeeCents);
  const selectedClient = useAppSelector(selectSelectedClient);
  // Defensive: tests may seed the sales slice without the heldCarts key.
  const heldCarts = useAppSelector(selectHeldCarts) ?? [];

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

  const handleRepeat = useCallback(async () => {
    const repeated = await onRepeatLastSale();
    if (repeated) {
      setRepeatUnavailable(false);
      return;
    }
    setRepeatUnavailable(true);
    if (repeatNoticeTimer.current !== null) {
      window.clearTimeout(repeatNoticeTimer.current);
    }
    repeatNoticeTimer.current = window.setTimeout(
      () => setRepeatUnavailable(false),
      REPEAT_NOTICE_MS,
    );
  }, [onRepeatLastSale]);

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
    <section
      ref={sectionRef}
      className="pos-panel flex min-h-0 flex-col p-pos-md"
      data-nav-zone="cart"
    >
      {/* Client selector — always at top, config-aware */}
      <ClientSelector
        selectedClient={selectedClient}
        onSelectClient={onSelectClient}
        onClearClient={onClearClient}
        onCreateClient={onCreateClient}
      />

      {/* Divider after client */}
      <hr className="pos-divider my-pos-sm" />

      {/* Cart header with item count */}
      <h2
        className="text-ui font-semibold"
        style={{ color: "var(--color-ink)" }}
      >
        {t("sales.cart.title_with_count", { count })}
      </h2>

      {/* Cart lines — scrollable */}
      <div className="mt-pos-sm min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {isEmpty ? (
          heldCarts.length > 0 ? (
            /* Held carts take visual priority over the generic empty hint */
            <div
              className="mt-pos-md rounded-pos border px-pos-md py-pos-sm"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                backgroundColor:
                  "color-mix(in srgb, var(--color-ink) 3%, transparent)",
              }}
            >
              <p
                className="text-caption"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                }}
              >
                {t("sales.cart.held_carts", { count: heldCarts.length })}
              </p>
              <ul className="mt-pos-xs flex flex-wrap items-center gap-pos-sm">
                {heldCarts.map((held) => {
                  const time = formatHeldTime(held.savedAt);
                  return (
                    <li key={held.id} className="flex items-center gap-pos-xs">
                      <button
                        type="button"
                        onClick={() => dispatch(recallHeldCart(held.id))}
                        aria-label={t("sales.cart.held_cart_recall", { time })}
                        className="pos-button pos-button-secondary px-pos-sm py-0.5 font-data text-caption tabular-nums"
                      >
                        {time}
                      </button>
                      <button
                        type="button"
                        onClick={() => dispatch(discardHeldCart(held.id))}
                        aria-label={t("sales.cart.held_cart_discard", { time })}
                        className="cursor-pointer border-none bg-transparent p-1 text-caption leading-none"
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                        }}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            /* An empty cart is an invitation: name both ways to start one,
               with the key each one uses drawn next to it. */
            <div className="mt-pos-lg">
              <p
                className="text-body"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                }}
              >
                {t("sales.cart.empty")}
              </p>
              <p
                className="mt-pos-sm text-caption font-semibold uppercase"
                style={{
                  letterSpacing: "0.04em",
                  color:
                    "color-mix(in srgb, var(--color-ink) 45%, transparent)",
                }}
              >
                {t("sales.cart.empty_ways")}
              </p>
              <ul className="mt-pos-sm space-y-pos-sm">
                <li className="flex items-center gap-pos-sm">
                  <span
                    className="flex h-6 w-9 shrink-0 items-center justify-center rounded-pos border"
                    style={{
                      borderColor:
                        "color-mix(in srgb, var(--color-ink) 20%, transparent)",
                      color: "var(--color-ink)",
                    }}
                    aria-hidden="true"
                  >
                    <BarcodeIcon size={14} />
                  </span>
                  <span
                    className="text-body-sm"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("sales.cart.empty_way_scan")}
                  </span>
                </li>
                <li className="flex items-center gap-pos-sm">
                  <span
                    className="flex h-6 w-9 shrink-0 items-center justify-center"
                    aria-hidden="true"
                  >
                    <EnterIcon size={14} />
                  </span>
                  <span
                    className="text-body-sm"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("sales.cart.empty_way_type")}
                  </span>
                </li>
              </ul>
            </div>
          )
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => {
              const activeEdit =
                quickEdit?.lineId === item.id ? quickEdit : null;
              return (
                <Fragment key={item.id}>
                  <CartLineItem
                    item={item}
                    isSelected={selectedLineId === item.id}
                    onUpdateQuantity={handleUpdateQuantity}
                    onRemove={handleRemove}
                    onUpdatePrice={handleUpdatePrice}
                    onUpdateDiscount={handleUpdateDiscount}
                    onMovementsContext={onMovementsContext}
                  />
                  {activeEdit && (
                    <li
                      className="border-b border-l-4 border-pharma/60 px-pos-md py-pos-sm"
                      style={{
                        backgroundColor:
                          "color-mix(in srgb, var(--color-pharma) 8%, transparent)",
                      }}
                    >
                      <LineQuickEdit
                        quickEdit={activeEdit}
                        onDraftChange={onQuickEditDraftChange}
                        onCommit={onQuickEditCommit}
                        onCancel={onQuickEditCancel}
                        onDone={onQuickEditDone}
                      />
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>
        )}
      </div>

      {/* Error banner — shown when checkout fails */}
      {actionError && (
        <div
          role="alert"
          className="mx-0 my-pos-sm flex items-start gap-2 rounded-pos-sm px-pos-md py-pos-sm text-body"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-danger) 12%, transparent)",
            color: "var(--color-danger)",
          }}
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

      {/* Nothing to repeat: the F7 button's own outcome, since the key path
          flashes the scan ring instead and a button cannot reach it. */}
      {repeatUnavailable && (
        <p
          role="status"
          className="mt-pos-sm text-caption"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("sales.cart.command_repeat_unavailable")}
        </p>
      )}

      {/* Domicilio (delivery) control — optional, tenant-policy aware */}
      {!isEmpty && <DeliveryToggle />}

      {/* Totals & checkout — always at bottom */}
      {!isEmpty && (
        <>
          <div className="mt-pos-md">
            <TotalsSummary
              subtotalCents={subtotal}
              taxCents={tax}
              totalCents={grandTotal}
              uniqueRate={uniqueRate}
              deliveryFeeCents={deliveryFee}
            />
          </div>

          <button
            type="button"
            ref={checkoutButtonRef}
            onClick={onCheckout}
            disabled={isCreating}
            className="pos-button pos-button-primary mt-pos-md w-full text-ui py-pos-md"
          >
            <span className="flex items-center justify-center gap-2">
              <ShoppingBagIcon size={18} />
              {isCreating ? t("common.processing") : t("sales.cart.checkout")}
              <kbd className="pos-kbd pos-kbd--solid" aria-hidden="true">
                F9
              </kbd>
            </span>
          </button>
        </>
      )}

      {/* Command rail — always reachable, empty cart or not */}
      <CartCommandRail
        onRepeat={() => {
          void handleRepeat();
        }}
        onHold={onToggleHoldCart}
        onUndo={onUndoLastChange}
        hasItems={!isEmpty}
        canHold={!isEmpty || heldCarts.length > 0}
        disabled={isCreating}
      />
    </section>
  );
};
