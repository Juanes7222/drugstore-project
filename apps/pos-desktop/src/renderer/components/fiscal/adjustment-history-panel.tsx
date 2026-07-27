/**
 * AdjustmentHistoryPanel — full chronological adjustment log for an invoice.
 *
 * Displays a vertical timeline with colour-coded entry types and a
 * "REVERSED" overlay on reversed entries. Supports CSV export via
 * the onExportCsv callback.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import type { AdjustmentHistoryEntry, AdjustmentType } from "../../../domain/fiscal/local-adjustment.types";

interface AdjustmentHistoryPanelProps {
  adjustments: AdjustmentHistoryEntry[];
  isLoading?: boolean;
  onExportCsv?: () => void;
}

const ADJUSTMENT_TYPE_COLORS: Record<AdjustmentType, string> = {
  PAYMENT_METHOD_CHANGE: "var(--color-pharma)",
  INTERNAL_NOTE: "var(--color-urgency)",
  CONTACT_UPDATE: "var(--color-sync)",
  CLIENT_CHANGE: "var(--color-pharma)",
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
    case "INTERNAL_NOTE":
      return "fiscal.adjustment_type_internal_note";
    case "CONTACT_UPDATE":
      return "fiscal.adjustment_type_contact_update";
    case "CLIENT_CHANGE":
      return "fiscal.adjustment_type_client_change";
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

/** Translate a payment-method category enum to its cashier-facing label.
 *  Falls back to the raw enum value when no translation key exists (e.g.
 *  legacy data using enum values no longer in the picker). */
const translatePaymentCategory = (
  category: string,
  t: (key: string) => string,
): string => {
  const key = `fiscal.adjustment_payment_method_${category.toLowerCase()}`;
  const translated = t(key);
  // i18next returns the key itself when the translation is missing —
  // surface the raw enum in that case rather than showing the key path.
  return translated === key ? category : translated;
};

const formatValue = (
  value: unknown,
  type: AdjustmentType,
  t: (key: string) => string,
): string => {
  if (value === null || value === undefined) return "—";
  // String values — INTERNAL_NOTE, TAG_ADD, TAG_REMOVE, or plain text
  if (typeof value === "string") return value || "—";
  if (typeof value !== "object") return String(value);

  const obj = value as Record<string, unknown>;

  switch (type) {
    case "PAYMENT_METHOD_CHANGE": {
      // previousValue: full fiscal payload { payments: [...], totalAmount }
      if ("payments" in obj && Array.isArray(obj.payments)) {
        const payments = obj.payments as Array<Record<string, unknown>>;
        return payments.length > 0
          ? payments
              .map((p) => {
                const name = String(p.paymentMethodName ?? "");
                const amt = Number(p.amount ?? 0).toLocaleString("es-CO", {
                  minimumFractionDigits: 2,
                });
                return name ? `${name} $${amt}` : `$${amt}`;
              })
              .join(", ")
          : "—";
      }
      // previousValue: direct array of payments
      if (Array.isArray(value)) {
        const payments = value as Array<Record<string, unknown>>;
        return payments.length > 0
          ? payments
              .map((p) => {
                const name = String(p.paymentMethodName ?? "");
                const amt = Number(p.amount ?? 0).toLocaleString("es-CO", {
                  minimumFractionDigits: 2,
                });
                return name ? `${name} $${amt}` : `$${amt}`;
              })
              .join(", ")
          : "—";
      }
      // newValue: override { paymentMethodName, category }
      if (
        "paymentMethodName" in obj &&
        typeof obj.paymentMethodName === "string"
      ) {
        const name = obj.paymentMethodName;
        const category = typeof obj.category === "string" ? obj.category : "";
        // Single readable line. Prefer the cashier-entered name; fall back
        // to the translated category for legacy entries that only stored
        // the enum value.
        if (name) return name;
        if (category) return translatePaymentCategory(category, t);
        return "—";
      }
      try {
        return JSON.stringify(value, null, 1);
      } catch {
        return String(value);
      }
    }

    case "CONTACT_UPDATE": {
      const parts: string[] = [];
      if (obj.email && typeof obj.email === "string")
        parts.push(`${t("clients.email")}: ${obj.email}`);
      if (obj.phone && typeof obj.phone === "string")
        parts.push(`${t("clients.phone")}: ${obj.phone}`);
      if (obj.address && typeof obj.address === "string")
        parts.push(`${t("clients.address")}: ${obj.address}`);
      return parts.length > 0 ? parts.join(" | ") : "—";
    }

    case "CLIENT_CHANGE": {
      const client = obj as {
        clientId?: string | null;
        name?: string | null;
        identificationType?: string | null;
        identificationNumber?: string | null;
      };
      const parts: string[] = [];
      if (client.name) {
        parts.push(`${t("clients.full_name")}: ${client.name}`);
      }
      if (client.identificationType && client.identificationNumber) {
        parts.push(
          `${t("clients.document")}: ${client.identificationType} ${client.identificationNumber}`,
        );
      }
      if (client.clientId) {
        parts.push(
          `${t("salesHistory.adjustment.client_id_label")}: ${client.clientId}`,
        );
      }
      return parts.length > 0 ? parts.join(" · ") : "—";
    }

    case "DELIVERY_INFO": {
      const parts: string[] = [];
      if (obj.address && typeof obj.address === "string")
        parts.push(`${t("clients.address")}: ${obj.address}`);
      if (obj.contactName && typeof obj.contactName === "string")
        parts.push(`Contacto: ${obj.contactName}`);
      if (obj.contactPhone && typeof obj.contactPhone === "string")
        parts.push(`${t("clients.phone")}: ${obj.contactPhone}`);
      if (
        obj.scheduledDate &&
        typeof obj.scheduledDate === "string" &&
        obj.scheduledDate
      )
        parts.push(
          `Programado: ${new Date(obj.scheduledDate).toLocaleString("es-CO")}`,
        );
      if (obj.notes && typeof obj.notes === "string" && obj.notes)
        parts.push(`Notas: ${obj.notes}`);
      return parts.length > 0 ? parts.join(" | ") : "—";
    }

    case "CUSTOM_FIELD_SET": {
      if (obj.key && typeof obj.key === "string") {
        return obj.value && typeof obj.value === "string"
          ? `${obj.key}: ${obj.value}`
          : String(obj.key);
      }
      try {
        return JSON.stringify(value, null, 1);
      } catch {
        return String(value);
      }
    }

    case "CUSTOM_FIELD_CLEAR": {
      if (obj.key && typeof obj.key === "string") return String(obj.key);
      try {
        return JSON.stringify(value, null, 1);
      } catch {
        return String(value);
      }
    }

    case "REVERSAL": {
      try {
        return JSON.stringify(value, null, 1);
      } catch {
        return String(value);
      }
    }

    // INTERNAL_NOTE, TAG_ADD, TAG_REMOVE — already handled as string above
    default: {
      try {
        return JSON.stringify(value, null, 1);
      } catch {
        return String(value);
      }
    }
  }
};

