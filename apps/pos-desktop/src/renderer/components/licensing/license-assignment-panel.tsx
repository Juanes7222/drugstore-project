/**
 * Location and workstation assignment panel.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "./license-status.helpers";

export interface LicenseAssignmentPanelProps {
  locationName: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  locationRegion: string | null;
  workstationName: string | null;
  activatedAt: string | null;
}

export const LicenseAssignmentPanel: FC<LicenseAssignmentPanelProps> = ({
  locationName,
  locationAddress,
  locationCity,
  locationRegion,
  workstationName,
  activatedAt,
}) => {
  const { t } = useTranslation();

  return (
    <div className="pos-panel mb-pos-md p-pos-lg">
      <h2
        className="mb-pos-md text-ui font-semibold"
        style={{ color: "var(--color-ink)" }}
      >
        {t("licensing.status_page.assignment_section")}
      </h2>

      <dl className="space-y-pos-sm text-body-sm">
        {/* Location */}
        <div className="flex gap-pos-xs">
          <dt
            className="font-medium"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            {t("licensing.status_page.location_label")}
          </dt>
          <dd style={{ color: "var(--color-ink)" }}>
            {locationName
              ? [locationName, locationAddress, locationCity, locationRegion]
                  .filter(Boolean)
                  .join(", ")
              : "—"}
          </dd>
        </div>

        {/* Workstation */}
        <div className="flex gap-pos-xs">
          <dt
            className="font-medium"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            {t("licensing.status_page.workstation_label")}
          </dt>
          <dd style={{ color: "var(--color-ink)" }}>
            {workstationName
              ? `${workstationName}, ${t("licensing.status_page.activated_on", { date: formatDate(activatedAt) })}`
              : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
};
