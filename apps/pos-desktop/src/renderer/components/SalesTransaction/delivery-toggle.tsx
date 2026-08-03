/**
 * Domicilio (delivery) control for the cart panel.
 *
 * Shows a dashed enable toggle when the tenant delivery policy is active
 * (disabled while a client is required but none is selected), and a compact
 * summary card with edit/remove once a draft is set. Owns the form dialog
 * and the dispatch of the delivery draft to the sales slice.
 */

import { type FC, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import {
  selectDeliveryDraft,
  selectSelectedClient,
  setDelivery,
} from "@/store/slices/sales-slice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { Edit3Icon, TruckIcon, XIcon } from "@/components/ui/icons";
import { formatCurrency } from "@/utils/format-currency";
import { useDeliveryConfig } from "@/hooks/use-delivery-config";
import { DeliveryFormDialog } from "./delivery-form-dialog";
import type { SaleDeliveryDraft } from "@/store/slices/sales-types";

const formatScheduledAt = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
};

export const DeliveryToggle: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const deliveryConfig = useDeliveryConfig();
  const delivery = useAppSelector(selectDeliveryDraft);
  const selectedClient = useAppSelector(selectSelectedClient);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const clientBlocked =
    deliveryConfig.requiresClient && selectedClient === null;

  const handleSave = useCallback(
    (draft: SaleDeliveryDraft) => {
      dispatch(setDelivery(draft));
      setIsFormOpen(false);
    },
    [dispatch],
  );

  const handleRemove = useCallback(() => {
    dispatch(setDelivery(null));
  }, [dispatch]);

  if (!deliveryConfig.enabled) return null;

  if (delivery === null) {
    return (
      <div className="mt-pos-md">
        <button
          type="button"
          role="switch"
          aria-checked={false}
          aria-haspopup="dialog"
          aria-describedby={clientBlocked ? "delivery-client-hint" : undefined}
          disabled={clientBlocked}
          onClick={() => setIsFormOpen(true)}
          className="flex w-full items-center gap-2 rounded-pos border border-dashed px-pos-md py-pos-sm text-body-sm font-medium transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            borderColor:
              "color-mix(in srgb, var(--color-sync) 45%, transparent)",
            color: "var(--color-sync)",
          }}
        >
          <TruckIcon size={14} aria-hidden="true" />
          <span>{t("delivery.enable")}</span>
        </button>
        {clientBlocked && (
          <p
            id="delivery-client-hint"
            className="mt-pos-xs text-caption"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {t("delivery.clientRequiredHint")}
          </p>
        )}
        <DeliveryFormDialog
          open={isFormOpen}
          onOpenChange={setIsFormOpen}
          deliveryConfig={deliveryConfig}
          delivery={null}
          clientSelected={selectedClient !== null}
          onSave={handleSave}
        />
      </div>
    );
  }

  const detailBits = [
    delivery.feeCents > 0 ? formatCurrency(delivery.feeCents) : null,
    delivery.scheduledAt ? formatScheduledAt(delivery.scheduledAt) : null,
  ].filter(Boolean);

  return (
    <div
      className="mt-pos-md rounded-pos border px-pos-md py-pos-sm"
      style={{
        borderColor: "color-mix(in srgb, var(--color-sync) 30%, transparent)",
        backgroundColor:
          "color-mix(in srgb, var(--color-sync) 6%, var(--color-panel))",
      }}
    >
      <div className="flex items-start justify-between gap-pos-md">
        <div className="flex min-w-0 items-start gap-2">
          <TruckIcon
            size={14}
            className="mt-0.5 shrink-0"
            style={{ color: "var(--color-sync)" }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p
              className="truncate text-body-sm font-medium"
              style={{ color: "var(--color-ink)" }}
            >
              {delivery.address ?? delivery.contactName ?? t("delivery.title")}
            </p>
            {(detailBits.length > 0 || delivery.contactPhone) && (
              <p
                className="truncate text-caption"
                style={{ color: "var(--color-ink-muted)" }}
              >
                {detailBits.join(" · ") || delivery.contactPhone}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            aria-label={t("delivery.edit")}
            onClick={() => setIsFormOpen(true)}
            className="rounded-pos p-1 transition-colors hover:opacity-70"
            style={{ color: "var(--color-ink-muted)" }}
          >
            <Edit3Icon size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("delivery.remove")}
            onClick={handleRemove}
            className="rounded-pos p-1 transition-colors hover:opacity-70"
            style={{ color: "var(--color-ink-muted)" }}
          >
            <XIcon size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <DeliveryFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        deliveryConfig={deliveryConfig}
        delivery={delivery}
        clientSelected={selectedClient !== null}
        onSave={handleSave}
      />
    </div>
  );
};
