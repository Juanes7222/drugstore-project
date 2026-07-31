/**
 * PrescriptionItemInfo — card displaying the current cart item that requires
 * a prescription.
 *
 * Shows the product name, generic name, and a restricted-sale badge when
 * applicable so the cashier can verify they are attaching the prescription
 * to the correct item.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";

interface PrescriptionItemInfoProps {
  item: {
    id: string;
    name: string;
    isRestricted?: boolean;
  };
}

export const PrescriptionItemInfo: FC<PrescriptionItemInfoProps> = ({
  item,
}) => {
  const { t } = useTranslation();

  return (
    <div className="pos-panel p-pos-lg mb-pos-xl">
      <div className="flex items-start justify-between gap-pos-md">
        <div className="min-w-0 flex-1">
          <p
            className="text-body font-semibold truncate"
            style={{ color: "var(--color-ink)" }}
          >
            {item.name}
          </p>
        </div>

        {item.isRestricted && (
          <span className="pos-badge pos-badge-restrict shrink-0">
            {t("sales.product.restricted")}
          </span>
        )}
      </div>
    </div>
  );
};
