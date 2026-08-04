/**
 * Client details dialog — read-only overlay modal.
 *
 * Opens when a client row is clicked so the cashier can inspect all fields
 * at a glance without entering the edit panel. Uses Radix Dialog for
 * focus-trapping, Esc-to-close, and ARIA compliance, animated with motion
 * (fade + scale) and respecting prefers-reduced-motion. The "Edit" action
 * hands off to the slide-in edit panel.
 */
import { type FC } from "react";
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
  XIcon,
} from "@/components/ui/icons";
import { formatShortDate } from "@/utils/format-date";
import type { ClientSearchResult } from "../../../domain/clients/clients.service";

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
// Component
// ---------------------------------------------------------------------------

export const ClientDetailDialog: FC<ClientDetailDialogProps> = ({
  client,
  onClose,
  onEdit,
}) => {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const isOpen = client !== null;

  const city =
    [client?.municipality, client?.department].filter(Boolean).join(", ") ||
    "—";

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
