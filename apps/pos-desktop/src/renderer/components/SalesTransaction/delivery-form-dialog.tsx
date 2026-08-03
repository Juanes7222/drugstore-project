/**
 * Delivery (domicilio) form dialog for the active sale.
 *
 * Collects address, contact, notes, scheduling and the delivery fee, then
 * validates against the tenant delivery policy before saving the draft.
 * Validation mirrors the sales-pos service rules; errors are surfaced with
 * the service's DomainError codes as the single source of truth.
 */

import * as Dialog from "@radix-ui/react-dialog";
import {
  type FC,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryState } from "@pharmacy/shared-types";
import { CurrencyInput } from "@/components/common/currency-input";
import { TruckIcon } from "@/components/ui/icons";
import { formatCurrency } from "@/utils/format-currency";
import type { DeliveryConfig } from "../../../domain/config/types";
import type { SaleDeliveryDraft } from "@/store/slices/sales-types";

/** Mirrors the sales-pos service exception codes for delivery validation. */
type DeliveryValidationError =
  | "DELIVERY_REQUIRES_CLIENT"
  | "DELIVERY_ADDRESS_REQUIRED"
  | "DELIVERY_PHONE_REQUIRED"
  | "DELIVERY_FEE_POLICY";

interface DeliveryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deliveryConfig: DeliveryConfig;
  /** Existing draft when editing; `null` when creating a new one. */
  delivery: SaleDeliveryDraft | null;
  clientSelected: boolean;
  onSave: (draft: SaleDeliveryDraft) => void;
}

const trimOrNull = (value: string): string | null => value.trim() || null;

