/**
 * LicenseCheckinPanel — check-in history with timeline indicators.
 *
 * Shows last check-in, expiry countdown, grace period status, and
 * check-in frequency for the last 30 days.
 *
 * @category Component
 */

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangleIcon, CheckCircleIcon, ClockIcon, HistoryIcon } from "@/components/ui/icons";
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
    <div className="rounded-pos border border-border bg-panel p-pos-lg shadow-pos-panel">
      <div className="mb-pos-md flex items-center gap-pos-sm">
        <HistoryIcon className="h-5 w-5 text-pharma" aria-hidden="true" />
        <h2 className="text-ui font-semibold text-ink">
          {t("licensing.status_page.checkin_section")}
        </h2>
      </div>

      <div className="space-y-pos-md">
        {/* Last check-in */}
        <div className="flex items-center gap-pos-sm">
          <ClockIcon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          <div>
            <p className="text-caption font-medium text-ink-muted">
              {t("licensing.status_page.last_checkin")}
            </p>
            <p className="text-body-sm text-ink">
              {formatDateTime(lastCheckInAt)}
            </p>
          </div>
        </div>

        {/* Days until expiry */}
        <div className="flex items-center gap-pos-sm">
          <ClockIcon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          <div>
            <p className="text-caption font-medium text-ink-muted">
              {t("licensing.status_page.days_until_expiry")}
            </p>
            <p className="font-data text-body-sm font-semibold tabular-nums text-ink">
              {daysUntilExpiry !== null && daysUntilExpiry !== undefined
                ? String(daysUntilExpiry)
                : "—"}
            </p>
          </div>
        </div>

        {/* Check-ins in last 30 days */}
        <div className="flex items-center gap-pos-sm">
          <HistoryIcon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          <div>
            <p className="text-caption font-medium text-ink-muted">
              {t("licensing.status_page.checkins_30d")}
            </p>
            <p className="font-data text-body-sm font-semibold tabular-nums text-ink">
              {checkInsLast30Days}
            </p>
          </div>
        </div>

        {/* Grace period warning */}
        {status === LicenseStatus.GRACE_PERIOD && daysUntilGracePeriodEnd !== null && (
          <div className="flex items-center gap-pos-sm">
            <AlertTriangleIcon className="h-4 w-4 text-urgency" aria-hidden="true" />
            <div>
              <p className="text-caption font-medium text-ink-muted">
                {t("licensing.status_page.grace_ends")}
              </p>
              <p className="font-data text-body-sm font-semibold tabular-nums text-urgency">
                {daysUntilGracePeriodEnd <= 0
                  ? t("licensing.status_page.grace_expired")
                  : t("licensing.status_page.grace_days_remaining", {
                      count: daysUntilGracePeriodEnd,
                    })}
              </p>
            </div>
          </div>
        )}

        {/* Active check indicator */}
        {status === LicenseStatus.ACTIVE && (
          <div className="flex items-center gap-pos-sm">
            <CheckCircleIcon className="h-4 w-4 text-pharma" aria-hidden="true" />
            <p className="text-body-sm text-pharma">
              {t("licensing.status_page.checkin_healthy")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
