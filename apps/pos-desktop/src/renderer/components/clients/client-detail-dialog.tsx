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
  BanIcon,
  BuildingIcon,
  CalendarIcon,
  ClockIcon,
  CreditCardIcon,
  DollarSignIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  ReceiptIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  Undo2Icon,
  XIcon,
} from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";
import { RoleType } from "@pharmacy/shared-types";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { formatShortDate } from "@/utils/format-date";
import { PaymentMethodPicker } from "../common/payment-method-picker";
import { useCreditService, useSalesHistoryService } from "../common/service-context";
import { DomainError } from "../../../common/domain-error";
import type { ClientSearchResult } from "../../../domain/clients/clients.service";
import type {
  ClientCreditState,
  CreditHistoryEntry,
  CreditHistoryResult,
} from "../../../domain/clients/credit.service";
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

const formatCents = (cents: number, locale: string): string =>
  `$${(cents / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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

  // ---- Store credit state (limit, debt, available) ----
  const creditService = useCreditService();
  const [creditState, setCreditState] = useState<ClientCreditState | null>(null);
  const [creditLoading, setCreditLoading] = useState(false);
  const [creditFailed, setCreditFailed] = useState(false);
  /** Bumped after an abono is recorded or annulled so state + history refetch. */
  const [creditRefreshKey, setCreditRefreshKey] = useState(0);
  const [abonoOpen, setAbonoOpen] = useState(false);
  /** Abono being annulled (ADMIN-only action with a mandatory reason). */
  const [annulTarget, setAnnulTarget] = useState<CreditHistoryEntry | null>(null);
  const sessionRole = useLocalSessionStore((s) => s.session?.role);
  const isAdmin = sessionRole === RoleType.ADMIN;

  useEffect(() => {
    let cancelled = false;
    const clientId = client?.id;
    if (!clientId) {
      setCreditState(null);
      setCreditLoading(false);
      setCreditFailed(false);
      return;
    }

    setCreditLoading(true);
    setCreditFailed(false);
    void creditService
      .getCreditState(clientId)
      .then((state) => {
        if (cancelled) return;
        setCreditState(state);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[ClientDetailDialog] credit state failed:", err);
        setCreditState(null);
        setCreditFailed(true);
      })
      .finally(() => {
        if (!cancelled) setCreditLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client?.id, creditRefreshKey, creditService]);

  // ---- Credit history (recent credit sales, returns, and abonos) ----
  const [creditHistory, setCreditHistory] = useState<CreditHistoryResult | null>(
    null,
  );
  const [creditHistoryLoading, setCreditHistoryLoading] = useState(false);

useEffect(() => {
    let cancelled = false;
    const clientId = client?.id;
    if (!clientId || !creditState?.enabled) {
      setCreditHistory(null);
      setCreditHistoryLoading(false);
      return;
    }

    setCreditHistoryLoading(true);
    void creditService
      .getCreditHistory(clientId, 10)
      .then((result) => {
        if (!cancelled) setCreditHistory(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[ClientDetailDialog] credit history failed:", err);
        setCreditHistory(null);
      })
      .finally(() => {
        if (!cancelled) setCreditHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client?.id, creditState?.enabled, creditRefreshKey, creditService]);

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

                {/* ===== Store credit ===== */}
                <div
                  className="mt-4 border-t pt-4"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                  }}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <h4
                      className="m-0 flex items-center gap-1.5 text-body-sm font-semibold"
                      style={{ color: "var(--color-ink)" }}
                    >
                      <CreditCardIcon
                        className="size-4"
                        style={{ color: "var(--color-pharma)" }}
                        aria-hidden="true"
                      />
                      {t("clients.credit")}
                    </h4>
                    {creditState?.enabled && creditState.usedCents > 0 && (
                      <button
                        type="button"
                        onClick={() => setAbonoOpen(true)}
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-caption font-semibold text-white transition-all hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
                        style={{ backgroundColor: "var(--color-pharma)" }}
                      >
                        <DollarSignIcon
                          className="size-3.5"
                          aria-hidden="true"
                        />
                        {t("clients.credit_payment_btn")}
                      </button>
                    )}
                  </div>

                  {creditLoading ? (
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
                  ) : creditFailed ? (
                    <p
                      className="m-0 py-1 text-caption"
                      style={{ color: "var(--color-urgency)" }}
                      role="alert"
                    >
                      {t("clients.sales_history_error")}
                    </p>
                  ) : !creditState || !creditState.enabled ? (
                    <p
                      className="m-0 py-1 text-caption"
                      style={{ color: "var(--color-ink-muted)" }}
                    >
                      {t("clients.credit_disabled")}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-3">
                      <CreditStat
                        label={t("clients.credit_limit")}
                        value={formatCents(creditState.creditLimitCents, locale)}
                        emphasis="pharma"
                      />
                      <CreditStat
                        label={t("clients.credit_debt")}
                        value={formatCents(creditState.usedCents, locale)}
                        emphasis={creditState.usedCents > 0 ? "urgency" : "ink"}
                      />
                      <CreditStat
                        label={t("clients.credit_available")}
                        value={formatCents(creditState.availableCents, locale)}
                        emphasis="pharma"
                      />
                    </div>
                  )}
                </div>

                {/* ===== Credit history ===== */}
                {(creditState?.enabled ?? false) && (
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
                        <CreditCardIcon
                          className="size-4"
                          style={{ color: "var(--color-pharma)" }}
                          aria-hidden="true"
                        />
                        {t("clients.credit_history")}
                      </h4>
                      {creditHistory && creditHistory.items.length > 0 && (
                        <span
                          className="text-caption font-medium"
                          style={{ color: "var(--color-ink-muted)" }}
                        >
                          {t("clients.credit_history_count", {
                            count: creditHistory.items.length,
                          })}
                        </span>
                      )}
                    </div>

                    {creditHistoryLoading ? (
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
                    ) : creditHistory === null ? (
                      <p
                        className="m-0 py-1 text-caption"
                        style={{ color: "var(--color-urgency)" }}
                        role="alert"
                      >
                        {t("clients.credit_history_error")}
                      </p>
                    ) : creditHistory.items.length === 0 ? (
                      <p
                        className="m-0 py-1 text-caption"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        {t("clients.credit_history_empty")}
                      </p>
                    ) : (
                      <ul className="m-0 list-none p-0">
                        {creditHistory.items.map((entry, idx) => {
                          const isSale = entry.kind === "SALE";
                          const isPayment = entry.kind === "PAYMENT";
                          const accent = isSale || isPayment
                            ? "var(--color-pharma)"
                            : "var(--color-ink-muted)";
                          return (
                            <li
                              key={`${entry.kind}-${entry.id}-${entry.date}`}
                              className="flex items-center gap-2.5 py-1.5"
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
                                className="flex size-6 shrink-0 items-center justify-center rounded-full"
                                style={{
                                  backgroundColor: isSale || isPayment
                                    ? "color-mix(in srgb, var(--color-pharma) 12%, transparent)"
                                    : "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                                }}
                              >
                                {isSale ? (
                                  <TrendingUpIcon
                                    className="size-3.5"
                                    style={{ color: accent }}
                                    aria-hidden="true"
                                  />
                                ) : isPayment ? (
                                  <DollarSignIcon
                                    className="size-3.5"
                                    style={{ color: accent }}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <TrendingDownIcon
                                    className="size-3.5"
                                    style={{ color: accent }}
                                    aria-hidden="true"
                                  />
                                )}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p
                                  className="m-0 truncate text-caption font-medium"
                                  style={{ color: "var(--color-ink)" }}
                                >
                                  {entry.reference}{" "}
                                  {entry.methodName && (
                                    <span
                                      className="font-normal"
                                      style={{ color: "var(--color-ink-muted)" }}
                                    >
                                      · {entry.methodName}
                                    </span>
                                  )}
                                </p>
                                <p
                                  className="m-0 truncate text-caption"
                                  style={{ color: "var(--color-ink-muted)" }}
                                >
                                  {formatSaleDate(entry.date, locale)}
                                </p>
                              </div>
                              <span
                                className="shrink-0 font-data tabular-nums text-caption font-semibold"
                                style={{
                                  color: isSale || isPayment
                                    ? "var(--color-pharma)"
                                    : "var(--color-ink)",
                                  textDecoration: entry.annulled
                                    ? "line-through"
                                    : undefined,
                                  opacity: entry.annulled ? 0.55 : undefined,
                                }}
                              >
                                {isSale ? "+" : "−"}
                                {formatCents(entry.amountCents, locale)}
                              </span>

                              {/* Annul action (ADMIN only) or annulled badge */}
                              {isPayment && entry.annulled && (
                                <span
                                  className="shrink-0 rounded-sm px-1.5 py-0.5 text-caption font-semibold"
                                  title={entry.annulmentReason ?? undefined}
                                  style={{
                                    backgroundColor:
                                      "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                                    color: "var(--color-ink-muted)",
                                    fontSize: "0.625rem",
                                  }}
                                >
                                  <BanIcon
                                    className="mr-0.5 inline size-3"
                                    aria-hidden="true"
                                  />
                                  {t("clients.credit_payment_annulled")}
                                </span>
                              )}
                              {isPayment && !entry.annulled && isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => setAnnulTarget(entry)}
                                  aria-label={t("clients.credit_payment_annul")}
                                  title={t("clients.credit_payment_annul")}
                                  className="flex size-6 shrink-0 items-center justify-center rounded-sm transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
                                  style={{
                                    color: "var(--color-ink-muted)",
                                  }}
                                >
                                  <Undo2Icon
                                    className="size-3.5"
                                    aria-hidden="true"
                                  />
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

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

      {/* ===== Abono (credit payment) dialog ===== */}
      {client && creditState?.enabled && creditState.usedCents > 0 && (
        <CreditPaymentDialog
          clientId={client.id}
          debtCents={creditState.usedCents}
          open={abonoOpen}
          onOpenChange={setAbonoOpen}
          onSuccess={() => setCreditRefreshKey((k) => k + 1)}
        />
      )}

      {/* ===== Abono annulment dialog (ADMIN-only) ===== */}
      {annulTarget && (
        <AnnulPaymentDialog
          payment={annulTarget}
          open
          onOpenChange={(open) => {
            if (!open) setAnnulTarget(null);
          }}
          onSuccess={() => setCreditRefreshKey((k) => k + 1)}
        />
      )}
    </Dialog.Root>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Credit stat cell — label on top, emphasized value below. */
const CreditStat: FC<{
  label: string;
  value: string;
  emphasis: "pharma" | "urgency" | "ink";
}> = ({ label, value, emphasis }) => (
  <div className="py-1.5">
    <p
      className="m-0 text-caption"
      style={{ color: "var(--color-ink-muted)" }}
    >
      {label}
    </p>
    <p
      className="m-0 font-data tabular-nums text-body font-semibold"
      style={{
        color:
          emphasis === "pharma"
            ? "var(--color-pharma)"
            : emphasis === "urgency"
              ? "var(--color-urgency)"
              : "var(--color-ink)",
      }}
    >
      {value}
    </p>
  </div>
);

/**
 * Abono annulment dialog — ADMIN-only reversal of a recorded credit payment.
 *
 * Mirrors the returns annulment pattern: a mandatory reason is required,
 * the reversal is terminal, and the change propagates through the
 * CLIENT_CREDIT_PAYMENT_ANNULMENT sync operation so the server and every
 * workstation recompute the debt without this abono.
 */
const AnnulPaymentDialog: FC<{
  payment: CreditHistoryEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}> = ({ payment, open, onOpenChange, onSuccess }) => {
  const { t, i18n } = useTranslation();
  const creditService = useCreditService();
  const shouldReduceMotion = useReducedMotion();
  const locale = i18n.language === "en" ? "en-US" : "es-CO";

  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!reason.trim()) {
      setError(t("clients.credit_payment_annul_reason_required"));
      return;
    }
    if (reason.trim().length > 1000) {
      setError(t("clients.credit_payment_annul_error_invalid"));
      return;
    }

    setSubmitting(true);
    try {
      await creditService.annulCreditPayment(payment.id, reason.trim());
      onSuccess();
      setReason("");
      onOpenChange(false);
    } catch (err: unknown) {
      const code =
        err instanceof DomainError ? err.errorCode : undefined;
      if (code === "CREDIT_PAYMENT_CANNOT_BE_ANNULLED") {
        // Already annulled (e.g. by another workstation) — treat as done.
        onSuccess();
        onOpenChange(false);
      } else if (code === "CREDIT_PAYMENT_ANNULMENT_REASON_REQUIRED") {
        setError(t("clients.credit_payment_annul_reason_required"));
      } else {
        console.error("[ClientDetailDialog] abono annulment failed:", err);
        setError(t("clients.credit_payment_annul_error_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{ duration: shouldReduceMotion ? 0.01 : 0.2 }}
          />
        </Dialog.Overlay>

        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2"
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
              className="rounded-md bg-white p-6 shadow-lg"
              style={{
                border:
                  "1px solid color-mix(in srgb, var(--color-urgency) 25%, transparent)",
              }}
            >
              <Dialog.Title
                className="m-0 flex items-center gap-1.5 text-body font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                <Undo2Icon
                  className="size-4"
                  style={{ color: "var(--color-urgency)" }}
                  aria-hidden="true"
                />
                {t("clients.credit_payment_annul_title")}
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                {t("clients.credit_payment_annul_title")}
              </Dialog.Description>

              {/* Payment being reversed */}
              <div
                className="mt-3 flex items-center justify-between gap-2 rounded-sm px-3 py-2"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-ink) 5%, transparent)",
                }}
              >
                <div className="min-w-0">
                  <p
                    className="m-0 truncate text-caption font-semibold"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {payment.reference}
                    {payment.methodName && (
                      <span
                        className="font-normal"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        {" "}· {payment.methodName}
                      </span>
                    )}
                  </p>
                  <p
                    className="m-0 truncate text-caption"
                    style={{ color: "var(--color-ink-muted)" }}
                  >
                    {formatSaleDate(payment.date, locale)}
                  </p>
                </div>
                <span
                  className="shrink-0 font-data tabular-nums text-caption font-semibold"
                  style={{ color: "var(--color-urgency)" }}
                >
                  −{formatCents(payment.amountCents, locale)}
                </span>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSubmit();
                }}
              >
                <div className="mt-3 grid gap-3">
                  <label className="grid gap-1">
                    <span
                      className="text-caption font-medium"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {t("clients.credit_payment_annul_reason")}{" "}
                      <span
                        className="font-semibold"
                        style={{ color: "var(--color-urgency)" }}
                      >
                        *
                      </span>
                    </span>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                      maxLength={1000}
                      placeholder={t(
                        "clients.credit_payment_annul_reason_placeholder",
                      )}
                      className="pos-input resize-none text-body-sm"
                      aria-label={t("clients.credit_payment_annul_reason")}
                    />
                  </label>
                </div>

                {error && (
                  <p
                    className="mt-3 text-caption"
                    style={{ color: "var(--color-urgency)" }}
                    role="alert"
                  >
                    {error}
                  </p>
                )}

                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-body-sm font-semibold transition-colors"
                    style={{
                      backgroundColor: "var(--color-panel)",
                      color: "var(--color-ink)",
                      borderColor:
                        "color-mix(in srgb, var(--color-ink) 15%, transparent)",
                    }}
                  >
                    <XIcon className="size-4" />
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded-sm border px-4 py-1.5 text-body-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-60"
                    style={{ backgroundColor: "var(--color-urgency)" }}
                  >
                    {submitting ? (
                      <LoaderIcon
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Undo2Icon className="size-4" aria-hidden="true" />
                    )}
                    {t("clients.credit_payment_annul_confirm")}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

/**
 * Abono (credit payment) dialog — records a partial payment toward the
 * client's credit debt.
 *
 * Capped at the current debt, tied to a payment method (cash, card, …) and
 * the open cash shift. Rendered as a nested Radix dialog on top of the
 * client details dialog.
 */
const CreditPaymentDialog: FC<{
  clientId: string;
  debtCents: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}> = ({ clientId, debtCents, open, onOpenChange, onSuccess }) => {
  const { t, i18n } = useTranslation();
  const creditService = useCreditService();
  const shouldReduceMotion = useReducedMotion();
  const locale = i18n.language === "en" ? "en-US" : "es-CO";

  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    const pesos = Number(amount);
    if (!Number.isFinite(pesos) || pesos <= 0) {
      setError(t("clients.credit_payment_error_invalid_amount"));
      return;
    }
    if (!methodId) {
      setError(t("clients.credit_payment_error_no_method"));
      return;
    }
    const amountCents = Math.round(pesos * 100);
    if (amountCents > debtCents) {
      setError(
        t("clients.credit_payment_error_exceeds_debt", {
          debt: formatCents(debtCents, locale),
        }),
      );
      return;
    }

    setSubmitting(true);
    try {
      await creditService.recordCreditPayment({
        clientId,
        amountCents,
        paymentMethodId: methodId,
        notes: notes.trim() || undefined,
      });
      onSuccess();
      setAmount("");
      setMethodId("");
      setNotes("");
      onOpenChange(false);
    } catch (err: unknown) {
      const code =
        err instanceof DomainError ? err.errorCode : undefined;
      if (code === "CREDIT_PAYMENT_EXCEEDS_DEBT") {
        setError(
          t("clients.credit_payment_error_exceeds_debt", {
            debt: formatCents(debtCents, locale),
          }),
        );
      } else if (code === "CREDIT_PAYMENT_INVALID_AMOUNT") {
        setError(t("clients.credit_payment_error_invalid_amount"));
      } else if (code === "NO_OPEN_CASH_SHIFT_FOR_CREDIT_PAYMENT") {
        setError(t("clients.credit_payment_error_no_shift"));
      } else if (code === "CREDIT_NOT_ENABLED_FOR_CLIENT") {
        setError(t("clients.credit_payment_error_not_enabled"));
      } else {
        console.error("[ClientDetailDialog] abono failed:", err);
        setError(t("clients.credit_payment_error_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{ duration: shouldReduceMotion ? 0.01 : 0.2 }}
          />
        </Dialog.Overlay>

        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2"
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
              className="rounded-md bg-white p-6 shadow-lg"
              style={{
                border:
                  "1px solid color-mix(in srgb, var(--color-pharma) 18%, transparent)",
              }}
            >
              <Dialog.Title
                className="m-0 flex items-center gap-1.5 text-body font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                <DollarSignIcon
                  className="size-4"
                  style={{ color: "var(--color-pharma)" }}
                  aria-hidden="true"
                />
                {t("clients.credit_payment_title")}
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                {t("clients.credit_payment_title")}
              </Dialog.Description>

              {/* Current debt reference */}
              <p
                className="mt-2 mb-3 text-caption"
                style={{ color: "var(--color-ink-muted)" }}
              >
                {t("clients.credit_debt")}:{" "}
                <span
                  className="font-data tabular-nums font-semibold"
                  style={{ color: "var(--color-urgency)" }}
                >
                  {formatCents(debtCents, locale)}
                </span>
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSubmit();
                }}
              >
              <div className="grid gap-3">
                {/* Amount (pesos) */}
                <label className="grid gap-1">
                  <span
                    className="text-caption font-medium"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("clients.credit_payment_amount")}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="pos-input text-body-sm"
                    aria-label={t("clients.credit_payment_amount")}
                  />
                </label>

                {/* Payment method */}
                <label className="grid gap-1">
                  <span
                    className="text-caption font-medium"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("clients.credit_payment_method")}
                  </span>
                  <PaymentMethodPicker
                    value={methodId}
                    onChange={(m) => setMethodId(m.id)}
                    ariaLabel={t("clients.credit_payment_method")}
                  />
                </label>

                {/* Notes (optional) */}
                <label className="grid gap-1">
                  <span
                    className="text-caption font-medium"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("clients.credit_payment_notes")}
                  </span>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={200}
                    className="pos-input text-body-sm"
                    aria-label={t("clients.credit_payment_notes")}
                  />
                </label>
              </div>

              {error && (
                <p
                  className="mt-3 text-caption"
                  style={{ color: "var(--color-urgency)" }}
                  role="alert"
                >
                  {error}
                </p>
              )}

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-body-sm font-semibold transition-colors"
                  style={{
                    backgroundColor: "var(--color-panel)",
                    color: "var(--color-ink)",
                    borderColor:
                      "color-mix(in srgb, var(--color-ink) 15%, transparent)",
                  }}
                >
                  <XIcon className="size-4" />
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-sm border px-4 py-1.5 text-body-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-60"
                  style={{ backgroundColor: "var(--color-pharma)" }}
                >
                  {submitting ? (
                    <LoaderIcon
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <DollarSignIcon className="size-4" aria-hidden="true" />
                  )}
                  {t("clients.credit_payment_confirm")}
                </button>
              </div>
              </form>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

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
