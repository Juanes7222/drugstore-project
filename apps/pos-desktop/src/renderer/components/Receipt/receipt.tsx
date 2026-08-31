/**
 * Receipt screen — invoice preview after a completed sale.
 *
 * Uses the canonical `generateReceiptHtml` from the printing module so the
 * on-screen preview is pixel-identical to what the thermal printer outputs
 * (screen uses a scaled card, print uses exact mm via @media print).
 * The print button delegates to `printReceipt` (iframe-based print dialog)
 * instead of `window.print()` (which would print the whole app shell).
 *
 * Responsive strategy:
 *  - Outer container is fluid (max-w 640px centered) — adapts to viewport.
 *  - Preview card has a paper-aware max-width (440px for 80mm, visual scale
 *    ~1.35× the real 80mm ≈ 302px) so it never looks tiny on desktop while
 *    still representing thermal proportions. On mobile it fills width.
 *  - The iframe auto-resizes to its content height so no inner scroll is
 *    needed and the whole receipt is visible without cropping.
 *
 * Consumes the sale-completing motion handoff from PaymentProcessing:
 * mounts when activeScreen = "receipt" with phase "completing", plays the
 * entry choreography, then dispatches completeSaleCompletion.
 */
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  completeSaleCompletion,
  resetSaleFlow,
  selectSaleCompletionPhase,
} from "@/store/slices/ui-slice";
import {
  clearCart,
  selectCartItems,
  selectDeliveryDraft,
  selectEffectiveClient,
  selectSubtotalCents,
  selectTaxCents,
  selectTotalCents,
} from "@/store/slices/sales-slice";
import {
  selectPaymentMethods,
  selectPaymentChangeCents,
} from "@/store/slices/payment-slice";
import { getTenantInfo } from "../../../domain/configuration/local-config.store";
import { useTenantConfigStore } from "../../../domain/config/tenant-config.store";
import {
  generateReceiptHtml,
  printReceipt,
} from "../../../domain/fiscal/receipt-generator";
import type {
  InvoiceFullData,
  InvoiceLineItem,
  InvoicePayment,
  InvoiceTaxSummary,
} from "../../../domain/fiscal/fiscal-types";
import { PrinterIcon } from "@/components/ui/icons";
import { SuccessCheckIcon } from "@/components/ui/icons/animated";

const COMPLETING_ENTRY_DURATION_S = 0.35;

/**
 * Generate a preview invoice number from the current timestamp.
 * Format: FE-XXXXXX where X is a base-36 alphanumeric character.
 */
const generatePreviewInvoiceNumber = (): string => {
  const suffix = Date.now().toString(36).toUpperCase().slice(-6).padStart(6, "0");
  return `FE-${suffix}`;
};

