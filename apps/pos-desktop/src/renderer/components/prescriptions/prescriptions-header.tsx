/**
 * PrescriptionsHeader — section header for the prescription capture flow.
 *
 * Shows the screen title and, when more than one item requires a
 * prescription, a count of remaining items.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";

interface PrescriptionsHeaderProps {
  /** Number of cart items that still need prescription data entered. */
  itemsLeft: number;
}

export const PrescriptionsHeader: FC<PrescriptionsHeaderProps> = ({
  itemsLeft,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-center justify-between px-pos-xl py-pos-lg"
      style={{ borderBottom: "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)" }}
    >
      <h1 className="pos-page-title">{t("prescriptions.title")}</h1>

      {itemsLeft > 1 && (
        <span
          className="font-data text-caption tabular-nums"
          style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}
        >
          {t("prescriptions.items_left", { count: itemsLeft })}
        </span>
      )}
    </div>
  );
};
