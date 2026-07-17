/**
 * Receipt screen — invoice preview after a completed sale.
 *
 * Shows the full invoice preview on screen: pharmacy header, client info,
 * line items, totals, and payment summary. The cashier can print or start
 * a new sale.
 *
 * Consumes the sale-completing motion handoff from PaymentProcessing:
 * mounts when activeScreen = "receipt" with phase "completing", plays the
 * entry choreography, then dispatches completeSaleCompletion.
 */
import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  completeSaleCompletion,
  resetSaleFlow,
  selectSaleCompletionPhase,
} from "@/store/slices/ui-slice";
import {
  selectCartItems,
  selectEffectiveClient,
  selectSubtotalCents,
  selectTaxCents,
  selectTotalCents,
} from "@/store/slices/sales-slice";
import {
  selectPaymentMethods,
  selectPaymentChangeCents,
  selectPaymentTotalPaidCents,
} from "@/store/slices/payment-slice";
import { formatCurrency } from "@/utils/format-currency";
import { getTenantInfo } from "../../../domain/configuration/local-config.store";

const COMPLETING_ENTRY_DURATION_S = 0.35;

/**
 * Generate a simple preview invoice number from the current timestamp.
 *
 * Format: FE-XXXXXX where X is a base-36 alphanumeric character.
 * The real invoice number comes from the fiscal engine/DIAN sequence.
 */
const generatePreviewInvoiceNumber = (): string => {
  const suffix = Date.now().toString(36).toUpperCase().slice(-6).padStart(6, "0");
  return `FE-${suffix}`;
};

/**
 * Format a date for the receipt.
 */
const formatReceiptDate = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};

interface PaymentMethodLabelProps {
  type: string;
}

const PaymentMethodLabel: FC<PaymentMethodLabelProps> = ({ type }) => {
  const { t } = useTranslation();
  const key = `payment.method.${type}`;
  const fallback = type.charAt(0).toUpperCase() + type.slice(1);
  const label = t(key, { defaultValue: fallback });
  return <>{label}</>;
};

