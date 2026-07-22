/**
 * Check-in history panel — last check-in, days until expiry, grace period.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { LicenseStatus } from "@pharmacy/shared-types";
import { formatDateTime } from "./license-status.helpers";

export interface LicenseCheckinPanelProps {
  status: LicenseStatus;
  lastCheckInAt: string | null;
  daysUntilExpiry: number | null;
  daysUntilGracePeriodEnd: number | null;
  checkInsLast30Days: number;
}

export const LicenseCheckinPanel: FC<LicenseCheckinPanelProps> = ({
  status,
  lastCheckInAt,
  daysUntilExpiry,
  daysUntilGracePeriodEnd,
  checkInsLast30Days,
}) => {
  const { t } = useTranslation();

  return (
    <div className="pos-panel p-pos-lg">
      <h2
        className="mb-pos-md text-ui font-semibold"
        style={{ color: "var(--color-ink)" }}
      >
        {t("licensing.status_page.checkin_section")}
      </h2>

      <dl className="space-y-pos-sm text-body-sm">
        <div className="flex gap-pos-xs">
          <dt
            className="font-medium"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            {t("licensing.status_page.last_checkin")}
          </dt>
          <dd style={{ color: "var(--color-ink)" }}>
            {formatDateTime(lastCheckInAt)}
          </dd>
        </div>

        <div className="flex gap-pos-xs">
          <dt
            className="font-medium"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            {t("licensing.status_page.days_until_expiry")}
          </dt>
          <dd
            className="font-data font-medium"
            style={{ color: "var(--color-ink)" }}
          >
            {daysUntilExpiry !== null && daysUntilExpiry !== undefined
              ? daysUntilExpiry
              : "—"}
          </dd>
        </div>

        <div className="flex gap-pos-xs">
          <dt
            className="font-medium"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            {t("licensing.status_page.checkins_30d")}
          </dt>
          <dd
            className="font-data font-medium"
            style={{ color: "var(--color-ink)" }}
          >
            {checkInsLast30Days}
          </dd>
        </div>

        {status === LicenseStatus.GRACE_PERIOD &&
          daysUntilGracePeriodEnd !== null && (
            <div className="flex gap-pos-xs">
              <dt
                className="font-medium"
                style={{
                  color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                }}
              >
                {t("licensing.status_page.grace_ends")}
              </dt>
              <dd
                className="font-data font-semibold"
                style={{ color: "var(--color-urgency)" }}
              >
                {daysUntilGracePeriodEnd <= 0
                  ? t("licensing.status_page.grace_expired")
                  : t("licensing.status_page.grace_days_remaining", {
                      count: daysUntilGracePeriodEnd,
                    })}
              </dd>
            </div>
          )}
      </dl>
    </div>
  );
};