const toLocalInputValue = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toIso = (localValue: string): string | null => {
  if (!localValue) return null;
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const DeliveryFormDialog: FC<DeliveryFormDialogProps> = ({
  open,
  onOpenChange,
  deliveryConfig,
  delivery,
  clientSelected,
  onSave,
}) => {
  const { t } = useTranslation();

  const [address, setAddress] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [feeCents, setFeeCents] = useState(0);
  const [errorCode, setErrorCode] = useState<DeliveryValidationError | null>(
    null,
  );

  const addressId = useId();
  const contactNameId = useId();
  const contactPhoneId = useId();
  const notesId = useId();
  const scheduledAtId = useId();

  useEffect(() => {
    if (!open) return;
    setAddress(delivery?.address ?? "");
    setContactName(delivery?.contactName ?? "");
    setContactPhone(delivery?.contactPhone ?? "");
    setNotes(delivery?.notes ?? "");
    setScheduledAt(toLocalInputValue(delivery?.scheduledAt ?? null));
    setFeeCents(delivery?.feeCents ?? 0);
    setErrorCode(null);
  }, [open, delivery]);

  const validate = useCallback((): DeliveryValidationError | null => {
    if (deliveryConfig.requiresClient && !clientSelected) {
      return "DELIVERY_REQUIRES_CLIENT";
    }
    if (deliveryConfig.addressRequired && !address.trim()) {
      return "DELIVERY_ADDRESS_REQUIRED";
    }
    if (deliveryConfig.phoneRequired && !contactPhone.trim()) {
      return "DELIVERY_PHONE_REQUIRED";
    }
    if (
      deliveryConfig.deliveryFeeMode === "MANUAL" &&
      deliveryConfig.maxDeliveryFeeCents > 0 &&
      feeCents > deliveryConfig.maxDeliveryFeeCents
    ) {
      return "DELIVERY_FEE_POLICY";
    }
    return null;
  }, [address, contactPhone, deliveryConfig, clientSelected, feeCents]);

  const handleSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const error = validate();
      if (error) {
        setErrorCode(error);
        return;
      }

      const resolvedFeeCents =
        deliveryConfig.deliveryFeeMode === "FIXED"
          ? deliveryConfig.fixedDeliveryFeeCents
          : deliveryConfig.deliveryFeeMode === "MANUAL"
            ? feeCents
            : 0;

      onSave({
        state: "PENDING" as DeliveryState,
        address: trimOrNull(address),
        contactName: trimOrNull(contactName),
        contactPhone: trimOrNull(contactPhone),
        notes: trimOrNull(notes),
        scheduledAt: toIso(scheduledAt),
        feeCents: resolvedFeeCents,
      });
    },
    [
      validate,
      deliveryConfig,
      feeCents,
      address,
      contactName,
      contactPhone,
      notes,
      scheduledAt,
      onSave,
    ],
  );

  const errorMessage = errorCode
    ? errorCode === "DELIVERY_FEE_POLICY"
      ? t("delivery.feeTooHighError", {
          max: formatCurrency(deliveryConfig.maxDeliveryFeeCents),
        })
      : t(
          {
            DELIVERY_REQUIRES_CLIENT: "delivery.clientRequiredError",
            DELIVERY_ADDRESS_REQUIRED: "delivery.addressRequiredError",
            DELIVERY_PHONE_REQUIRED: "delivery.phoneRequiredError",
            DELIVERY_FEE_POLICY: "delivery.feeTooHighError",
          }[errorCode],
        )
    : null;

  const feeLabel =
    deliveryConfig.deliveryFeeMode === "FIXED"
      ? formatCurrency(deliveryConfig.fixedDeliveryFeeCents)
      : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40 bg-black/50"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-ink) 45%, transparent)",
          }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-pos p-pos-lg shadow-pos-elevated focus-visible:outline-none"
          style={{ backgroundColor: "var(--color-panel)" }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById(addressId)?.focus();
          }}
        >
          <div className="flex items-center gap-2">
            <TruckIcon size={16} aria-hidden="true" />
            <Dialog.Title
              className="text-title font-medium"
              style={{ color: "var(--color-ink)" }}
            >
              {t("delivery.title")}
            </Dialog.Title>
          </div>
          <Dialog.Description
            className="mt-pos-xs text-caption"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {t("delivery.dialogDescription")}
          </Dialog.Description>

          <form
            className="mt-pos-md grid gap-pos-md"
            onSubmit={handleSubmit}
            noValidate
          >
            {deliveryConfig.addressRequired && (
              <div>
                <label
                  htmlFor={addressId}
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("delivery.address")} *
                </label>
                <input
                  id={addressId}
                  type="text"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder={t("delivery.address_placeholder")}
                  required
                  className="w-full rounded-pos border px-pos-md py-pos-sm text-body focus:border-pharma focus:outline-none"
                  style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-ink)",
                  }}
                />
              </div>
            )}

            <div
              className={
                deliveryConfig.phoneRequired
                  ? "grid grid-cols-2 gap-pos-md"
                  : "space-y-pos-md"
              }
            >
              <div>
                <label
                  htmlFor={contactNameId}
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("delivery.contactName")}
                </label>
                <input
                  id={contactNameId}
                  type="text"
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  placeholder={t("delivery.contactName_placeholder")}
                  className="w-full rounded-pos border px-pos-md py-pos-sm text-body focus:border-pharma focus:outline-none"
                  style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-ink)",
                  }}
                />
              </div>
              <div>
                <label
                  htmlFor={contactPhoneId}
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("delivery.contactPhone")}
                  {deliveryConfig.phoneRequired && " *"}
                </label>
                <input
                  id={contactPhoneId}
                  type="tel"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  placeholder={t("delivery.contactPhone_placeholder")}
                  required={deliveryConfig.phoneRequired}
                  className="w-full rounded-pos border px-pos-md py-pos-sm text-body focus:border-pharma focus:outline-none"
                  style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-ink)",
                  }}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor={notesId}
                className="mb-pos-xs block text-body-sm font-medium"
                style={{ color: "var(--color-ink)" }}
              >
                {t("delivery.notes")}
              </label>
              <textarea
                id={notesId}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("delivery.notes_placeholder")}
                rows={2}
                className="w-full rounded-pos border px-pos-md py-pos-sm text-body focus:border-pharma focus:outline-none"
                style={{
                  borderColor: "var(--color-border)",
                  backgroundColor: "var(--color-surface)",
                  color: "var(--color-ink)",
                }}
              />
            </div>

            {deliveryConfig.allowScheduling && (
              <div>
                <label
                  htmlFor={scheduledAtId}
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("delivery.scheduledAt")}
                </label>
                <input
                  id={scheduledAtId}
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                  className="w-full rounded-pos border px-pos-md py-pos-sm text-body focus:border-pharma focus:outline-none"
                  style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-ink)",
                  }}
                />
              </div>
            )}

            {deliveryConfig.deliveryFeeMode === "MANUAL" && (
              <div>
                <CurrencyInput
                  label={t("delivery.fee_placeholder")}
                  value={feeCents}
                  onChange={setFeeCents}
                />
                {deliveryConfig.maxDeliveryFeeCents > 0 && (
                  <p
                    className="mt-pos-xs text-caption"
                    style={{ color: "var(--color-ink-muted)" }}
                  >
                    {t("delivery.fee_max_hint", {
                      max: formatCurrency(deliveryConfig.maxDeliveryFeeCents),
                    })}
                  </p>
                )}
              </div>
            )}

            {feeLabel && (
              <div className="flex items-center justify-between">
                <span
                  className="text-body-sm"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  {t("delivery.fee")}
                </span>
                <span
                  className="font-data text-body tabular-nums"
                  style={{ color: "var(--color-ink)" }}
                >
                  {feeLabel}
                </span>
              </div>
            )}

            {errorMessage && (
              <p
                role="alert"
                className="text-body-sm font-medium"
                style={{ color: "var(--color-error)" }}
              >
                {errorMessage}
              </p>
            )}

            <div className="mt-pos-sm flex justify-end gap-pos-md">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-pos px-pos-md py-pos-sm text-body font-medium transition-colors hover:opacity-80"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("delivery.cancel")}
                </button>
              </Dialog.Close>
              <button
                type="submit"
                className="rounded-pos px-pos-md py-pos-sm text-body font-medium text-white transition-colors hover:opacity-90"
                style={{ backgroundColor: "var(--color-pharma)" }}
              >
                {t("delivery.confirm")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