export const Receipt: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const phase = useAppSelector(selectSaleCompletionPhase);
  const shouldReduceMotion = useReducedMotion();

  // ---- Sale data ----
  const items = useAppSelector(selectCartItems);
  const client = useAppSelector(selectEffectiveClient);
  const subtotalCents = useAppSelector(selectSubtotalCents);
  const taxCents = useAppSelector(selectTaxCents);
  const totalCents = useAppSelector(selectTotalCents);
  const paymentMethods = useAppSelector(selectPaymentMethods);
  const changeCents = useAppSelector(selectPaymentChangeCents);
  const totalPaidCents = useAppSelector(selectPaymentTotalPaidCents);

  // ---- Tenant info ----
  const tenant = useMemo(() => getTenantInfo(), []);

  // ---- Receipt metadata ----
  const receiptMeta = useMemo(() => {
    const now = new Date();
    return {
      invoiceNumber: generatePreviewInvoiceNumber(),
      date: formatReceiptDate(now),
    };
  }, []);

  // ---- Handoff ----
  useEffect(() => {
    if (phase === "idle") {
      dispatch(completeSaleCompletion());
    }
  }, [dispatch, phase]);

  const handleNewSale = useCallback(() => {
    dispatch(resetSaleFlow());
  }, [dispatch]);

  const handleAnimationComplete = useCallback(() => {
    dispatch(completeSaleCompletion());
  }, [dispatch]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const hasItems = items.length > 0;

  return (
    <motion.section
      aria-label={t("receipt.title")}
      className="flex h-full flex-col items-center overflow-y-auto p-pos-md"
      style={{ backgroundColor: "var(--color-surface)" }}
      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 40 }}
      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0.01 : COMPLETING_ENTRY_DURATION_S,
        ease: "easeOut",
      }}
      onAnimationComplete={handleAnimationComplete}
    >
      {/* Paper-like receipt card */}
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg"
        style={{
          backgroundColor: "white",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        {/* ======== Header ======== */}
        <div className="border-b px-pos-lg pb-pos-md pt-pos-lg text-center">
          {/* Checkmark badge */}
          <div
            className="mx-auto mb-pos-sm flex h-10 w-10 items-center justify-center rounded-full"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-pharma) 12%, transparent)",
            }}
          >
            <svg
              className="h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="var(--color-pharma)"
              strokeWidth={2.5}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h2
            className="text-heading font-bold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("receipt.title")}
          </h2>

          {/* Pharmacy info */}
          <div className="mt-pos-sm text-body-sm" style={{ color: "color-mix(in srgb, var(--color-ink) 65%, transparent)" }}>
            <p className="font-semibold">{tenant.name}</p>
            <p>NIT: {tenant.nit}</p>
            {tenant.address && <p>{tenant.address}</p>}
            {tenant.phone && <p>Tel: {tenant.phone}</p>}
            {tenant.resolutionNumber && (
              <p className="mt-pos-xs text-caption-xs">
                Res. DIAN {tenant.resolutionNumber}
                {tenant.resolutionDate && ` del ${tenant.resolutionDate}`}
              </p>
            )}
          </div>
        </div>

        {/* ======== Body ======== */}
        <div className="px-pos-lg py-pos-md">
          {/* Invoice metadata */}
          <div className="mb-pos-md grid grid-cols-2 gap-x-pos-md gap-y-pos-xs text-body-sm">
            <span style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}>
              {t("receipt.invoice_number")}:
            </span>
            <span className="text-right font-data tabular-nums" style={{ color: "var(--color-ink)" }}>
              {receiptMeta.invoiceNumber}
            </span>
            <span style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}>
              {t("receipt.date")}:
            </span>
            <span className="text-right font-data tabular-nums" style={{ color: "var(--color-ink)" }}>
              {receiptMeta.date}
            </span>
          </div>

          {/* Client info */}
          <div
            className="mb-pos-md rounded px-pos-md py-pos-sm"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-pharma) 6%, white)",
            }}
          >
            <p className="text-caption-xs font-medium uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}>
              {t("receipt.client")}
            </p>
            <p className="mt-pos-xs font-semibold" style={{ color: "var(--color-ink)" }}>
              {client.name}
            </p>
            <p className="text-body-sm font-data tabular-nums" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
              {t("receipt.identification")}: {client.identification}
            </p>
          </div>

          {/* Line items */}
          {hasItems ? (
            <div className="mb-pos-md">
              {/* Table header */}
              <div
                className="mb-pos-xs grid gap-x-pos-md border-b pb-pos-xs text-caption-xs font-semibold uppercase tracking-wide"
                style={{
                  gridTemplateColumns: "1fr auto auto",
                  color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                  borderColor:
                    "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                }}
              >
                <span>{t("receipt.product")}</span>
                <span className="text-right">{t("receipt.qty")}</span>
                <span className="text-right" style={{ minWidth: "5rem" }}>
                  {t("receipt.total")}
                </span>
              </div>

              {/* Items */}
              {items.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-x-pos-md py-pos-xs text-body-sm"
                  style={{
                    gridTemplateColumns: "1fr auto auto",
                    borderBottom:
                      "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
                  }}
                >
                  <div>
                    <p className="font-medium" style={{ color: "var(--color-ink)" }}>
                      {item.name}
                    </p>
                    <p className="text-caption-xs" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}>
                      {item.genericName} &middot; Lote: {item.lotCode}
                    </p>
                  </div>
                  <span
                    className="self-center text-right font-data tabular-nums"
                    style={{ color: "color-mix(in srgb, var(--color-ink) 70%, transparent)" }}
                  >
                    {item.quantity}
                  </span>
                  <span
                    className="self-center text-right font-data tabular-nums"
                    style={{ color: "var(--color-ink)", minWidth: "5rem" }}
                  >
                    {formatCurrency(item.unitPriceCents * item.quantity)}
                  </span>
                </div>
              ))}

              {/* Totals */}
              <div className="mt-pos-md space-y-pos-xs border-t pt-pos-md" style={{
                borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)",
              }}>
                <div className="flex justify-between text-body-sm">
                  <span style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
                    {t("receipt.subtotal")}
                  </span>
                  <span className="font-data tabular-nums" style={{ color: "var(--color-ink)" }}>
                    {formatCurrency(subtotalCents)}
                  </span>
                </div>
                <div className="flex justify-between text-body-sm">
                  <span style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
                    {t("receipt.tax")}
                  </span>
                  <span className="font-data tabular-nums" style={{ color: "var(--color-ink)" }}>
                    {formatCurrency(taxCents)}
                  </span>
                </div>
                <div
                  className="flex justify-between border-t pt-pos-xs"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                  }}
                >
                  <span className="font-semibold" style={{ color: "var(--color-ink)" }}>
                    {t("receipt.total_due")}
                  </span>
                  <span
                    className="font-data tabular-nums font-bold"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {formatCurrency(totalCents)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p
              className="mb-pos-md py-pos-md text-center text-body-sm"
              style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
            >
              {t("receipt.no_items")}
            </p>
          )}

          {/* Payment summary */}
          {paymentMethods.length > 0 && (
            <div
              className="rounded px-pos-md py-pos-sm"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-pharma) 4%, white)",
              }}
            >
              <p className="mb-pos-xs text-caption-xs font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}>
                {t("receipt.payment_methods")}
              </p>
              {paymentMethods.map((method) => (
                <div key={method.id} className="flex justify-between py-pos-xs text-body-sm">
                  <span style={{ color: "var(--color-ink)" }}>
                    <PaymentMethodLabel type={method.type} />
                  </span>
                  <span className="font-data tabular-nums" style={{ color: "var(--color-ink)" }}>
                    {formatCurrency(method.amountCents)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-pos-xs text-body-sm" style={{
                borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)",
              }}>
                <span style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
                  {t("receipt.change")}
                </span>
                <span className="font-data tabular-nums font-semibold" style={{ color: changeCents > 0 ? "var(--color-pharma)" : "var(--color-ink)" }}>
                  {changeCents > 0 ? formatCurrency(changeCents) : "$0"}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ======== Actions ======== */}
        <div className="border-t px-pos-lg py-pos-md" style={{
          borderColor: "color-mix(in srgb, var(--color-ink) 6%, transparent)",
        }}>
          <div className="flex flex-col gap-pos-sm">
            <button
              type="button"
              onClick={handlePrint}
              className="pos-button pos-button-secondary w-full"
            >
              <svg
                className="mr-2 inline h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              {t("receipt.print")}
            </button>
            <button
              type="button"
              onClick={handleNewSale}
              className="pos-button pos-button-primary w-full"
            >
              {t("receipt.new_sale")}
            </button>
          </div>
        </div>
      </div>
    </motion.section>
  );
};
