/**
 * LicenseAssignmentPanel — location and workstation assignment.
 *
 * Shows the physical location (drugstore) and POS workstation identity.
 *
 * @category Component
 */

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { CalendarIcon, MonitorIcon, StoreIcon } from "@/components/ui/icons";
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

  const locationParts = [locationName, locationAddress, locationCity, locationRegion].filter(Boolean);
  const locationDisplay = locationParts.length > 0 ? locationParts.join(", ") : null;

  return (
    <div className="rounded-pos border border-border bg-panel p-pos-lg shadow-pos-panel">
      <div className="mb-pos-md flex items-center gap-pos-sm">
        <StoreIcon className="h-5 w-5 text-pharma" aria-hidden="true" />
        <h2 className="text-ui font-semibold text-ink">
          {t("licensing.status_page.assignment_section")}
        </h2>
      </div>

      {/* Location */}
      <div className="mb-pos-md">
        <p className="text-caption font-medium text-ink-muted">
          {t("licensing.status_page.location_label")}
        </p>
        {locationDisplay ? (
          <p className="text-body-sm text-ink">{locationDisplay}</p>
        ) : (
          <p className="text-body-sm text-ink-muted">—</p>
        )}
      </div>

      {/* Workstation */}
      <div className="mb-pos-md">
        <div className="flex items-center gap-pos-sm">
          <MonitorIcon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          <div>
            <p className="text-caption font-medium text-ink-muted">
              {t("licensing.status_page.workstation_label")}
            </p>
            <p className="text-body-sm text-ink">
              {workstationName ?? "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Activated date */}
      {activatedAt && (
        <div className="flex items-center gap-pos-sm">
          <CalendarIcon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          <div>
            <p className="text-caption font-medium text-ink-muted">
              {t("licensing.status_page.activated_label")}
            </p>
            <p className="text-body-sm text-ink">
              {formatDate(activatedAt)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
