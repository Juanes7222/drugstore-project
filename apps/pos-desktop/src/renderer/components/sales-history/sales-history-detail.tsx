/**
 * Sales history detail — dual-pane fiscal (DIAN) and operational (droguería) view
 * with adjustment history and a button to create a new operational adjustment.
 */
import { type FC, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftIcon,
  Building2Icon,
  CreditCardIcon,
  Edit3Icon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  PrinterIcon,
  ReceiptIcon,
  StickyNoteIcon,
  TagIcon,
  TruckIcon,
  UserIcon,
  XIcon,
} from "@/components/ui/icons";
import type { SaleHistoryDetail } from "../../../domain/sales-pos/sales-history.service";
import type {
  AdjustmentHistoryEntry,
  OperationalInvoiceView,
} from "../../../domain/fiscal/local-adjustment.types";
import type { InvoiceFullData } from "../../../domain/fiscal/fiscal-types";
import { AdjustmentHistoryPanel } from "../fiscal/adjustment-history-panel";

export interface SalesHistoryDetailProps {
  saleId: string;
  detail: SaleHistoryDetail | null;
  loading: boolean;
  viewMode: "fiscal" | "operational";
  operationalView: OperationalInvoiceView | null;
  adjustmentHistory: AdjustmentHistoryEntry[];
  adjustmentHistoryLoading: boolean;
  /** Whether the current role may modify invoices (cashier = read-only). */
  canModify?: boolean;
  onViewModeChange: (mode: "fiscal" | "operational") => void;
  onClose: () => void;
  onCreateAdjustment: () => void;
  onReprint: () => void;
  onCancelInvoice: () => void;
}

const statusKeyMap: Record<string, string> = {
  CONTINGENCY_PENDING_TRANSMISSION: "fiscal.status_pending",
  TRANSMITTED_AUTHORIZED: "fiscal.status_authorized",
  TRANSMITTED_REJECTED: "fiscal.status_rejected",
  EXPIRED_CONTINGENCY: "fiscal.status_expired",
  CANCELLED: "fiscal.status_cancelled",
};

