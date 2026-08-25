/**
 * CurrentPlanBenefits — compact benefit read-out of the active plan.
 *
 * Renders the capacity line (locations / workstations, with the 999 sentinel
 * resolved to "ilimitados") and the plan's feature set as a dense chip grid,
 * directly under the status hero on the merged subscription screen.
 *
 * @category Component
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2Icon,
  CheckIcon,
  MonitorIcon,
} from "@/components/ui/icons";
import { FEATURE_LABELS } from "./license-status.helpers";
import { isUnlimitedLocations } from "./plan-comparison.helpers";

export interface CurrentPlanBenefitsProps {
  features: readonly string[];
  maxLocations: number | null;
  maxWorkstationsPerLocation: number | null;
}

export const CurrentPlanBenefits: FC<CurrentPlanBenefitsProps> = ({
  features,
  maxLocations,
  maxWorkstationsPerLocation,
}) => {
  const { t } = useTranslation();
  const unlimitedLocations = isUnlimitedLocations(maxLocations, features);

  return (
    <div className="mt-pos-md">
      <div className="mb-pos-sm flex flex-wrap gap-pos-md text-body-sm text-ink">
        <span className="inline-flex items-center gap-pos-xs">
          <Building2Icon className="h-4 w-4 text-pharma" aria-hidden="true" />
          {unlimitedLocations
            ? t("licensing.subscription.unlimited_locations")
            : t("licensing.status_page.max_locations", { count: maxLocations ?? 0 })}
        </span>
        {maxWorkstationsPerLocation !== null && (
          <span className="inline-flex items-center gap-pos-xs">
            <MonitorIcon className="h-4 w-4 text-pharma" aria-hidden="true" />
            {t("licensing.status_page.max_workstations", {
              count: maxWorkstationsPerLocation,
            })}
          </span>
        )}
      </div>

      {features.length > 0 && (
        <ul
          className="flex flex-wrap gap-pos-xs"
          aria-label={t("licensing.status_page.features_title")}
        >
          {features.map((feature) => (
            <li
              key={feature}
              className="inline-flex items-center gap-1 rounded-pos border border-border bg-panel px-pos-sm py-0.5 text-caption text-ink"
            >
              <CheckIcon className="h-3 w-3 flex-shrink-0 text-pharma" aria-hidden="true" />
              {t(FEATURE_LABELS[feature] ?? feature)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
