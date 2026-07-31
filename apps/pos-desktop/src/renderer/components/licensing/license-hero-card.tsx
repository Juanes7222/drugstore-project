/**
 * LicenseHeroCard — prominent status card at the top of the license page.
 *
 * Shows plan name, status badge with color coding, and expiry countdown.
 * Acts as the visual anchor for the entire license status view.
 *
 * @category Component
 */

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { ClockIcon, ShieldAlertIcon, ShieldIcon, ShieldOffIcon } from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";
import { LicenseStatus } from "@pharmacy/shared-types";

export interface LicenseHeroCardProps {
  status: LicenseStatus;
  planName: string | null;
  planCode: string | null;
  tokenExpiresAt: string | null;
  daysUntilExpiry: number | null;
  daysUntilGracePeriodEnd: number | null;
  isRenewalInProgress: boolean;
}

const STATUS_STYLES: Record<
  LicenseStatus,
  {
    border: string;
    bg: string;
    icon: FC<{ className?: string }>;
    iconColor: string;
    labelKey: string;
  }
> = {
  [LicenseStatus.ACTIVE]: {
    border: "border-l-pharma",
    bg: "bg-pharma/5",
    icon: ShieldIcon,
    iconColor: "text-pharma",
    labelKey: "licensing.status_page.active_label",
  },
  [LicenseStatus.GRACE_PERIOD]: {
    border: "border-l-urgency",
    bg: "bg-urgency/5",
    icon: ShieldAlertIcon,
    iconColor: "text-urgency",
    labelKey: "licensing.status_page.grace_period_label",
  },
  [LicenseStatus.LOCKED]: {
    border: "border-l-error",
    bg: "bg-error/5",
    icon: ShieldOffIcon,
    iconColor: "text-error",
    labelKey: "licensing.status_page.locked_label",
  },
  [LicenseStatus.REVOKED]: {
    border: "border-l-error",
    bg: "bg-error/5",
    icon: ShieldOffIcon,
    iconColor: "text-error",
    labelKey: "licensing.status_page.revoked_label",
  },
  [LicenseStatus.UNACTIVATED]: {
    border: "border-l-sync",
    bg: "bg-sync/5",
    icon: ShieldIcon,
    iconColor: "text-sync",
    labelKey: "licensing.status_page.unknown_label",
  },
};

function formatDays(days: number | null): string {
  if (days === null || days === undefined) return "—";
  return String(days);
}

export const LicenseHeroCard: FC<LicenseHeroCardProps> = ({
  status,
  planName,
  planCode,
  tokenExpiresAt,
  daysUntilExpiry,
  daysUntilGracePeriodEnd,
  isRenewalInProgress,
}) => {
  const { t } = useTranslation();
  const style = STATUS_STYLES[status] ?? STATUS_STYLES[LicenseStatus.UNACTIVATED];
  const IconComponent = style.icon;

  const displayName = planName ?? planCode ?? t("licensing.status_page.plan_unknown");

  return (
    <div
      className={`mb-pos-md rounded-pos border border-border border-l-4 ${style.border} ${style.bg} p-pos-lg`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-pos-lg">
        {/* Icon */}
        <div className={`flex-shrink-0 rounded-md bg-panel p-pos-sm shadow-pos-panel ${style.iconColor}`}>
          <IconComponent className="h-6 w-6" aria-hidden="true" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Plan name row */}
          <div className="mb-pos-xs flex items-center gap-pos-sm">
            <h2 className="text-ui font-semibold text-ink">{displayName}</h2>
            {isRenewalInProgress && (
              <span className="inline-flex items-center gap-pos-xs rounded-pos bg-sync/10 px-pos-sm py-0.5 text-caption font-medium text-sync">
                <LoaderIcon className="h-3 w-3 animate-spin" aria-hidden="true" />
                {t("licensing.status_page.renewal_pending")}
              </span>
            )}
          </div>

          {/* Status label */}
          <p className="mb-pos-sm text-body-sm text-ink-muted">
            {t(style.labelKey, { date: tokenExpiresAt ?? "—" })}
          </p>

          {/* Expiry countdown */}
          <div className="flex items-center gap-pos-md">
            {(status === LicenseStatus.ACTIVE || status === LicenseStatus.GRACE_PERIOD) && (
              <div className="flex items-center gap-pos-xs">
                <ClockIcon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                <span className="font-data text-body-sm tabular-nums text-ink">
                  {status === LicenseStatus.GRACE_PERIOD
                    ? formatDays(daysUntilGracePeriodEnd)
                    : formatDays(daysUntilExpiry)}
                </span>
                <span className="text-caption text-ink-muted">
                  {status === LicenseStatus.GRACE_PERIOD
                    ? t("licensing.status_page.grace_days_unit")
                    : t("licensing.status_page.days_unit")}
                </span>
              </div>
            )}

            {status === LicenseStatus.GRACE_PERIOD && daysUntilGracePeriodEnd !== null && daysUntilGracePeriodEnd <= 0 && (
              <span className="inline-flex items-center rounded-pos bg-error/10 px-pos-sm py-0.5 text-caption font-medium text-error">
                {t("licensing.status_page.grace_expired")}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};