/**
 * Invoice list view — shows a sortable table of fiscal invoices.
 *
 * Extracted from the legacy fiscal.page.tsx. Each row is clickable and
 * expands to show the full InvoiceModel in a detail panel.
 */
import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { InvoiceListItem, InvoiceModel } from "../../../domain/fiscal/fiscal-types";

interface InvoiceListViewProps {
  invoices: InvoiceListItem[];
  onSelect: (invoice: InvoiceModel) => void;
  onRefresh: () => Promise<void>;
  isLoading?: boolean;
}

/**
 * Map an invoice status code to a Tailwind colour class pair.
 */
const STATUS_CLASSES: Record<string, string> = {
  CONTINGENCY_PENDING_TRANSMISSION: "text-amber-700 bg-amber-50",
  TRANSMITTED_AUTHORIZED: "text-green-700 bg-green-50",
  TRANSMITTED_REJECTED: "text-red-700 bg-red-50",
  EXPIRED_CONTINGENCY: "text-gray-600 bg-gray-100",
  CANCELLED: "text-gray-400 bg-gray-50",
};

/** Default fallback when status is unknown. */
const STATUS_FALLBACK_CLASS = "text-gray-700 bg-gray-100";

const statusColor = (status: string): string =>
  STATUS_CLASSES[status] ?? STATUS_FALLBACK_CLASS;

export const InvoiceListView: FC<InvoiceListViewProps> = ({
  invoices,
  onSelect,
  onRefresh,
  isLoading = false,
}) => {
  const { t } = useTranslation();

  const handleRowClick = useCallback(
    async (inv: InvoiceListItem) => {
      // The parent page is responsible for wiring the invoice service;
      // this component just fires the select callback with the list item.
      // Full invoice loading happens upstream.
      // For now, we just pass the identifier and let the parent resolve.
      // The actual full InvoiceModel resolution is done in the page wiring.
      onSelect(inv as unknown as InvoiceModel);
    },
    [onSelect],
  );

  const statusLabel = (status: string): string => {
    switch (status) {
      case "CONTINGENCY_PENDING_TRANSMISSION":
        return t("fiscal.status_pending");
      case "TRANSMITTED_AUTHORIZED":
        return t("fiscal.status_authorized");
      case "TRANSMITTED_REJECTED":
        return t("fiscal.status_rejected");
      case "EXPIRED_CONTINGENCY":
        return t("fiscal.status_expired");
      case "CANCELLED":
        return t("fiscal.status_cancelled");
      default:
        return status;
    }
  };

  const typeLabel = (invoiceType: string): string => {
    switch (invoiceType) {
      case "CREDIT_NOTE":
        return t("fiscal.type_nc");
      case "CONTINGENCY_CANCELLATION":
        return t("fiscal.type_an");
      default:
        return t("fiscal.type_fe");
    }
  };

  const formatAmount = (amount: string): string =>
    `${Number(amount).toLocaleString("es-CO", {
      minimumFractionDigits: 2,
    })}`;

  const formatDate = (dateStr: string): string =>
    new Date(dateStr).toLocaleDateString("es-CO");

  return (
    <div className="pos-panel" role="region" aria-label={t("fiscal.invoices_title")}>
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
        <h2 className="text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
          {t("fiscal.invoices_title")}
        </h2>
        <button
          type="button"
          className="pos-button pos-button-secondary px-3 py-1 text-caption"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label={t("fiscal.refresh")}
        >
          {t("fiscal.refresh")}
        </button>
      </div>

      {invoices.length === 0 ? (
        <div className="px-4 py-12 text-center text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 40%, transparent)" }}>
          {t("fiscal.no_invoices")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y text-body-sm" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }} role="table" aria-label={t("fiscal.invoices_title")}>
            <thead>
              <tr>
                <th scope="col" className="px-4 py-2 text-left text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_number")}
                </th>
                <th scope="col" className="px-4 py-2 text-left text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_type")}
                </th>
                <th scope="col" className="px-4 py-2 text-left text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_client")}
                </th>
                <th scope="col" className="px-4 py-2 text-right text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_total")}
                </th>
                <th scope="col" className="px-4 py-2 text-left text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_status")}
                </th>
                <th scope="col" className="px-4 py-2 text-left text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_issued")}
                </th>
                <th scope="col" className="px-4 py-2 text-left text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_expires")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 6%, transparent)" }}>
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className="cursor-pointer transition-colors hover:bg-surface"
                  style={{ backgroundColor: "color-mix(in srgb, var(--color-surface) 30%, white)" }}
                  onClick={() => { void handleRowClick(inv); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void handleRowClick(inv);
                    }
                  }}
                  tabIndex={0}
                  role="row"
                  aria-label={`${t("fiscal.table_number")} ${inv.contingencyNumber ?? inv.invoiceNumber}`}
                >
                  <td className="whitespace-nowrap px-4 py-3 font-data text-caption" style={{ color: "var(--color-ink)" }}>
                    {inv.contingencyNumber ?? inv.invoiceNumber}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
                    {typeLabel(inv.invoiceType)}
                  </td>
                  <td className="max-w-48 truncate px-4 py-3 text-body-sm" style={{ color: "var(--color-ink)" }}>
                    {inv.clientName || t("fiscal.client_final")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-data tabular-nums text-right text-body-sm" style={{ color: "var(--color-ink)" }}>
                    ${formatAmount(inv.totalAmount)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`pos-badge ${statusColor(inv.status)}`}>
                      {statusLabel(inv.status)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
                    {formatDate(inv.issuedAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
                    {inv.expiresAt ? formatDate(inv.expiresAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
