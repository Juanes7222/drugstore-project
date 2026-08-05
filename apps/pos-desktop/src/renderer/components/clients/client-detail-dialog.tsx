/**
 * Client details dialog — read-only overlay modal.
 *
 * Opens when a client row is clicked so the cashier can inspect all fields
 * at a glance without entering the edit panel. It also shows the client's
 * recent confirmed sales (number, date, invoice, total) loaded from the
 * local sales history service. Uses Radix Dialog for focus-trapping,
 * Esc-to-close, and ARIA compliance, animated with motion (fade + scale)
 * and respecting prefers-reduced-motion. The "Edit" action hands off to
 * the slide-in edit panel.
 */
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import {
  BuildingIcon,
  CalendarIcon,
  ClockIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  ReceiptIcon,
  XIcon,
} from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";
import { formatShortDate } from "@/utils/format-date";
import { useSalesHistoryService } from "../common/service-context";
import type { ClientSearchResult } from "../../../domain/clients/clients.service";
import type { SaleHistoryListItem } from "../../../domain/sales-pos/sales-history.service";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClientDetailDialogProps {
  client: ClientSearchResult | null;
  onClose: () => void;
  onEdit: (client: ClientSearchResult) => void;
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const contentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
};

// ---------------------------------------------------------------------------
// Formatters (mirrors the sales-history module conventions)
// ---------------------------------------------------------------------------

