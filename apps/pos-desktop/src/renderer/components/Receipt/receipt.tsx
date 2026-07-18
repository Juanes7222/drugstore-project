/**
 * Receipt screen — invoice preview after a completed sale.
 *
 * Uses the canonical `generateReceiptHtml` from the printing module so the
 * on-screen preview is pixel-identical to what the thermal printer outputs.
 * The print button delegates to `printReceipt` (iframe-based print dialog)
 * instead of `window.print()` (which would print the whole app shell).
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
  useRef,
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
} from "@/store/slices/payment-slice";
import { getTenantInfo } from "../../../domain/configuration/local-config.store";
import { generateReceiptHtml, printReceipt } from "../../../domain/fiscal/receipt-generator";
import type {
  InvoiceFullData,
  InvoiceLineItem,
  InvoicePayment,
  InvoiceTaxSummary,
} from "../../../domain/fiscal/fiscal-types";

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

  // ---- Sale data ----
  const items = useAppSelector(selectCartItems);
  const client = useAppSelector(selectEffectiveClient);
  const subtotalCents = useAppSelector(selectSubtotalCents);
  const taxCents = useAppSelector(selectTaxCents);
  const totalCents = useAppSelector(selectTotalCents);
  const paymentMethods = useAppSelector(selectPaymentMethods);
  const changeCents = useAppSelector(selectPaymentChangeCents);

  // ---- Tenant info ----
  const tenant = useMemo(() => getTenantInfo(), []);

  // ---- Generate canonical receipt HTML via receipt-generator ----
  const receiptHtml = useMemo(() => {
    if (items.length === 0) return "";

    const invoiceNumber = generatePreviewInvoiceNumber();
    const taxRate =
      items.length > 0 ? (items[0].taxPercentage ?? 19) : 19;

    const lineItems: InvoiceLineItem[] = items.map((item) => {
      const itemSubtotal = (item.unitPriceCents * item.quantity) / 100;
      const itemTaxAmount = itemSubtotal * (item.taxPercentage / 100);
      const itemTotal = itemSubtotal + itemTaxAmount;
      return {
        productId: item.productId,
        internalCode: item.productId,
        commercialName: item.name,
        genericName: item.genericName,
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
      paymentMethodId: pm.id,
      paymentMethodName:
        pm.type.charAt(0).toUpperCase() + pm.type.slice(1),
      amount: centsToDecimalStr(pm.amountCents),
      category: pm.type,
      transactionReference: null,
      authorizationCode: null,
      cardBrand: null,
      cardLastFour: null,
    }));

    const taxSummaries: InvoiceTaxSummary[] = [
      {
        scheme: "IVA",
        rate: (taxRate / 100).toFixed(2),
        taxableAmount: centsToDecimalStr(subtotalCents),
        taxAmount: centsToDecimalStr(taxCents),
      },
    ];

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
        address: null,
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
    });
  }, [items, client, subtotalCents, taxCents, totalCents, paymentMethods, changeCents, tenant]);

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
    dispatch(resetSaleFlow());
  }, [dispatch]);

  const handlePrint = useCallback(() => {
    if (receiptHtml) {
      printReceipt(receiptHtml);
    }
  }, [receiptHtml]);

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
      {/* Success header */}
      <div className="mb-pos-md text-center">
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
      </div>

      {/* Receipt preview — sandboxed iframe renders the canonical HTML */}
      <div
        className="flex-1 w-full max-w-md overflow-hidden rounded-lg"
        style={{
          backgroundColor: "white",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        {receiptHtml ? (
          <iframe
            ref={iframeRef}
            srcDoc={receiptHtml}
            sandbox=""
            title={t("receipt.title")}
            className="h-full w-full"
            style={{ display: "block", border: "none" }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-body-sm" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}>
            {t("receipt.no_items")}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-pos-md flex w-full max-w-md flex-col gap-pos-sm">
        <button
          type="button"
          onClick={handlePrint}
          disabled={!receiptHtml}
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
