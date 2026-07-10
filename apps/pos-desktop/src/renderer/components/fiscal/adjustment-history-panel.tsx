/**
 * AdjustmentHistoryPanel — full chronological adjustment log for an invoice.
 *
 * Displays a vertical timeline with colour-coded entry types and a
 * "REVERSED" overlay on reversed entries. Supports CSV export via
 * the onExportCsv callback.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import type { AdjustmentHistoryEntry, AdjustmentType } from "../../../domain/fiscal/local-adjustment.types";

interface AdjustmentHistoryPanelProps {
  adjustments: AdjustmentHistoryEntry[];
  isLoading?: boolean;
  onExportCsv?: () => void;
}

const ADJUSTMENT_TYPE_COLORS: Record<AdjustmentType, string> = {
  PAYMENT_METHOD_CHANGE: "var(--color-pharma)",
  PAYMENT_SPLIT_CHANGE: "var(--color-pharma)",
  INTERNAL_NOTE: "var(--color-urgency)",
  CONTACT_UPDATE: "var(--color-sync)",
  DELIVERY_INFO: "var(--color-sync)",
  TAG_ADD: "var(--color-pharma)",
  TAG_REMOVE: "#D32F2F",
  CUSTOM_FIELD_SET: "var(--color-sync)",
  CUSTOM_FIELD_CLEAR: "#D32F2F",
  REVERSAL: "var(--color-restrict)",
};

const adjustmentTypeLabelKey = (type: AdjustmentType): string => {
  switch (type) {
    case "PAYMENT_METHOD_CHANGE":
      return "fiscal.adjustment_type_payment_method_change";
    case "PAYMENT_SPLIT_CHANGE":
      return "fiscal.adjustment_type_payment_split_change";
    case "INTERNAL_NOTE":
      return "fiscal.adjustment_type_internal_note";
    case "CONTACT_UPDATE":
      return "fiscal.adjustment_type_contact_update";
    case "DELIVERY_INFO":
      return "fiscal.adjustment_type_delivery_info";
    case "TAG_ADD":
      return "fiscal.adjustment_type_tag_add";
    case "TAG_REMOVE":
      return "fiscal.adjustment_type_tag_remove";
    case "CUSTOM_FIELD_SET":
      return "fiscal.adjustment_type_custom_field_set";
    case "CUSTOM_FIELD_CLEAR":
      return "fiscal.adjustment_type_custom_field_clear";
    case "REVERSAL":
      return "fiscal.adjustment_type_reversal";
    default:
      return type;
  }
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 1);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

export const AdjustmentHistoryPanel: FC<AdjustmentHistoryPanelProps> = ({
  adjustments,
  isLoading = false,
  onExportCsv,
}) => {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <section
        className="flex h-full items-center justify-center"
        aria-label={t("fiscal.adjustment_title")}
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
      aria-label={t("fiscal.adjustment_title")}
      style={{ backgroundColor: "var(--color-panel)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
        <h2 className="text-ui font-semibold" style={{ color: "var(--color-ink)" }}>
          {t("fiscal.adjustment_title")}
        </h2>
        {onExportCsv && adjustments.length > 0 && (
          <button
            type="button"
            className="pos-button pos-button-secondary px-3 py-1 text-caption"
            onClick={onExportCsv}
            aria-label={t("fiscal.action_export_csv")}
          >
            {t("fiscal.action_export_csv")}
          </button>
        )}
      </div>

      {adjustments.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 40%, transparent)" }}>
            {t("fiscal.adjustment_no_entries")}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="relative" role="list" aria-label={t("fiscal.adjustment_title")}>
            {/* Vertical timeline line */}
            <div
              className="absolute left-3.5 top-2 bottom-2 w-0.5"
              style={{ backgroundColor: "color-mix(in srgb, var(--color-ink) 15%, transparent)" }}
              aria-hidden="true"
            />

            <div className="space-y-4">
              {adjustments.map((entry, idx) => {
                const dotColor = ADJUSTMENT_TYPE_COLORS[entry.adjustmentType] ?? "var(--color-sync)";
                const isReversed = entry.isReversed;

                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: idx * 0.03 }}
                    className="relative pl-10"
                    role="listitem"
                    aria-label={`${entry.actorName} — ${t(adjustmentTypeLabelKey(entry.adjustmentType))}`}
                  >
                    {/* Timeline dot */}
                    <div
                      className="absolute left-2 top-1.5 h-3 w-3 rounded-full border-2"
                      style={{
                        backgroundColor: "var(--color-panel)",
                        borderColor: dotColor,
                      }}
                      aria-hidden="true"
                    />

                    {/* Content card */}
                    <div
                      className="relative rounded-pos p-3 text-body-sm"
                      style={{
                        backgroundColor: isReversed
                          ? "color-mix(in srgb, var(--color-restrict) 6%, white)"
                          : "color-mix(in srgb, var(--color-surface) 50%, white)",
                        borderLeft: `3px solid ${dotColor}`,
                        opacity: isReversed ? 0.7 : 1,
                        ...(isReversed ? { textDecoration: "line-through" } : {}),
                      }}
                    >
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-body-sm" style={{ color: "var(--color-ink)" }}>
                            {entry.actorName}
                          </span>
                          <span
                            className="pos-badge text-caption"
                            style={{
                              backgroundColor: `color-mix(in srgb, ${dotColor} 12%, white)`,
                              color: dotColor,
                            }}
                          >
                            {t(adjustmentTypeLabelKey(entry.adjustmentType))}
                          </span>
                          {isReversed && (
                            <span
                              className="pos-badge text-caption"
                              style={{
                                backgroundColor: "var(--color-restrict-surface)",
                                color: "var(--color-restrict)",
                              }}
                            >
                              {t("fiscal.adjustment_reversed")}
                            </span>
                          )}
                        </div>
                        <span className="text-caption whitespace-nowrap" style={{ color: "color-mix(in srgb, var(--color-ink) 45%, transparent)" }}>
                          {new Date(entry.createdAt).toLocaleString("es-CO")}
                        </span>
                      </div>

                      {/* Value change */}
                      {(entry.previousValue !== null || entry.newValue !== null) && (
                        <div className="mt-1 flex items-start gap-2 text-caption font-data" style={{ color: "color-mix(in srgb, var(--color-ink) 65%, transparent)" }}>
                          {entry.previousValue !== null && (
                            <>
                              <span className="line-through">{formatValue(entry.previousValue)}</span>
                              <span aria-hidden="true">→</span>
                            </>
                          )}
                          {entry.newValue !== null && (
                            <span style={{ color: "var(--color-ink)" }}>
                              {formatValue(entry.newValue)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Reason */}
                      {entry.reason && (
                        <p className="mt-1 text-caption font-medium" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
                          {t("fiscal.adjustment_reason")}: {entry.reason}
                        </p>
                      )}

                      {/* Reversal-of indicator */}
                      {entry.reversalOfAdjustmentId && (
                        <p className="mt-1 text-caption" style={{ color: "var(--color-restrict)" }}>
                          {t("fiscal.adjustment_type_reversal")}: {entry.reversalOfAdjustmentId}
                        </p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
