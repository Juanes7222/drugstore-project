/**
 * Plan details panel — name, capacity, and feature list.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
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

  return (
    <div className="pos-panel mb-pos-md p-pos-lg">
      <h2
        className="mb-pos-md text-ui font-semibold"
        style={{ color: "var(--color-ink)" }}
      >
        {t("licensing.status_page.plan_section")}
      </h2>

      <dl className="space-y-pos-sm text-body-sm">
        <div className="flex gap-pos-xs">
          <dt
            className="font-medium"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            {t("licensing.status_page.plan_name")}
          </dt>
          <dd
            className="font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {planName ?? planCode ?? "—"}
          </dd>
        </div>

        <div
          className="text-body-sm"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
          }}
        >
          {t("licensing.status_page.plan_capacity", {
            maxLocations: maxLocations ?? "—",
            maxWorkstationsPerLocation: maxWorkstationsPerLocation ?? "—",
          })}
        </div>
      </dl>

      {planFeatures.length > 0 && (
        <ul className="mt-pos-md space-y-pos-xs">
          {planFeatures.map((feature) => (
            <li
              key={feature}
              className="flex items-center gap-pos-sm text-body-sm"
              style={{ color: "var(--color-ink)" }}
            >
              <span
                aria-hidden="true"
                className="flex-shrink-0 font-bold"
                style={{ color: "var(--color-pharma)" }}
              >
                ✓
              </span>
              {t(FEATURE_LABELS[feature] ?? feature)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
