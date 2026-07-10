/**
 * CashierOperationalView — compact read-only view for the cashier's
 * invoice lookup screen.
 *
 * In compact mode shows a small card with the most relevant operational
 * differences: payment method changes, internal notes, and tags.
 * Full mode mirrors the management panel but without management controls.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type {
  OperationalInvoiceView,
  OperationalNote,
} from "../../../domain/fiscal/local-adjustment.types";
import type { InvoicePayment } from "../../../domain/fiscal/fiscal-types";

interface CashierOperationalViewProps {
  operationalView: OperationalInvoiceView;
  compact?: boolean;
}

const formatAmount = (amount: string): string =>
  `${Number(amount).toLocaleString("es-CO", {
    minimumFractionDigits: 2,
  })}`;

export const CashierOperationalView: FC<CashierOperationalViewProps> = ({
  operationalView,
  compact = true,
}) => {
  const { t } = useTranslation();
  const { fiscal, operational } = operationalView;
  const hasContent = operational.hasDifferences;

  if (compact) {
    return (
      <section
        className="rounded-pos overflow-hidden"
        aria-label={t("fiscal.cashier_operational_title")}
        style={{
          backgroundColor: hasContent
            ? "var(--color-urgency-surface)"
            : "color-mix(in srgb, var(--color-pharma) 6%, white)",
          border: `1px solid ${
            hasContent
              ? "var(--color-urgency)"
              : "color-mix(in srgb, var(--color-pharma) 20%, transparent)"
          }`,
        }}
      >
        {/* Header */}
        <div
          className="px-3 py-2 text-caption font-semibold uppercase tracking-wide"
          style={{
            color: hasContent ? "var(--color-urgency)" : "var(--color-pharma)",
            backgroundColor: hasContent
              ? "color-mix(in srgb, var(--color-urgency) 8%, white)"
              : "color-mix(in srgb, var(--color-pharma) 6%, white)",
          }}
        >
          {t("fiscal.cashier_operational_title")}
          {hasContent && (
            <span
              className="ml-2 text-caption normal-case"
              style={{ color: "var(--color-urgency)" }}
            >
              ({t("fiscal.cashier_compact")})
            </span>
          )}
        </div>

        {!hasContent ? (
          <div
            className="px-3 py-2 text-caption italic"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 45%, transparent)",
            }}
          >
            {t("fiscal.operational_has_differences")}
          </div>
        ) : (
          <div className="space-y-2 px-3 py-2 text-caption">
            {/* Payment method changes */}
            {operational.payments.length > 0 && (
              <div>
                <span className="font-semibold" style={{ color: "var(--color-ink)" }}>
                  {t("fiscal.operational_payments_title")}:
                </span>
                <div className="mt-0.5 space-y-0.5">
                  {operational.payments.map(
                    (pmt: InvoicePayment, idx: number) => {
                      const fiscalPmt:
                        | InvoicePayment
                        | undefined =
                        fiscal.fullData.payments[idx];
                      const isDifferent =
                        fiscalPmt !== undefined &&
                        (fiscalPmt.amount !== pmt.amount ||
                          fiscalPmt.paymentMethodName !==
                            pmt.paymentMethodName);
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-2 font-data tabular-nums"
                          style={{
                            color: isDifferent
                              ? "var(--color-urgency)"
                              : "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                          }}
                        >
                          <span>{pmt.paymentMethodName}</span>
                          <span>
                            {fiscalPmt !== undefined && isDifferent ? (
                              <>
                                <span className="line-through">
                                  ${formatAmount(fiscalPmt.amount)}
                                </span>
                                {" → "}
                                <span className="font-semibold">
                                  ${formatAmount(pmt.amount)}
                                </span>
                              </>
                            ) : (
                              `$${formatAmount(pmt.amount)}`
                            )}
                          </span>
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            )}

            {/* Internal notes count */}
            {operational.notes.length > 0 && (
              <div>
                <span className="font-semibold" style={{ color: "var(--color-ink)" }}>
                  {t("fiscal.operational_notes")}:
                </span>
                <span
                  className="ml-1"
                  style={{
                    color:
                      "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                  }}
                >
                  {operational.notes.length}
                </span>
              </div>
            )}

            {/* Tags */}
            {operational.tags.length > 0 && (
              <div>
                <span className="font-semibold" style={{ color: "var(--color-ink)" }}>
                  {t("fiscal.operational_tags")}:
                </span>
                <div className="mt-0.5 flex flex-wrap gap-1">
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
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  // ------------------------------------------------------------------
  // Full (non-compact) mode — similar to OperationalInvoiceDetailPanel
  // but without management controls
  // ------------------------------------------------------------------
  return (
    <section
      className="rounded-pos overflow-hidden"
      aria-label={t("fiscal.cashier_operational_title")}
      style={{
        backgroundColor: "var(--color-panel)",
        border:
          "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{
          borderColor:
            "color-mix(in srgb, var(--color-ink) 10%, transparent)",
        }}
      >
        <h3
          className="text-ui font-semibold"
          style={{ color: "var(--color-ink)" }}
        >
          {t("fiscal.cashier_operational_title")}
        </h3>
        <span
          className="text-caption"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
          }}
        >
          {t("fiscal.cashier_full")}
        </span>
      </div>

      <div className="space-y-3 p-4 text-body-sm">
        {/* Payment methods comparison */}
        <div>
          <h4
            className="mb-2 text-caption font-bold uppercase tracking-wide"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
            }}
          >
            {t("fiscal.operational_payments_title")}
          </h4>
          <div className="overflow-x-auto">
            <table
              className="w-full text-caption"
              role="table"
              aria-label={t("fiscal.operational_payments_title")}
            >
              <thead>
                <tr
                  className="text-left"
                  style={{
                    color:
                      "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                  }}
                >
                  <th scope="col" className="pr-2 pb-1 font-medium">
                    {t("fiscal.detail_payment_method")}
                  </th>
                  <th scope="col" className="px-2 pb-1 text-right font-medium">
                    {t("fiscal.operational_fiscal")}
                  </th>
                  <th scope="col" className="pl-2 pb-1 text-right font-medium">
                    {t("fiscal.operational_operational")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {operational.payments.map(
                  (opPmt: InvoicePayment, idx: number) => {
                    const fiscalPmt:
                      | InvoicePayment
                      | undefined =
                      fiscal.fullData.payments[idx];
                    const isDifferent =
                      fiscalPmt !== undefined &&
                      (fiscalPmt.amount !== opPmt.amount ||
                        fiscalPmt.paymentMethodName !==
                          opPmt.paymentMethodName);
                    return (
                      <tr
                        key={idx}
                        style={{
                          color: "var(--color-ink)",
                          ...(isDifferent
                            ? {
                                backgroundColor:
                                  "var(--color-urgency-surface)",
                              }
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
                  },
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Internal notes */}
        <div>
          <h4
            className="mb-1 text-caption font-bold uppercase tracking-wide"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
            }}
          >
            {t("fiscal.operational_notes")}
          </h4>
          {operational.notes.length > 0 ? (
            <div className="space-y-1">
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
        <div>
          <h4
            className="mb-1 text-caption font-bold uppercase tracking-wide"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
            }}
          >
            {t("fiscal.operational_tags")}
          </h4>
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
        <div>
          <h4
            className="mb-1 text-caption font-bold uppercase tracking-wide"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
            }}
          >
            {t("fiscal.operational_contact")}
          </h4>
          {operational.contactInfo.email ||
          operational.contactInfo.phone ||
          operational.contactInfo.address ? (
            <div
              className="space-y-0.5 text-caption"
              style={{ color: "var(--color-ink)" }}
            >
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
      </div>
    </section>
  );
};
