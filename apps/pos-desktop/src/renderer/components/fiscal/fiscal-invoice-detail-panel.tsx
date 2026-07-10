/**
 * FiscalInvoiceDetailPanel — left panel in the dual-panel invoice detail view.
 *
 * Shows the immutable DIAN fiscal data: CUFE, dates, line items, tax summary,
 * payment summary, buyer/seller info. Action buttons for reprint and cancel.
 */
import { type FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { InvoiceModel, InvoiceFullData, InvoiceLineItem, InvoicePayment, InvoiceTaxSummary } from "../../../domain/fiscal/fiscal-types";

interface FiscalInvoiceDetailPanelProps {
  invoice: InvoiceModel;
  onReprint: () => Promise<void>;
  onCancel: () => Promise<void>;
  isCancelling?: boolean;
  isCancellable?: boolean;
  actionMessage?: string | null;
}

/** Safely cast the Prisma JsonValue fullData to InvoiceFullData. */
const parseFullData = (data: unknown): InvoiceFullData | null => {
  if (!data || typeof data !== "object") return null;
  return data as InvoiceFullData;
};

const formatAmount = (amount: string): string =>
  `${Number(amount).toLocaleString("es-CO", {
    minimumFractionDigits: 2,
  })}`;

const formatDateTime = (date: Date | string | null): string => {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("es-CO");
};

export const FiscalInvoiceDetailPanel: FC<FiscalInvoiceDetailPanelProps> = ({
  invoice,
  onReprint,
  onCancel,
  isCancelling = false,
  isCancellable = false,
  actionMessage = null,
}) => {
  const { t } = useTranslation();

  const fullData = useMemo(() => parseFullData(invoice.fullData), [invoice.fullData]);
  const cufeDisplay = invoice.cufeOfficial ?? invoice.cufeProvisional;
  const isPending = invoice.status === "CONTINGENCY_PENDING_TRANSMISSION";

  return (
    <section
      className="flex h-full flex-col overflow-y-auto"
      aria-label={t("fiscal.detail_title")}
      style={{ backgroundColor: "var(--color-panel)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
        <h2 className="text-ui font-semibold" style={{ color: "var(--color-ink)" }}>
          {t("fiscal.detail_title")}
        </h2>
      </div>

      <div className="flex flex-col gap-3 p-4 text-body-sm">
        {/* Invoice identity */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
            {t("fiscal.detail_invoice_number")}
          </span>
          <span className="font-data text-body-sm text-right" style={{ color: "var(--color-ink)" }}>
            {invoice.invoiceNumber}
          </span>
        </div>
        <div className="flex items-start justify-between gap-2">
          <span className="text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
            {t("fiscal.detail_type")}
          </span>
          <span className="text-body-sm text-right" style={{ color: "var(--color-ink)" }}>
            {invoice.invoiceType}
          </span>
        </div>
        <div className="flex items-start justify-between gap-2">
          <span className="text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
            {t("fiscal.detail_status")}
          </span>
          <span className="pos-badge text-caption" style={{
            backgroundColor: isPending ? "var(--color-urgency-surface)" : "color-mix(in srgb, var(--color-pharma) 8%, white)",
            color: isPending ? "var(--color-urgency)" : "var(--color-pharma)",
          }}>
            {invoice.status}
          </span>
        </div>
        {invoice.contingencyNumber && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
              {t("fiscal.detail_contingency_number")}
            </span>
            <span className="font-data text-body-sm text-right" style={{ color: "var(--color-ink)" }}>
              {invoice.contingencyNumber}
            </span>
          </div>
        )}

        {/* CUFE section */}
        <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
          <h3 className="text-caption font-bold uppercase tracking-wide mb-2" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
            {t("fiscal.detail_cufe_title")}
          </h3>
          <div className="rounded-pos bg-surface p-2 font-data text-caption break-all" style={{ backgroundColor: "var(--color-surface)" }}>
            {cufeDisplay}
          </div>
          {isPending && (
            <p className="mt-1 text-caption font-semibold" style={{ color: "var(--color-urgency)" }}>
              {t("fiscal.detail_cufe_provisional")}
            </p>
          )}
          {invoice.cufeOfficial && !isPending && (
            <p className="mt-1 text-caption font-semibold" style={{ color: "var(--color-pharma)" }}>
              {t("fiscal.detail_cufe_official")}
            </p>
          )}
        </div>

        {/* Dates */}
        <div className="border-t pt-3 space-y-1" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
          <div className="flex items-start justify-between gap-2">
            <span className="text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
              {t("fiscal.detail_issued")}
            </span>
            <span className="text-body-sm text-right" style={{ color: "var(--color-ink)" }}>
              {formatDateTime(invoice.issuedAt)}
            </span>
          </div>
          <div className="flex items-start justify-between gap-2">
            <span className="text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
              {t("fiscal.detail_expires")}
            </span>
            <span className="text-body-sm text-right" style={{ color: "var(--color-ink)" }}>
              {formatDateTime(invoice.expiresAt)}
            </span>
          </div>
          {invoice.transmittedAt && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
                {t("fiscal.detail_transmitted")}
              </span>
              <span className="text-body-sm text-right" style={{ color: "var(--color-ink)" }}>
                {formatDateTime(invoice.transmittedAt)}
              </span>
            </div>
          )}
        </div>

        {/* Full data sections */}
        {fullData && (
          <>
            {/* Line items */}
            {fullData.lineItems.length > 0 && (
              <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
                <h3 className="text-caption font-bold uppercase tracking-wide mb-2" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
                  {t("fiscal.detail_line_items")}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-caption" role="table" aria-label={t("fiscal.detail_line_items")}>
                    <thead>
                      <tr className="text-left" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}>
                        <th scope="col" className="pr-2 pb-1 font-medium">{t("fiscal.detail_line_product")}</th>
                        <th scope="col" className="px-2 pb-1 text-right font-medium">{t("fiscal.detail_line_qty")}</th>
                        <th scope="col" className="px-2 pb-1 text-right font-medium">{t("fiscal.detail_line_price")}</th>
                        <th scope="col" className="pl-2 pb-1 text-right font-medium">{t("fiscal.detail_line_total")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fullData.lineItems.map((item: InvoiceLineItem, idx: number) => (
                        <tr key={idx} style={{ color: "var(--color-ink)" }}>
                          <td className="pr-2 py-1 max-w-40 truncate">{item.commercialName}</td>
                          <td className="px-2 py-1 text-right font-data tabular-nums">{item.quantity}</td>
                          <td className="px-2 py-1 text-right font-data tabular-nums">${formatAmount(item.unitPrice)}</td>
                          <td className="pl-2 py-1 text-right font-data tabular-nums">${formatAmount(item.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Payments summary */}
            {fullData.payments.length > 0 && (
              <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
                <h3 className="text-caption font-bold uppercase tracking-wide mb-2" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
                  {t("fiscal.detail_payments")}
                </h3>
                <div className="space-y-1">
                  {fullData.payments.map((pmt: InvoicePayment, idx: number) => (
                    <div key={idx} className="flex items-start justify-between gap-2">
                      <span className="text-body-sm" style={{ color: "var(--color-ink)" }}>
                        {pmt.paymentMethodName}
                        {pmt.transactionReference && (
                          <span className="text-caption ml-1" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}>
                            ({t("fiscal.detail_payment_reference")}: {pmt.transactionReference})
                          </span>
                        )}
                      </span>
                      <span className="font-data tabular-nums text-body-sm text-right" style={{ color: "var(--color-ink)" }}>
                        ${formatAmount(pmt.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tax summary */}
            {fullData.taxSummaries.length > 0 && (
              <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
                <h3 className="text-caption font-bold uppercase tracking-wide mb-2" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
                  {t("fiscal.detail_tax")}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-caption" role="table" aria-label={t("fiscal.detail_tax")}>
                    <thead>
                      <tr className="text-left" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}>
                        <th scope="col" className="pr-2 pb-1 font-medium">{t("fiscal.detail_tax_scheme")}</th>
                        <th scope="col" className="px-2 pb-1 text-right font-medium">{t("fiscal.detail_tax_rate")}</th>
                        <th scope="col" className="px-2 pb-1 text-right font-medium">{t("fiscal.detail_tax_taxable")}</th>
                        <th scope="col" className="pl-2 pb-1 text-right font-medium">{t("fiscal.detail_tax_amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fullData.taxSummaries.map((tax: InvoiceTaxSummary, idx: number) => (
                        <tr key={idx} style={{ color: "var(--color-ink)" }}>
                          <td className="pr-2 py-1">{tax.scheme}</td>
                          <td className="px-2 py-1 text-right font-data tabular-nums">{tax.rate}%</td>
                          <td className="px-2 py-1 text-right font-data tabular-nums">${formatAmount(tax.taxableAmount)}</td>
                          <td className="pl-2 py-1 text-right font-data tabular-nums">${formatAmount(tax.taxAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Totals */}
            <div className="border-t pt-3 space-y-1" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
                  {t("fiscal.detail_subtotal")}
                </span>
                <span className="font-data tabular-nums text-body-sm text-right" style={{ color: "var(--color-ink)" }}>
                  ${formatAmount(fullData.subtotal)}
                </span>
              </div>
              {Number(fullData.totalDiscount) > 0 && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
                    {t("fiscal.detail_total_discount")}
                  </span>
                  <span className="font-data tabular-nums text-body-sm text-right" style={{ color: "var(--color-urgency)" }}>
                    -${formatAmount(fullData.totalDiscount)}
                  </span>
                </div>
              )}
              <div className="flex items-start justify-between gap-2">
                <span className="text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
                  {t("fiscal.detail_total_tax")}
                </span>
                <span className="font-data tabular-nums text-body-sm text-right" style={{ color: "var(--color-ink)" }}>
                  ${formatAmount(fullData.totalTax)}
                </span>
              </div>
              <div className="flex items-start justify-between gap-2 border-t pt-1" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}>
                <span className="font-semibold text-body-sm" style={{ color: "var(--color-ink)" }}>
                  {t("fiscal.detail_total")}
                </span>
                <span className="font-data tabular-nums font-bold text-price text-right" style={{ color: "var(--color-ink)" }}>
                  ${formatAmount(fullData.totalAmount)}
                </span>
              </div>
              {Number(fullData.changeAmount) > 0 && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
                    {t("fiscal.detail_change")}
                  </span>
                  <span className="font-data tabular-nums text-body-sm text-right" style={{ color: "var(--color-ink)" }}>
                    ${formatAmount(fullData.changeAmount)}
                  </span>
                </div>
              )}
            </div>

            {/* Buyer info */}
            <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
              <h3 className="text-caption font-bold uppercase tracking-wide mb-1" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
                {t("fiscal.detail_buyer")}
              </h3>
              <div className="space-y-0.5 text-caption" style={{ color: "var(--color-ink)" }}>
                <p><span className="font-medium">{t("fiscal.detail_buyer_name")}:</span> {fullData.buyer.name}</p>
                {fullData.buyer.identificationNumber && (
                  <p><span className="font-medium">{t("fiscal.detail_buyer_id")}:</span> {fullData.buyer.identificationType ? `${fullData.buyer.identificationType} ` : ""}{fullData.buyer.identificationNumber}</p>
                )}
                {fullData.buyer.email && <p><span className="font-medium">{t("fiscal.detail_buyer_email")}:</span> {fullData.buyer.email}</p>}
                {fullData.buyer.phone && <p><span className="font-medium">{t("fiscal.detail_buyer_phone")}:</span> {fullData.buyer.phone}</p>}
                {fullData.buyer.address && <p><span className="font-medium">{t("fiscal.detail_buyer_address")}:</span> {fullData.buyer.address}</p>}
              </div>
            </div>

            {/* Seller info */}
            <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
              <h3 className="text-caption font-bold uppercase tracking-wide mb-1" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
                {t("fiscal.detail_seller")}
              </h3>
              <div className="space-y-0.5 text-caption" style={{ color: "var(--color-ink)" }}>
                <p><span className="font-medium">{t("fiscal.detail_seller_nit")}:</span> {fullData.seller.nit}</p>
                <p><span className="font-medium">{t("fiscal.detail_seller_name")}:</span> {fullData.seller.name}</p>
                {fullData.seller.resolutionNumber && (
                  <p><span className="font-medium">{t("fiscal.detail_seller_resolution")}:</span> {fullData.seller.resolutionNumber}{fullData.seller.resolutionDate ? ` (${new Date(fullData.seller.resolutionDate).toLocaleDateString("es-CO")})` : ""}</p>
                )}
              </div>
            </div>

            {/* Prescription number */}
            {fullData.prescriptionNumber && (
              <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
                    {t("fiscal.detail_prescription")}
                  </span>
                  <span className="font-data text-body-sm text-right" style={{ color: "var(--color-ink)" }}>
                    {fullData.prescriptionNumber}
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Action messages */}
        {actionMessage && (
          <div
            className="rounded-pos p-2 text-caption font-medium"
            style={{
              backgroundColor: actionMessage.startsWith("Error") ? "color-mix(in srgb, #D32F2F 8%, white)" : "color-mix(in srgb, var(--color-pharma) 8%, white)",
              color: actionMessage.startsWith("Error") ? "#D32F2F" : "var(--color-pharma)",
            }}
            role="alert"
          >
            {actionMessage}
          </div>
        )}

        {/* Action buttons */}
        <div className="border-t pt-3 space-y-2 mt-auto" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
          <button
            type="button"
            className="pos-button pos-button-primary w-full"
            onClick={onReprint}
            disabled={isCancelling}
            aria-label={t("fiscal.action_reprint")}
          >
            {t("fiscal.action_reprint")}
          </button>

          {isCancellable && (
            <button
              type="button"
              className="pos-button w-full"
              onClick={onCancel}
              disabled={isCancelling}
              aria-label={t("fiscal.action_cancel")}
              style={{
                backgroundColor: "color-mix(in srgb, #D32F2F 10%, white)",
                color: "#D32F2F",
                borderColor: "color-mix(in srgb, #D32F2F 30%, transparent)",
              }}
            >
              {isCancelling ? t("fiscal.action_cancelling") : t("fiscal.action_cancel")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
