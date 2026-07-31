/**
 * CommissionBadge — inline mark identifying a product that accrues a
 * sales commission.
 *
 * Renders nothing when the product has no commission configured
 * (NONE type or a zero value). When configured, shows a compact
 * "COMISIÓN" badge: solid gold while the validity window contains the
 * current moment, muted when the window is set but not yet started or
 * already expired. The label never changes — only the intensity does —
 * so the mark means "this product carries a commission" in every state,
 * and the tooltip/aria-label carries the detail (rate, window, status).
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { CommissionType } from "@pharmacy/database/local";
import { isCommissionWindowActive } from "../../../domain/sales-pos/commission";
import { formatCurrency } from "../../utils/format-currency";
import { formatShortDate } from "../../utils/format-date";

export interface CommissionBadgeProps {
  commissionType: CommissionType | null | undefined;
  /** Percentage points (PERCENTAGE) or COP per unit (FIXED). */
  commissionValue?: string | number | null;
  commissionStartsAt?: string | null;
  commissionEndsAt?: string | null;
}

/**
 * True when a commission is configured at all — independent of whether
 * the validity window currently applies.
 */
export const hasCommissionConfig = (
  props: Pick<
    CommissionBadgeProps,
    "commissionType" | "commissionValue"
  >,
): boolean =>
  props.commissionType != null &&
  props.commissionType !== "NONE" &&
  Number(props.commissionValue) > 0;

export const CommissionBadge: FC<CommissionBadgeProps> = ({
  commissionType,
  commissionValue,
  commissionStartsAt,
  commissionEndsAt,
}) => {
  const { t } = useTranslation();

  if (!hasCommissionConfig({ commissionType, commissionValue })) {
    return null;
  }

  const windowActive = isCommissionWindowActive(
    { startsAt: commissionStartsAt, endsAt: commissionEndsAt },
    new Date(),
  );

  // Detail: the rate or the per-unit amount, e.g. "5%" or "$2.000/unidad".
  const numericValue = Number(commissionValue);
  const detail =
    commissionType === "PERCENTAGE"
      ? t("common.commission_percentage", { value: numericValue })
      : t("common.commission_fixed", {
          value: formatCurrency(Math.round(numericValue * 100)),
        });

  // Window bounds, e.g. "desde 1 ago" / "hasta 31 ago".
  const windowParts: string[] = [];
  if (commissionStartsAt) {
    windowParts.push(
      t("common.commission_window_from", {
        date: formatShortDate(commissionStartsAt),
      }),
    );
  }
  if (commissionEndsAt) {
    windowParts.push(
      t("common.commission_window_until", {
        date: formatShortDate(commissionEndsAt),
      }),
    );
  }

  const statusPart = windowActive
    ? ""
    : t("common.commission_outside_window");
  const tooltip = [detail, ...windowParts, statusPart]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      className={`pos-badge pos-badge-commission ${
        windowActive ? "" : "opacity-50"
      }`}
      title={tooltip}
      aria-label={tooltip}
    >
      {t("common.commission_badge")}
    </span>
  );
};