export const SalesHistoryDetail: FC<SalesHistoryDetailProps> = ({
  detail,
  loading,
  viewMode,
  operationalView,
  adjustmentHistory,
  adjustmentHistoryLoading,
  canModify = true,
  onViewModeChange,
  onClose,
  onCreateAdjustment,
  onReprint,
  onCancelInvoice,
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "es-CO";

  const formatCurrency = (amount: string): string => {
    const n = Number(amount);
    if (Number.isNaN(n)) return amount;
    return `$${n.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatDateTime = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale, {
      dateStyle: "short",
      timeStyle: "short",
    });
  };

  const formatShortDate = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(locale);
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6">
        <div
          className="size-8 animate-spin rounded-full border-2 border-current border-r-transparent"
          style={{ color: "var(--color-pharma)" }}
        />
        <p className="text-body-sm" style={{ color: "var(--color-ink-muted)" }}>
          {t("salesHistory.loading")}
        </p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ReceiptIcon
          className="size-10"
          style={{ color: "var(--color-ink-muted)" }}
          aria-hidden="true"
        />
        <p
          className="text-body-sm font-medium"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {t("salesHistory.error_detail")}
        </p>
      </div>
    );
  }

  const { sale, invoices } = detail;
  const mainInvoice = invoices[0] ?? null;
  const fullData =
    (mainInvoice?.fullData as unknown as InvoiceFullData | undefined) ??
    undefined;
  const hasOperationalDifferences =
    operationalView?.operational.hasDifferences ?? false;

  const fiscalClientName =
    fullData?.buyer.name ?? sale.clientNameSnapshot ?? t("fiscal.client_final");

  const operationalClient = operationalView?.operational.client ?? {
    clientId: sale.clientId,
    name: sale.clientNameSnapshot,
    identificationType: sale.clientIdentificationTypeSnapshot,
    identificationNumber: sale.clientIdentificationNumberSnapshot,
  };

  const operationalPayments =
    operationalView?.operational.payments ??
    sale.payments.map((p) => ({
      paymentMethodId: p.paymentMethodId,
      paymentMethodName: p.paymentMethodName,
      amount: p.amount,
      category: "",
      transactionReference: p.transactionReference,
      authorizationCode: p.authorizationCode,
      cardBrand: p.cardBrand,
      cardLastFour: p.cardLastFour,
    }));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{
          borderColor: "color-mix(in srgb, var(--color-ink) 8%, transparent)",
        }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-7 items-center justify-center rounded-pos transition-colors hover:opacity-70"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
            aria-label={t("common.back")}
          >
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
          </button>
          <div>
            <h2
              className="text-ui font-semibold"
              style={{ color: "var(--color-ink)" }}
            >
              {t("salesHistory.detail.title")}
            </h2>
            <p
              className="text-caption"
              style={{
                color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
              }}
            >
              {t("salesHistory.detail.sale_number_label")} #{sale.localNumber}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReprint}
            className="pos-button pos-button-secondary inline-flex items-center gap-1.5 py-1 px-2 text-body-sm"
          >
            <PrinterIcon className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {t("salesHistory.detail.actions.reprint")}
            </span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-7 items-center justify-center rounded-pos transition-colors hover:opacity-70"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
            aria-label={t("common.close")}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* View tabs */}
      <div
        className="flex items-center gap-1 border-b px-4 py-2"
        role="tablist"
        aria-label={t("salesHistory.detail.title")}
        style={{
          borderColor: "color-mix(in srgb, var(--color-ink) 8%, transparent)",
          backgroundColor:
            "color-mix(in srgb, var(--color-surface) 60%, white)",
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "fiscal"}
          onClick={() => onViewModeChange("fiscal")}
          className="rounded-pos px-3 py-1.5 text-body-sm font-medium transition-colors"
          style={{
            color:
              viewMode === "fiscal"
                ? "var(--color-pharma)"
                : "color-mix(in srgb, var(--color-ink) 55%, transparent)",
            backgroundColor:
              viewMode === "fiscal"
                ? "color-mix(in srgb, var(--color-pharma) 8%, white)"
                : "transparent",
          }}
        >
          {t("salesHistory.detail.fiscal_tab")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "operational"}
          onClick={() => onViewModeChange("operational")}
          className="rounded-pos px-3 py-1.5 text-body-sm font-medium transition-colors"
          style={{
            color:
              viewMode === "operational"
                ? "var(--color-pharma)"
                : "color-mix(in srgb, var(--color-ink) 55%, transparent)",
            backgroundColor:
              viewMode === "operational"
                ? "color-mix(in srgb, var(--color-pharma) 8%, white)"
                : "transparent",
          }}
        >
          {t("salesHistory.detail.operational_tab")}
          {hasOperationalDifferences && (
            <span
              className="ml-1.5 inline-flex size-2 rounded-full"
              style={{ backgroundColor: "var(--color-urgency)" }}
              aria-hidden="true"
            />
          )}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {viewMode === "fiscal" && (
          <div className="space-y-4">
            {mainInvoice && fullData ? (
              <>
                {/* Fiscal summary card */}
                <div
                  className="rounded-pos p-3"
                  style={{
                    backgroundColor: "var(--color-panel)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
                  }}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <ReceiptIcon
                      className="size-4"
                      style={{ color: "var(--color-pharma)" }}
                      aria-hidden="true"
                    />
                    <h3
                      className="text-body font-semibold"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {t("salesHistory.detail.fiscal_invoice_title")}
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-caption">
                    <div>
                      <span
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                        }}
                      >
                        {t("salesHistory.detail.invoice_number_label")}
                      </span>
                      <p
                        className="font-data tabular-nums font-semibold"
                        style={{ color: "var(--color-ink)" }}
                      >
                        {mainInvoice.invoiceNumber}
                      </p>
                    </div>
                    <div>
                      <span
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                        }}
                      >
                        {t("salesHistory.detail.status_label")}
                      </span>
                      <p style={{ color: "var(--color-ink)" }}>
                        {t(
                          statusKeyMap[mainInvoice.status] ??
                            mainInvoice.status,
                        )}
                      </p>
                    </div>
                    <div>
                      <span
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                        }}
                      >
                        {t("salesHistory.detail.cufe_label")}
                      </span>
                      <p
                        className="break-all font-data text-caption"
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 75%, transparent)",
                        }}
                      >
                        {mainInvoice.cufeProvisional}
                      </p>
                    </div>
                    <div>
                      <span
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                        }}
                      >
                        {t("salesHistory.detail.issued_label")}
                      </span>
                      <p style={{ color: "var(--color-ink)" }}>
                        {formatDateTime(mainInvoice.issuedAt.toISOString())}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Buyer */}
                <InfoCard
                  icon={<UserIcon className="size-4" />}
                  title={t("salesHistory.detail.buyer_label")}
                >
                  <div className="space-y-1 text-caption">
                    <p
                      className="font-medium"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {fiscalClientName}
                    </p>
                    {fullData.buyer.identificationType &&
                      fullData.buyer.identificationNumber && (
                        <p
                          className="font-data tabular-nums"
                          style={{
                            color:
                              "color-mix(in srgb, var(--color-ink) 65%, transparent)",
                          }}
                        >
                          {fullData.buyer.identificationType}:{" "}
                          {fullData.buyer.identificationNumber}
                        </p>
                      )}
                    {fullData.buyer.email && (
                      <p
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 65%, transparent)",
                        }}
                      >
                        {fullData.buyer.email}
                      </p>
                    )}
                  </div>
                </InfoCard>

                {/* Seller */}
                <InfoCard
                  icon={<Building2Icon className="size-4" />}
                  title={t("salesHistory.detail.seller_label")}
                >
                  <div className="space-y-1 text-caption">
                    <p
                      className="font-medium"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {fullData.seller.name}
                    </p>
                    <p
                      className="font-data tabular-nums"
                      style={{
                        color:
                          "color-mix(in srgb, var(--color-ink) 65%, transparent)",
                      }}
                    >
                      {t("fiscal.detail_seller_nit")}: {fullData.seller.nit}
                    </p>
                  </div>
                </InfoCard>

                {/* Items */}
                <section>
                  <h3
                    className="mb-2 text-body font-semibold"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("salesHistory.detail.items")}
                  </h3>
                  <div
                    className="overflow-hidden rounded-pos"
                    style={{
                      border:
                        "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
                    }}
                  >
                    <table className="w-full border-collapse text-body-sm">
                      <thead>
                        <tr
                          style={{
                            backgroundColor:
                              "color-mix(in srgb, var(--color-surface) 70%, white)",
                          }}
                        >
                          <th className="px-2 py-1.5 text-left text-caption font-semibold uppercase">
                            {t("salesHistory.detail.items_table_product")}
                          </th>
                          <th className="px-2 py-1.5 text-right text-caption font-semibold uppercase">
                            {t("salesHistory.detail.items_table_qty")}
                          </th>
                          <th className="px-2 py-1.5 text-right text-caption font-semibold uppercase">
                            {t("salesHistory.detail.items_table_price")}
                          </th>
                          <th className="px-2 py-1.5 text-right text-caption font-semibold uppercase">
                            {t("salesHistory.detail.items_table_total")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {fullData.lineItems.map((item) => (
                          <tr
                            key={item.productId}
                            style={{
                              borderBottom:
                                "1px solid color-mix(in srgb, var(--color-ink) 5%, transparent)",
                            }}
                          >
                            <td className="px-2 py-1.5">
                              <p
                                className="font-medium"
                                style={{ color: "var(--color-ink)" }}
                              >
                                {item.commercialName}
                              </p>
                              {item.genericName && (
                                <p
                                  className="text-caption"
                                  style={{
                                    color:
                                      "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                                  }}
                                >
                                  {item.genericName} {item.concentration}
                                </p>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right font-data tabular-nums">
                              {item.quantity}
                            </td>
                            <td className="px-2 py-1.5 text-right font-data tabular-nums">
                              {formatCurrency(item.unitPrice)}
                            </td>
                            <td className="px-2 py-1.5 text-right font-data tabular-nums font-semibold">
                              {formatCurrency(item.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Totals */}
                <div
                  className="rounded-pos p-3"
                  style={{
                    backgroundColor: "var(--color-panel)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
                  }}
                >
                  <div className="space-y-1 text-body-sm">
                    <div className="flex justify-between">
                      <span
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 65%, transparent)",
                        }}
                      >
                        {t("salesHistory.detail.totals_subtotal")}
                      </span>
                      <span
                        className="font-data tabular-nums"
                        style={{ color: "var(--color-ink)" }}
                      >
                        {formatCurrency(fullData.subtotal)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 65%, transparent)",
                        }}
                      >
                        {t("salesHistory.detail.totals_discount")}
                      </span>
                      <span
                        className="font-data tabular-nums"
                        style={{ color: "var(--color-ink)" }}
                      >
                        {formatCurrency(fullData.totalDiscount)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 65%, transparent)",
                        }}
                      >
                        {t("salesHistory.detail.totals_tax")}
                      </span>
                      <span
                        className="font-data tabular-nums"
                        style={{ color: "var(--color-ink)" }}
                      >
                        {formatCurrency(fullData.totalTax)}
                      </span>
                    </div>
                    <div
                      className="flex justify-between border-t pt-2"
                      style={{
                        borderColor:
                          "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                      }}
                    >
                      <span
                        className="font-semibold"
                        style={{ color: "var(--color-ink)" }}
                      >
                        {t("salesHistory.detail.totals_total")}
                      </span>
                      <span
                        className="font-data tabular-nums text-price font-bold"
                        style={{ color: "var(--color-ink)" }}
                      >
                        {formatCurrency(fullData.totalAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 65%, transparent)",
                        }}
                      >
                        {t("salesHistory.detail.totals_change")}
                      </span>
                      <span
                        className="font-data tabular-nums"
                        style={{ color: "var(--color-ink)" }}
                      >
                        {formatCurrency(fullData.changeAmount)}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="py-8 text-center">
                <p
                  className="text-body-sm"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  {t("salesHistory.detail.no_invoice")}
                </p>
              </div>
            )}
          </div>
        )}

        {viewMode === "operational" && (
          <div className="space-y-4">
            {operationalView ? (
              <>
                {/* Operational client */}
                <InfoCard
                  icon={<UserIcon className="size-4" />}
                  title={t("salesHistory.adjustment.client_change_label")}
                  action={
                    canModify ? (
                      <button
                        type="button"
                        onClick={onCreateAdjustment}
                        className="pos-button pos-button-secondary inline-flex items-center gap-1 py-1 px-2 text-caption"
                      >
                        <Edit3Icon className="size-3.5" aria-hidden="true" />
                        {t("salesHistory.detail.actions.adjust")}
                      </button>
                    ) : undefined
                  }
                >
                  <div className="space-y-1 text-caption">
                    <p
                      className="font-medium"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {operationalClient.name ??
                        sale.clientNameSnapshot ??
                        t("fiscal.client_final")}
                    </p>
                    {operationalClient.identificationType &&
                      operationalClient.identificationNumber && (
                        <p
                          className="font-data tabular-nums"
                          style={{
                            color:
                              "color-mix(in srgb, var(--color-ink) 65%, transparent)",
                          }}
                        >
                          {operationalClient.identificationType}:{" "}
                          {operationalClient.identificationNumber}
                        </p>
                      )}
                    {operationalClient.clientId && (
                      <p
                        className="font-data tabular-nums"
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 45%, transparent)",
                        }}
                      >
                        ID: {operationalClient.clientId}
                      </p>
                    )}
                  </div>
                  {hasOperationalDifferences && (
                    <div
                      className="mt-2 rounded-pos p-2 text-caption"
                      style={{
                        backgroundColor:
                          "color-mix(in srgb, var(--color-urgency) 8%, white)",
                        color: "var(--color-urgency)",
                      }}
                      role="status"
                    >
                      {t("salesHistory.detail.difference_banner")}
                    </div>
                  )}
                </InfoCard>

                {/* Contact info */}
                <InfoCard
                  icon={<MailIcon className="size-4" />}
                  title={t("salesHistory.detail.contact_title")}
                >
                  <div className="space-y-1 text-caption">
                    {operationalView.operational.contactInfo.email && (
                      <div className="flex items-center gap-1.5">
                        <MailIcon
                          className="size-3.5"
                          style={{
                            color:
                              "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                          }}
                          aria-hidden="true"
                        />
                        <span style={{ color: "var(--color-ink)" }}>
                          {operationalView.operational.contactInfo.email}
                        </span>
                      </div>
                    )}
                    {operationalView.operational.contactInfo.phone && (
                      <div className="flex items-center gap-1.5">
                        <PhoneIcon
                          className="size-3.5"
                          style={{
                            color:
                              "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                          }}
                          aria-hidden="true"
                        />
                        <span style={{ color: "var(--color-ink)" }}>
                          {operationalView.operational.contactInfo.phone}
                        </span>
                      </div>
                    )}
                    {operationalView.operational.contactInfo.address && (
                      <div className="flex items-center gap-1.5">
                        <MapPinIcon
                          className="size-3.5"
                          style={{
                            color:
                              "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                          }}
                          aria-hidden="true"
                        />
                        <span style={{ color: "var(--color-ink)" }}>
                          {operationalView.operational.contactInfo.address}
                        </span>
                      </div>
                    )}
                    {!operationalView.operational.contactInfo.email &&
                      !operationalView.operational.contactInfo.phone &&
                      !operationalView.operational.contactInfo.address && (
                        <p
                          style={{
                            color: "var(--color-ink-muted)",
                          }}
                        >
                          {t("fiscal.operational_no_contact")}
                        </p>
                      )}
                  </div>
                </InfoCard>

                {/* Payments */}
                <InfoCard
                  icon={<CreditCardIcon className="size-4" />}
                  title={t("salesHistory.detail.payments")}
                >
                  <div
                    className="overflow-hidden rounded-pos"
                    style={{
                      border:
                        "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
                    }}
                  >
                    <table className="w-full border-collapse text-caption">
                      <thead>
                        <tr
                          style={{
                            backgroundColor:
                              "color-mix(in srgb, var(--color-surface) 70%, white)",
                          }}
                        >
                          <th className="px-2 py-1 text-left text-caption font-semibold uppercase">
                            {t("salesHistory.detail.payments_table_method")}
                          </th>
                          <th className="px-2 py-1 text-right text-caption font-semibold uppercase">
                            {t("salesHistory.detail.payments_table_amount")}
                          </th>
                          <th className="px-2 py-1 text-right text-caption font-semibold uppercase">
                            {t("salesHistory.detail.payments_table_reference")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {operationalPayments.map((payment, idx) => (
                          <tr
                            key={`${payment.paymentMethodId}-${idx}`}
                            style={{
                              borderBottom:
                                "1px solid color-mix(in srgb, var(--color-ink) 5%, transparent)",
                            }}
                          >
                            <td className="px-2 py-1 font-medium">
                              {payment.paymentMethodName}
                            </td>
                            <td className="px-2 py-1 text-right font-data tabular-nums font-semibold">
                              {formatCurrency(payment.amount)}
                            </td>
                            <td className="px-2 py-1 text-right font-data tabular-nums">
                              {payment.transactionReference ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </InfoCard>

                {/* Delivery info */}
                {operationalView.operational.deliveryInfo && (
                  <InfoCard
                    icon={<TruckIcon className="size-4" />}
                    title={t("salesHistory.detail.delivery_title")}
                  >
                    <div className="space-y-1 text-caption">
                      {operationalView.operational.deliveryInfo.address && (
                        <p style={{ color: "var(--color-ink)" }}>
                          {operationalView.operational.deliveryInfo.address}
                        </p>
                      )}
                      {operationalView.operational.deliveryInfo.contactName && (
                        <p style={{ color: "var(--color-ink)" }}>
                          {operationalView.operational.deliveryInfo.contactName}
                        </p>
                      )}
                      {operationalView.operational.deliveryInfo
                        .contactPhone && (
                        <p style={{ color: "var(--color-ink)" }}>
                          {
                            operationalView.operational.deliveryInfo
                              .contactPhone
                          }
                        </p>
                      )}
                      {operationalView.operational.deliveryInfo
                        .scheduledDate && (
                        <p style={{ color: "var(--color-ink)" }}>
                          {formatShortDate(
                            operationalView.operational.deliveryInfo
                              .scheduledDate,
                          )}
                        </p>
                      )}
                      {operationalView.operational.deliveryInfo.notes && (
                        <p style={{ color: "var(--color-ink)" }}>
                          {operationalView.operational.deliveryInfo.notes}
                        </p>
                      )}
                      {detail.sale.delivery &&
                        detail.sale.delivery.feeCents > 0 && (
                          <p
                            className="font-data tabular-nums"
                            style={{ color: "var(--color-ink)" }}
                          >
                            {t("salesHistory.detail.delivery_fee")}:{" "}
                            {formatCurrency(
                              String(detail.sale.delivery.feeCents / 100),
                            )}
                          </p>
                        )}
                    </div>
                  </InfoCard>
                )}

                {/* Notes */}
                <InfoCard
                  icon={<StickyNoteIcon className="size-4" />}
                  title={t("salesHistory.detail.notes_title")}
                >
                  {operationalView.operational.notes.length > 0 ? (
                    <ul className="space-y-2">
                      {operationalView.operational.notes.map((note) => (
                        <li
                          key={note.id}
                          className="rounded-pos p-2 text-caption"
                          style={{
                            backgroundColor:
                              "color-mix(in srgb, var(--color-surface) 60%, white)",
                          }}
                        >
                          <p style={{ color: "var(--color-ink)" }}>
                            {note.text}
                          </p>
                          <p
                            className="mt-1 text-caption"
                            style={{
                              color:
                                "color-mix(in srgb, var(--color-ink) 45%, transparent)",
                            }}
                          >
                            {note.authorName} · {formatDateTime(note.createdAt)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p
                      style={{
                        color: "var(--color-ink-muted)",
                      }}
                    >
                      {t("fiscal.operational_no_notes")}
                    </p>
                  )}
                </InfoCard>

                {/* Tags */}
                <InfoCard
                  icon={<TagIcon className="size-4" />}
                  title={t("salesHistory.detail.tags_title")}
                >
                  {operationalView.operational.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {operationalView.operational.tags.map((tag) => (
                        <span
                          key={tag}
                          className="pos-badge"
                          style={{
                            backgroundColor:
                              "color-mix(in srgb, var(--color-pharma) 10%, white)",
                            color: "var(--color-pharma)",
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p
                      style={{
                        color: "var(--color-ink-muted)",
                      }}
                    >
                      {t("fiscal.operational_no_tags")}
                    </p>
                  )}
                </InfoCard>

                {/* Custom fields */}
                {Object.keys(operationalView.operational.customFields).length >
                  0 && (
                  <InfoCard
                    icon={<StickyNoteIcon className="size-4" />}
                    title={t("salesHistory.detail.custom_fields_title")}
                  >
                    <div className="grid grid-cols-2 gap-2 text-caption">
                      {Object.entries(
                        operationalView.operational.customFields,
                      ).map(([key, value]) => (
                        <div key={key}>
                          <span
                            style={{
                              color:
                                "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                            }}
                          >
                            {key}
                          </span>
                          <p
                            className="font-medium"
                            style={{ color: "var(--color-ink)" }}
                          >
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </InfoCard>
                )}

                {/* Adjustment history */}
                {adjustmentHistory.length > 0 && (
                  <section>
                    <h3
                      className="mb-2 text-body font-semibold"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {t("salesHistory.detail.adjustments")}
                    </h3>
                    <div
                      className="rounded-pos"
                      style={{
                        border:
                          "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
                      }}
                    >
                      <AdjustmentHistoryPanel
                        adjustments={adjustmentHistory}
                        isLoading={adjustmentHistoryLoading}
                      />
                    </div>
                  </section>
                )}
              </>
            ) : (
              <div className="py-8 text-center">
                <p
                  className="text-body-sm"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  {t("salesHistory.detail.no_operational_view")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer actions — reprint is read-only; cancel/adjust require modify permission */}
      <div
        className="flex items-center justify-end gap-2 border-t px-4 py-3"
        style={{
          borderColor: "color-mix(in srgb, var(--color-ink) 8%, transparent)",
        }}
      >
        {canModify && (
          <button
            type="button"
            onClick={onCancelInvoice}
            className="pos-button inline-flex items-center gap-1.5 py-1 px-3 text-body-sm"
            style={{
              backgroundColor: "var(--color-error-container)",
              color: "var(--color-error)",
              borderColor: "var(--color-error)",
              border: "1px solid",
            }}
          >
            <XIcon className="size-4" aria-hidden="true" />
            {t("salesHistory.detail.actions.cancel_invoice")}
          </button>
        )}
        <button
          type="button"
          onClick={onReprint}
          className="pos-button pos-button-secondary inline-flex items-center gap-1.5 py-1 px-3 text-body-sm"
        >
          <PrinterIcon className="size-4" aria-hidden="true" />
          {t("salesHistory.detail.actions.reprint")}
        </button>
        {canModify && (
          <button
            type="button"
            onClick={onCreateAdjustment}
            className="pos-button pos-button-primary inline-flex items-center gap-1.5 py-1 px-3 text-body-sm"
          >
            <Edit3Icon className="size-4" aria-hidden="true" />
            {t("salesHistory.detail.actions.adjust")}
          </button>
        )}
      </div>
    </div>
  );
};

interface InfoCardProps {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

const InfoCard: FC<InfoCardProps> = ({ icon, title, children, action }) => (
  <div
    className="rounded-pos p-3"
    style={{
      backgroundColor: "var(--color-panel)",
      border: "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
    }}
  >
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span style={{ color: "var(--color-pharma)" }}>{icon}</span>
        <h3
          className="text-body-sm font-semibold"
          style={{ color: "var(--color-ink)" }}
        >
          {title}
        </h3>
      </div>
      {action}
    </div>
    {children}
  </div>
);
