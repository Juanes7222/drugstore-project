/**
 * Restricted-sale confirmation dialog.
 *
 * Appears when a cashier selects a formula-controlled product. The cashier
 * must take an explicit confirmation action — the same click/Enter that adds
 * a normal item only opens this dialog. Escape or clicking the overlay closes
 * the dialog without adding the item.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { CatalogItem } from "@/services/catalog-service";
import { formatCurrency } from "@/utils/format-currency";
import { formatShortDate } from "@/utils/format-date";

interface RestrictedConfirmationDialogProps {
  item: CatalogItem | null;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const RestrictedConfirmationDialog: FC<
  RestrictedConfirmationDialogProps
> = ({ item, open, onConfirm, onCancel }) => {
  const { t } = useTranslation();

  if (!item || item.unitPriceCents === null) {
    return null;
  }

  const price = item.unitPriceCents;

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40"
          style={{ backgroundColor: "color-mix(in srgb, var(--color-ink) 40%, transparent)" }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-pos p-pos-lg shadow-pos-elevated focus-visible:outline-none"
          style={{
            backgroundColor: "var(--color-restrict-surface)",
            border: "2px solid var(--color-restrict)",
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title
            className="text-heading font-bold"
            style={{ color: "var(--color-restrict)" }}
          >
            {t("sales.restricted.title")}
          </Dialog.Title>

          <Dialog.Description
            className="mt-pos-sm text-body"
            style={{ color: "var(--color-ink)" }}
          >
            {t("sales.restricted.description", { name: item.name })}
          </Dialog.Description>

          <div
            className="mt-pos-md rounded-pos p-pos-md"
            style={{ backgroundColor: "var(--color-panel)" }}
          >
            <p className="text-body font-semibold" style={{ color: "var(--color-ink)" }}>
              {item.name}
            </p>
            <p
              className="text-caption"
              style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}
            >
              {item.genericName}
            </p>
            <p
              className="mt-pos-sm text-caption"
              style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}
            >
              {t("sales.restricted.warning", {
                invima: item.invimaCertificate,
                saleType: item.saleType,
              })}
            </p>
            <p
              className="mt-pos-sm text-caption"
              style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}
            >
              {t("sales.product.lot")}: {item.lotCode} — {t("sales.product.expires")}:{" "}
              {formatShortDate(item.lotExpirationDate)}
            </p>
            <p className="mt-pos-sm font-data text-price font-bold tabular-nums">
              {formatCurrency(price)}
            </p>
          </div>

          <div className="mt-pos-lg flex justify-end gap-pos-sm">
            <button
              type="button"
              onClick={onCancel}
              className="pos-button pos-button-secondary"
              autoFocus
            >
              {t("sales.restricted.cancel")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="pos-button pos-button-restrict"
            >
              {t("sales.restricted.confirm")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