const formatSaleAmount = (amount: string, locale: string): string => {
  const n = Number(amount);
  if (Number.isNaN(n)) return amount;
  return `$${n.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatSaleDate = (iso: string, locale: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ClientDetailDialog: FC<ClientDetailDialogProps> = ({
  client,
  onClose,
  onEdit,
}) => {
  const { t, i18n } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const isOpen = client !== null;
  const locale = i18n.language === "en" ? "en-US" : "es-CO";

  // ---- Sales history (recent confirmed sales for this client) ----
  const salesHistoryService = useSalesHistoryService();
  const [sales, setSales] = useState<SaleHistoryListItem[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesFailed, setSalesFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const clientId = client?.id;
    if (!clientId) {
      setSales([]);
      setSalesTotal(0);
      setSalesFailed(false);
      setSalesLoading(false);
      return;
    }

    setSalesLoading(true);
    setSalesFailed(false);
    void salesHistoryService
      .listConfirmedSales({ clientId, limit: 5 })
      .then((result) => {
        if (cancelled) return;
        setSales(result.items);
        setSalesTotal(result.total);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[ClientDetailDialog] sales history failed:", err);
        setSales([]);
        setSalesTotal(0);
        setSalesFailed(true);
      })
      .finally(() => {
        if (!cancelled) setSalesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client?.id, salesHistoryService]);

  const city = [client?.municipality, client?.department].filter(Boolean).join(", ") || "—";

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {client && (
        <Dialog.Portal>
          {/* Overlay */}
          <Dialog.Overlay asChild>
            <motion.div
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
              variants={overlayVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              transition={{ duration: shouldReduceMotion ? 0.01 : 0.2 }}
            />
          </Dialog.Overlay>

          {/* Content */}
          <Dialog.Content asChild>
            <motion.div
              className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2"
              variants={contentVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              transition={{
                duration: shouldReduceMotion ? 0.01 : 0.2,
                ease: "easeOut",
              }}
            >
              <div
                className="max-h-[calc(100dvh-2.5rem)] overflow-y-auto rounded-md bg-white p-6 shadow-lg"
                style={{
                  border:
                    "1px solid color-mix(in srgb, var(--color-pharma) 18%, transparent)",
                }}
              >
                {/* ===== Header: eyebrow + avatar + name + status + close ===== */}
                <p
                  className="mb-1 text-caption font-semibold uppercase tracking-wider"
                  style={{ color: "color-mix(in srgb, var(--color-pharma) 75%, transparent)" }}
                >
                  {t("clients.details")}
                </p>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className="flex size-11 shrink-0 items-center justify-center rounded-full text-body font-bold"
                      style={{
                        backgroundColor:
                          "color-mix(in srgb, var(--color-pharma) 10%, transparent)",
                        color: "var(--color-pharma)",
                      }}
                    >
                      {client.fullName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <Dialog.Title
                        className="m-0 truncate text-body font-semibold"
                        style={{ color: "var(--color-ink)" }}
                      >
                        {client.fullName}
                      </Dialog.Title>
                      <Dialog.Description
                        className="mt-1 flex items-center gap-1.5 text-body-sm"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        <span
                          className="rounded-sm px-1 py-0.5 font-semibold uppercase"
                          style={{
                            backgroundColor:
                              "color-mix(in srgb, var(--color-ink) 7%, transparent)",
                            fontSize: "0.625rem",
                          }}
                        >
                          {client.identificationType}
                        </span>
                        <span className="font-data tabular-nums">
                          {client.identificationNumber}
                        </span>
                      </Dialog.Description>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {/* Status badge */}
                    <span
                      className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-caption font-semibold"
                      style={{
                        backgroundColor: client.isActive
                          ? "color-mix(in srgb, var(--color-pharma) 10%, transparent)"
                          : "color-mix(in srgb, var(--color-ink) 7%, transparent)",
                        color: client.isActive
                          ? "var(--color-pharma)"
                          : "var(--color-ink-muted)",
                      }}
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{
                          backgroundColor: client.isActive
                            ? "var(--color-pharma)"
                            : "var(--color-ink-muted)",
                        }}
                      />
                      {client.isActive
                        ? t("clients.active")
                        : t("clients.inactive")}
                    </span>

                    {/* Close (X) button */}
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="flex size-6 items-center justify-center rounded-sm opacity-50 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
                        aria-label={t("common.close")}
                      >
                        <XIcon className="size-4" />
                      </button>
                    </Dialog.Close>
                  </div>
                </div>

                {/* ===== Contact / location details ===== */}
                <div
                  className="border-t pt-4"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                  }}
                >
                  <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                    <DetailRow
                      icon={<MailIcon className="size-4" />}
                      label={t("clients.email")}
                      value={client.email ?? "—"}
                    />
                    <DetailRow
                      icon={<PhoneIcon className="size-4" />}
                      label={t("clients.phone")}
                      value={client.phone ?? "—"}
                    />
                    <DetailRow
                      icon={<MapPinIcon className="size-4" />}
                      label={t("clients.address")}
                      value={client.address ?? "—"}
                      className="sm:col-span-2"
                    />
                    <DetailRow
                      icon={<BuildingIcon className="size-4" />}
                      label={t("clients.city")}
                      value={city}
                      className="sm:col-span-2"
                    />
                  </div>
                </div>

                {/* ===== Sales history ===== */}
                <div
                  className="mt-4 border-t pt-4"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                  }}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <h4
                      className="m-0 flex items-center gap-1.5 text-body-sm font-semibold"
                      style={{ color: "var(--color-ink)" }}
                    >
                      <ReceiptIcon
                        className="size-4"
                        style={{ color: "var(--color-pharma)" }}
                        aria-hidden="true"
                      />
                      {t("clients.sales_history")}
                    </h4>
                    {salesTotal > 0 && (
                      <span
                        className="text-caption font-medium"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        {t("clients.sales_count", { count: salesTotal })}
                      </span>
                    )}
                  </div>

                  {salesLoading ? (
                    <div className="flex items-center gap-2 py-1.5">
                      <LoaderIcon
                        className="size-4 animate-spin"
                        style={{ color: "var(--color-pharma)" }}
                        aria-hidden="true"
                      />
                      <span
                        className="text-caption"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        {t("common.loading")}
                      </span>
                    </div>
                  ) : salesFailed ? (
                    <p
                      className="m-0 py-1 text-caption"
                      style={{ color: "var(--color-urgency)" }}
                      role="alert"
                    >
                      {t("clients.sales_history_error")}
                    </p>
                  ) : sales.length === 0 ? (
                    <p
                      className="m-0 py-1 text-caption"
                      style={{ color: "var(--color-ink-muted)" }}
                    >
                      {t("clients.sales_history_empty")}
                    </p>
                  ) : (
                    <ul className="m-0 list-none p-0">
                      {sales.map((sale, idx) => (
                        <li
                          key={sale.saleId}
                          className="flex items-center gap-3 py-1.5"
                          style={
                            idx > 0
                              ? {
                                  borderTop:
                                    "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
                                }
                              : undefined
                          }
                        >
                          <span
                            className="w-12 shrink-0 font-data tabular-nums font-semibold"
                            style={{ color: "var(--color-pharma)" }}
                          >
                            #{sale.localNumber}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p
                              className="m-0 truncate text-caption font-medium"
                              style={{ color: "var(--color-ink)" }}
                            >
                              {formatSaleDate(sale.confirmedAt, locale)}
                            </p>
                            {sale.invoiceNumber && (
                              <p
                                className="m-0 truncate font-data text-caption"
                                style={{ color: "var(--color-ink-muted)" }}
                              >
                                {sale.invoiceNumber}
                              </p>
                            )}
                          </div>
                          <span
                            className="shrink-0 font-data tabular-nums font-semibold"
                            style={{ color: "var(--color-ink)" }}
                          >
                            {formatSaleAmount(sale.totalAmount, locale)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* ===== Registry meta ===== */}
                <div
                  className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 border-t pt-3"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                  }}
                >
                  <span
                    className="inline-flex items-center gap-1.5 text-caption"
                    style={{ color: "var(--color-ink-muted)" }}
                  >
                    <CalendarIcon className="size-3.5 opacity-60" />
                    {t("clients.created_at")}:{" "}
                    <span
                      className="font-medium"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {formatShortDate(client.createdAt.toISOString())}
                    </span>
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 text-caption"
                    style={{ color: "var(--color-ink-muted)" }}
                  >
                    <ClockIcon className="size-3.5 opacity-60" />
                    {t("clients.updated_at")}:{" "}
                    <span
                      className="font-medium"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {formatShortDate(client.updatedAt.toISOString())}
                    </span>
                  </span>
                </div>

                {/* ===== Actions ===== */}
                <div
                  className="mt-5 flex items-center justify-end gap-2 border-t pt-4"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                  }}
                >
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-body-sm font-semibold transition-colors"
                      style={{
                        backgroundColor: "var(--color-panel)",
                        color: "var(--color-ink)",
                        borderColor:
                          "color-mix(in srgb, var(--color-ink) 15%, transparent)",
                      }}
                    >
                      <XIcon className="size-4" />
                      {t("common.close")}
                    </button>
                  </Dialog.Close>

                  <button
                    type="button"
                    onClick={() => onEdit(client)}
                    className="inline-flex items-center gap-1.5 rounded-sm border px-4 py-1.5 text-body-sm font-semibold text-white transition-all hover:brightness-110"
                    style={{ backgroundColor: "var(--color-pharma)" }}
                  >
                    <PencilIcon className="size-4" />
                    {t("clients.edit")}
                  </button>
                </div>
              </div>
            </motion.div>
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Labeled detail row with a leading icon. */
const DetailRow: FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
}> = ({ icon, label, value, className = "" }) => (
  <div className={`flex items-start gap-2.5 py-1.5 ${className}`}>
    <span
      className="mt-px shrink-0 opacity-55"
      style={{ color: "var(--color-ink-muted)" }}
    >
      {icon}
    </span>
    <div className="min-w-0">
      <p
        className="m-0 text-caption"
        style={{ color: "var(--color-ink-muted)" }}
      >
        {label}
      </p>
      <p
        className="m-0 truncate text-body-sm font-medium"
        style={{ color: "var(--color-ink)" }}
      >
        {value}
      </p>
    </div>
  </div>
);
