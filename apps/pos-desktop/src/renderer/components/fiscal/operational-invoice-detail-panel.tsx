/**
 * OperationalInvoiceDetailPanel — right panel in the dual-panel detail view.
 *
 * Shows the operational/adjustment-projected view of an invoice: payment method
 * comparison, internal notes, tags, contact info, delivery info, custom fields.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type {
  OperationalInvoiceView,
  OperationalNote,
} from "../../../domain/fiscal/local-adjustment.types";
import type { InvoicePayment } from "../../../domain/fiscal/fiscal-types";

interface OperationalInvoiceDetailPanelProps {
  operationalView: OperationalInvoiceView;
  adjustmentCount: number;
  isLoading?: boolean;
}

const formatAmount = (amount: string): string =>
  `${Number(amount).toLocaleString("es-CO", {
    minimumFractionDigits: 2,
  })}`;

export const OperationalInvoiceDetailPanel: FC<OperationalInvoiceDetailPanelProps> = ({
  operationalView,
  adjustmentCount,
  isLoading = false,
}) => {
  const { t } = useTranslation();
  const { fiscal, operational } = operationalView;

  if (isLoading) {
    return (
      <section
        className="flex h-full items-center justify-center"
        aria-label={t("fiscal.operational_title")}
        style={{ backgroundColor: "var(--color-panel)" }}
      >
        <div className="text-center">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-pharma border-r-transparent" />
          <p className="text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
            {t("common.loading")}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="flex h-full flex-col overflow-y-auto"
      aria-label={t("fiscal.operational_title")}
      style={{ backgroundColor: "var(--color-panel)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
        <h2 className="text-ui font-semibold" style={{ color: "var(--color-ink)" }}>
          {t("fiscal.operational_title")}
        </h2>
        <span
          className="pos-badge text-caption"
          style={{
            backgroundColor: adjustmentCount > 0 ? "var(--color-urgency-surface)" : "color-mix(in srgb, var(--color-pharma) 8%, white)",
            color: adjustmentCount > 0 ? "var(--color-urgency)" : "var(--color-pharma)",
          }}
          aria-label={`${adjustmentCount} ${t("fiscal.operational_adjustments")}`}
        >
          {adjustmentCount} {t("fiscal.operational_adjustments")}
        </span>
      </div>

      {/* Differences banner */}
      {operational.hasDifferences && (
        <div
          className="mx-4 mt-3 rounded-pos px-3 py-2 text-caption font-medium"
          style={{
            backgroundColor: "var(--color-urgency-surface)",
            color: "var(--color-urgency)",
          }}
          role="status"
        >
          {t("fiscal.operational_has_differences")}
        </div>
      )}

      <div className="flex flex-col gap-3 p-4 text-body-sm">
        {/* Payment methods comparison */}
        <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
          <h3 className="text-caption font-bold uppercase tracking-wide mb-2" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
            {t("fiscal.operational_payments_title")}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-caption" role="table" aria-label={t("fiscal.operational_payments_title")}>
              <thead>
                <tr className="text-left" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}>
                  <th scope="col" className="pr-2 pb-1 font-medium">{t("fiscal.detail_payment_method")}</th>
                  <th scope="col" className="px-2 pb-1 text-right font-medium">{t("fiscal.operational_fiscal")}</th>
                  <th scope="col" className="pl-2 pb-1 text-right font-medium">{t("fiscal.operational_operational")}</th>
                </tr>
              </thead>
              <tbody>
                {operational.payments.map((opPmt: InvoicePayment, idx: number) => {
                  const fiscalPmt: InvoicePayment | undefined =
                    fiscal.fullData.payments[idx];
                  const isDifferent =
                    fiscalPmt !== undefined &&
                    (fiscalPmt.amount !== opPmt.amount ||
                      fiscalPmt.paymentMethodName !== opPmt.paymentMethodName);
                  return (
                    <tr
                      key={idx}
                      style={{
                        color: "var(--color-ink)",
                        ...(isDifferent
                          ? { backgroundColor: "var(--color-urgency-surface)" }
                          : {}),
                      }}
                    >
                      <td className="pr-2 py-1 font-medium">
                        {opPmt.paymentMethodName}
                      </td>
                      <td className="px-2 py-1 text-right font-data tabular-nums">
                        {fiscalPmt !== undefined
                          ? `$${formatAmount(fiscalPmt.amount)}`
                          : "—"}
                      </td>
                      <td
                        className="px-2 py-1 text-right font-data tabular-nums font-semibold"
                        style={{
                          color: isDifferent
                            ? "var(--color-urgency)"
                            : "var(--color-ink)",
                        }}
                      >
                        ${formatAmount(opPmt.amount)}
                      </td>
                    </tr>
                  );
                })}
                {operational.payments.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="py-2 text-center text-caption"
                      style={{
                        color:
                          "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                      }}
                    >
                      {t("fiscal.detail_payment_method")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Internal notes */}
        <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
          <h3 className="text-caption font-bold uppercase tracking-wide mb-2" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
            {t("fiscal.operational_notes")}
          </h3>
          {operational.notes.length > 0 ? (
            <div className="space-y-2">
              {operational.notes.map((note: OperationalNote) => (
                <div
                  key={note.id}
                  className="rounded-pos p-2 text-caption"
                  style={{
                    backgroundColor: "var(--color-urgency-surface)",
                    borderLeft: "3px solid var(--color-urgency)",
                  }}
                >
                  <p className="italic" style={{ color: "var(--color-ink)" }}>
                    {note.text}
                  </p>
                  <p
                    className="mt-1 text-caption"
                    style={{
                      color:
                        "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                    }}
                  >
                    — {note.authorName},{" "}
                    {new Date(note.createdAt).toLocaleString("es-CO")}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p
              className="text-caption italic"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 40%, transparent)",
              }}
            >
              {t("fiscal.operational_no_notes")}
            </p>
          )}
        </div>

        {/* Tags */}
        <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
          <h3 className="text-caption font-bold uppercase tracking-wide mb-2" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
            {t("fiscal.operational_tags")}
          </h3>
          {operational.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {operational.tags.map((tag: string, idx: number) => (
                <span
                  key={idx}
                  className="pos-badge text-caption"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--color-sync) 10%, white)",
                    color: "var(--color-sync)",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <p
              className="text-caption italic"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 40%, transparent)",
              }}
            >
              {t("fiscal.operational_no_tags")}
            </p>
          )}
        </div>

        {/* Contact info */}
        <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
          <h3 className="text-caption font-bold uppercase tracking-wide mb-1" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
            {t("fiscal.operational_contact")}
          </h3>
          {operational.contactInfo.email ||
          operational.contactInfo.phone ||
          operational.contactInfo.address ? (
            <div className="space-y-0.5 text-caption" style={{ color: "var(--color-ink)" }}>
              {operational.contactInfo.email && (
                <p>
                  <span className="font-medium">Email:</span>{" "}
                  {operational.contactInfo.email}
                </p>
              )}
              {operational.contactInfo.phone && (
                <p>
                  <span className="font-medium">Tel:</span>{" "}
                  {operational.contactInfo.phone}
                </p>
              )}
              {operational.contactInfo.address && (
                <p>
                  <span className="font-medium">Dir:</span>{" "}
                  {operational.contactInfo.address}
                </p>
              )}
            </div>
          ) : (
            <p
              className="text-caption italic"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 40%, transparent)",
              }}
            >
              {t("fiscal.operational_no_contact")}
            </p>
          )}
        </div>

        {/* Delivery info */}
        <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
          <h3 className="text-caption font-bold uppercase tracking-wide mb-1" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
            {t("fiscal.operational_delivery")}
          </h3>
          {operational.deliveryInfo !== null ? (
            <div className="space-y-0.5 text-caption" style={{ color: "var(--color-ink)" }}>
              {operational.deliveryInfo.address && (
                <p>
                  <span className="font-medium">Dir:</span>{" "}
                  {operational.deliveryInfo.address}
                </p>
              )}
              {operational.deliveryInfo.contactName && (
                <p>
                  <span className="font-medium">Contacto:</span>{" "}
                  {operational.deliveryInfo.contactName}
                </p>
              )}
              {operational.deliveryInfo.contactPhone && (
                <p>
                  <span className="font-medium">Tel:</span>{" "}
                  {operational.deliveryInfo.contactPhone}
                </p>
              )}
              {operational.deliveryInfo.scheduledDate && (
                <p>
                  <span className="font-medium">Programado:</span>{" "}
                  {new Date(
                    operational.deliveryInfo.scheduledDate,
                  ).toLocaleString("es-CO")}
                </p>
              )}
              {operational.deliveryInfo.notes && (
                <p>
                  <span className="font-medium">Notas:</span>{" "}
                  {operational.deliveryInfo.notes}
                </p>
              )}
            </div>
          ) : (
            <p
              className="text-caption italic"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 40%, transparent)",
              }}
            >
              {t("fiscal.operational_no_delivery")}
            </p>
          )}
        </div>

        {/* Custom fields */}
        <div className="border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
          <h3 className="text-caption font-bold uppercase tracking-wide mb-1" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
            {t("fiscal.operational_custom_fields")}
          </h3>
          {Object.keys(operational.customFields).length > 0 ? (
            <div className="space-y-0.5 text-caption" style={{ color: "var(--color-ink)" }}>
              {Object.entries(operational.customFields).map(
                ([key, value]: [string, string]) => (
                  <p key={key}>
                    <span className="font-medium">{key}:</span> {value}
                  </p>
                ),
              )}
            </div>
          ) : (
            <p
              className="text-caption italic"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 40%, transparent)",
              }}
            >
              {t("fiscal.operational_no_custom_fields")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