export const AdjustmentHistoryPanel: FC<AdjustmentHistoryPanelProps> = ({
  adjustments,
  isLoading = false,
  onExportCsv,
}) => {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();

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
              <AnimatePresence mode="popLayout">
                {adjustments.map((entry) => {
                  const dotColor = ADJUSTMENT_TYPE_COLORS[entry.adjustmentType] ?? "var(--color-sync)";
                  const isReversed = entry.isReversed;

                  return (
                    <motion.div
                      key={entry.id}
                      layout={!prefersReducedMotion}
                      initial={
                        prefersReducedMotion
                          ? {}
                          : { opacity: 0, x: -12 }
                      }
                      animate={{ opacity: 1, x: 0 }}
                      exit={
                        prefersReducedMotion
                          ? {}
                          : { opacity: 0, x: -12, height: 0, marginBottom: 0, overflow: "hidden" }
                      }
                      transition={{
                        opacity: { duration: 0.15, ease: "easeOut" },
                        x: {
                          type: "spring",
                          stiffness: 450,
                          damping: 30,
                          mass: 0.8,
                        },
                        layout: {
                          type: "spring",
                          stiffness: 400,
                          damping: 30,
                        },
                      }}
                      className="relative pl-10"
                      role="listitem"
                      aria-label={`${entry.actorName} — ${t(adjustmentTypeLabelKey(entry.adjustmentType))}`}
                    >
                      {/* Timeline dot — scales in with a slight delay */}
                      <motion.div
                        className="absolute left-2 top-1.5 h-3 w-3 rounded-full border-2"
                        style={{
                          backgroundColor: "var(--color-panel)",
                          borderColor: dotColor,
                        }}
                        initial={prefersReducedMotion ? false : { scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{
                          type: "spring",
                          stiffness: 500,
                          damping: 25,
                          mass: 0.6,
                          delay: prefersReducedMotion ? 0 : 0.06,
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
                                <span className="line-through">{formatValue(entry.previousValue, entry.adjustmentType, t)}</span>
                                <span aria-hidden="true">→</span>
                              </>
                            )}
                            {entry.newValue !== null && (
                              <span style={{ color: "var(--color-ink)" }}>
                                {formatValue(entry.newValue, entry.adjustmentType, t)}
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
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
