/**
 * LicensePlanPanel — plan details with feature icons.
 *
 * @category Component
 */

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Building2Icon, CheckCircleIcon, MonitorIcon } from "@/components/ui/icons";
import { FEATURE_LABELS } from "./license-status.helpers";

export interface LicensePlanPanelProps {
  planName: string | null;
  planCode: string | null;
  planFeatures: string[];
  maxLocations: number | null;
  maxWorkstationsPerLocation: number | null;
}

export const LicensePlanPanel: FC<LicensePlanPanelProps> = ({
  planName,
  planCode,
  planFeatures,
  maxLocations,
  maxWorkstationsPerLocation,
}) => {
  const { t } = useTranslation();
  const displayName = planName ?? planCode ?? "—";

  return (
    <div className="rounded-pos border border-border bg-panel p-pos-lg shadow-pos-panel">
      <div className="mb-pos-md flex items-center gap-pos-sm">
        <CheckCircleIcon className="h-5 w-5 text-pharma" aria-hidden="true" />
        <h2 className="text-ui font-semibold text-ink">
          {t("licensing.status_page.plan_section")}
        </h2>
      </div>

      {/* Plan name */}
      <div className="mb-pos-md">
        <p className="text-caption font-medium text-ink-muted">
          {t("licensing.status_page.plan_name")}
        </p>
        <p className="font-data text-body font-semibold tabular-nums text-ink">
          {displayName}
        </p>
      </div>

      {/* Capacity */}
      <div className="mb-pos-md space-y-pos-xs">
        <div className="flex items-center gap-pos-sm text-body-sm text-ink-muted">
          <Building2Icon className="h-4 w-4" aria-hidden="true" />
          <span>
            {t("licensing.status_page.max_locations", {
              count: maxLocations ?? 0,
            })}
          </span>
        </div>
        <div className="flex items-center gap-pos-sm text-body-sm text-ink-muted">
          <MonitorIcon className="h-4 w-4" aria-hidden="true" />
          <span>
            {t("licensing.status_page.max_workstations", {
              count: maxWorkstationsPerLocation ?? 0,
            })}
          </span>
        </div>
      </div>

      {/* Features */}
      {planFeatures.length > 0 && (
        <div>
          <p className="mb-pos-xs text-caption font-medium text-ink-muted">
            {t("licensing.status_page.features_title")}
          </p>
          <ul className="space-y-pos-xs">
            {planFeatures.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-pos-sm text-body-sm text-ink"
              >
                <CheckCircleIcon className="h-4 w-4 flex-shrink-0 text-pharma" aria-hidden="true" />
                {t(FEATURE_LABELS[feature] ?? feature)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};