export const Receipt: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const phase = useAppSelector(selectSaleCompletionPhase);
  const shouldReduceMotion = useReducedMotion();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState<number>(520);

  // ---- Sale data ----
  const items = useAppSelector(selectCartItems);
  const client = useAppSelector(selectEffectiveClient);
  const subtotalCents = useAppSelector(selectSubtotalCents);
  const taxCents = useAppSelector(selectTaxCents);
  const totalCents = useAppSelector(selectTotalCents);
  const delivery = useAppSelector(selectDeliveryDraft);
  const paymentMethods = useAppSelector(selectPaymentMethods);
  const changeCents = useAppSelector(selectPaymentChangeCents);

  // ---- Tenant info + fiscal receipt prefs ----
  const tenant = useMemo(() => getTenantInfo(), []);
  const fiscalPrefs = useMemo(() => {
    const eff = useTenantConfigStore.getState().effectiveConfig?.fiscal;
    if (!eff) return null;
    return {
      showQrOnReceipt: eff.showQrOnReceipt,
      invoiceHeader: eff.invoiceHeader,
      invoiceFooter: eff.invoiceFooter,
    };
  }, []);

  // ---- Generate canonical receipt HTML via receipt-generator ----
  const receiptHtml = useMemo(() => {
    if (items.length === 0) return "";

    const invoiceNumber = generatePreviewInvoiceNumber();

    const lineItems: InvoiceLineItem[] = items.map((item) => {
      const itemSubtotal = (item.unitPriceCents * item.quantity) / 100;
      const itemTaxAmount = itemSubtotal * (item.taxPercentage / 100);
      const itemTotal = itemSubtotal + itemTaxAmount;
      return {
        productId: item.productId,
        // Never expose raw UUID as a customer-facing code — hidden by buildItems
        internalCode: "",
        commercialName: item.name,
        genericName: null,
        concentration: null,
        quantity: item.quantity,
        unitPrice: centsToDecimalStr(item.unitPriceCents),
        discountPercentage: "0",
        discountAmount: "0",
        discountReason: null,
        taxRate: (item.taxPercentage / 100).toFixed(2),
        taxAmount: itemTaxAmount.toFixed(2),
        subtotal: itemSubtotal.toFixed(2),
        total: itemTotal.toFixed(2),
      };
    });

    const payments: InvoicePayment[] = paymentMethods.map((pm) => ({
      paymentMethodId: pm.paymentMethodId,
      paymentMethodName: pm.name,
      amount: centsToDecimalStr(pm.amountCents),
      category: pm.category,
      transactionReference: null,
      authorizationCode: null,
      cardBrand: null,
      cardLastFour: null,
    }));

    // Group items by tax percentage for DIAN-compliant per-rate summaries
    const taxRateGroups = new Map<number, { taxableAmount: number; taxAmount: number }>();
    for (const item of items) {
      const taxPct = item.taxPercentage ?? 0;
      const itemSubtotal = (item.unitPriceCents * item.quantity) / 100;
      const itemTaxAmount = itemSubtotal * (taxPct / 100);
      const group = taxRateGroups.get(taxPct);
      if (group) {
        group.taxableAmount += itemSubtotal;
        group.taxAmount += itemTaxAmount;
      } else {
        taxRateGroups.set(taxPct, { taxableAmount: itemSubtotal, taxAmount: itemTaxAmount });
      }
    }

    const taxSummaries: InvoiceTaxSummary[] = Array.from(taxRateGroups.entries()).map(
      ([ratePct, { taxableAmount, taxAmount }]) => ({
        scheme: "IVA",
        rate: (ratePct / 100).toFixed(2),
        taxableAmount: taxableAmount.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
      }),
    );

    const fullData: InvoiceFullData = {
      invoiceType: "ELECTRONIC_INVOICE",
      invoiceNumber,
      contingencyNumber: null,
      relatedInvoiceNumber: null,
      seller: {
        nit: tenant.nit,
        name: tenant.name,
        address: tenant.address,
        phone: tenant.phone,
        resolutionNumber: tenant.resolutionNumber,
        resolutionDate: tenant.resolutionDate,
        resolutionPrefix: tenant.resolutionPrefix,
      },
      buyer: {
        identificationType: null,
        identificationNumber: client.identification,
        name: client.name,
        email: null,
        phone: null,
        address: delivery?.address ?? null,
      },
      lineItems,
      taxSummaries,
      payments,
      subtotal: centsToDecimalStr(subtotalCents),
      totalDiscount: "0",
      totalTax: centsToDecimalStr(taxCents),
      totalAmount: centsToDecimalStr(totalCents),
      changeAmount: centsToDecimalStr(changeCents),
      issuedAt: new Date().toISOString(),
      currency: "COP",
      prescriptionNumber: null,
      workstationCode: "WS-001",
    };

    return generateReceiptHtml({
      id: `receipt-${Date.now()}`,
      invoiceNumber,
      contingencyNumber: null,
      invoiceType: "SALE_RECEIPT",
      status: "TRANSMITTED_AUTHORIZED",
      cufeProvisional: "",
      cufeOfficial: null,
      issuedAt: new Date(),
      fullData,
      delivery,
      deliveryFeeCents: delivery?.feeCents ?? 0,
      paperSize: "RECEIPT_80MM",
      showQr: fiscalPrefs?.showQrOnReceipt ?? null,
      showCufe: null,
      invoiceHeader: fiscalPrefs?.invoiceHeader ?? null,
      invoiceFooter: fiscalPrefs?.invoiceFooter ?? null,
    });
  }, [items, client, subtotalCents, taxCents, totalCents, paymentMethods, changeCents, tenant, delivery, fiscalPrefs]);

  // ---- Auto-resize iframe to content height ----
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
      if (!doc) return;
      const body = doc.body;
      const htmlEl = doc.documentElement;
      const contentHeight = Math.max(body.scrollHeight, htmlEl.scrollHeight, 420);
      // Clamp to viewport-friendly range: at least 420px, at most 85vh equivalent
      const clamped = Math.min(Math.max(contentHeight + 8, 420), 980);
      setIframeHeight(clamped);
    } catch {
      // cross-origin or not yet ready — keep default
    }
  }, []);

  // Re-measure when HTML changes (new sale)
  useEffect(() => {
    // Reset to default while new doc loads; actual measure happens onLoad
    setIframeHeight(520);
  }, [receiptHtml]);

  // ---- Handoff ----
  useEffect(() => {
    if (phase === "idle") {
      dispatch(completeSaleCompletion());
    }
  }, [dispatch, phase]);

  const handleAnimationComplete = useCallback(() => {
    dispatch(completeSaleCompletion());
  }, [dispatch]);

  const handleNewSale = useCallback(() => {
    dispatch(clearCart());
    dispatch(resetSaleFlow());
  }, [dispatch]);

  const handlePrint = useCallback(() => {
    if (receiptHtml) {
      printReceipt(receiptHtml);
    }
  }, [receiptHtml]);

  const itemCountLabel = items.length === 1 ? "1 producto" : `${items.length} productos`;

  return (
    <motion.section
      aria-label={t("receipt.title")}
      className="flex h-full flex-col overflow-y-auto"
      style={{ backgroundColor: "var(--color-surface)" }}
      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 40 }}
      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0.01 : COMPLETING_ENTRY_DURATION_S,
        ease: "easeOut",
      }}
      onAnimationComplete={handleAnimationComplete}
    >
      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-4 p-3 sm:p-4 md:p-6">
        {/* Success header */}
        <div className="text-center">
          <div
            className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full"
            style={{
              backgroundColor: "color-mix(in srgb, var(--color-pharma) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--color-pharma) 18%, transparent)",
            }}
          >
            <SuccessCheckIcon size={22} color="var(--color-pharma)" strokeWidth={2.5} />
          </div>
          <h2 className="text-heading font-bold tracking-tight" style={{ color: "var(--color-ink)" }}>
            {t("receipt.title")}
          </h2>
          <p className="mt-1 text-body-sm" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
            {items.length > 0 ? `${itemCountLabel} · Comprobante listo para imprimir` : t("receipt.no_items")}
          </p>
        </div>

        {/* Preview toolbar — paper info */}
        {receiptHtml && (
          <div className="flex items-center justify-between rounded-lg border bg-white px-3 py-2 text-caption">
            <span
              className="inline-flex items-center gap-2 font-medium"
              style={{ color: "color-mix(in srgb, var(--color-ink) 70%, transparent)" }}
            >
              <span className="inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: "var(--color-pharma)" }} aria-hidden />
              Papel 80 mm · Térmica
            </span>
            <span className="hidden sm:inline" style={{ color: "color-mix(in srgb, var(--color-ink) 45%, transparent)" }}>
              Vista previa · impresión usa tamaño real
            </span>
          </div>
        )}

        {/* Receipt preview — responsive card */}
        <div className="rounded-xl border p-2 sm:p-3" style={{ backgroundColor: "var(--color-surface-variant)", borderColor: "var(--color-border)" }}>
          <div
            className="mx-auto w-full overflow-hidden rounded-[10px] border bg-white shadow-sm"
            style={{ maxWidth: "440px", borderColor: "var(--color-border)" }}
          >
            {receiptHtml ? (
              <iframe
                ref={iframeRef}
                srcDoc={receiptHtml}
                sandbox=""
                title={t("receipt.title")}
                onLoad={handleIframeLoad}
                style={{
                  display: "block",
                  border: "none",
                  width: "100%",
                  height: `${iframeHeight}px`,
                  transition: "height 180ms ease",
                }}
              />
            ) : (
              <div
                className="flex items-center justify-center px-4 py-16 text-body-sm"
                style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
              >
                {t("receipt.no_items")}
              </div>
            )}
          </div>
          {receiptHtml && (
            <p className="mt-2 text-center text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 45%, transparent)" }}>
              La impresión respeta el ancho real del papel (80 mm). En pantalla se muestra escalada para lectura.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pb-2">
          <button type="button" onClick={handlePrint} disabled={!receiptHtml} className="pos-button pos-button-secondary w-full">
            <PrinterIcon className="mr-2 inline h-4 w-4" />
            {t("receipt.print")}
          </button>
          <button type="button" onClick={handleNewSale} className="pos-button pos-button-primary w-full">
            {t("receipt.new_sale")}
          </button>
        </div>
      </div>
    </motion.section>
  );
};

/**
 * Convert an amount in cents to a decimal string with 2 fractional digits.
 * E.g. 250050 → "2500.50"
 */
function centsToDecimalStr(cents: number): string {
  return (cents / 100).toFixed(2);
}
