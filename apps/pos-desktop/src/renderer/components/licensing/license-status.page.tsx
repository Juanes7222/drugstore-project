/**
 * LicenseStatusPage — manager/admin panel showing the license details.
 *
 * Thin wiring container: reads license store, provides action handlers.
 * Presentational sub-components are imported from sibling files.
 *
 * Displays the current license status with domain-appropriate visual
 * treatment (green for active, amber for grace period, red for
 * locked/revoked), plan details, workstation info, and check-in history.
 *
 * @category Page
 */

import { type FC, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { createLicenseService } from "../../../domain/licensing/license.service";
import { getStatusDescriptor } from "./license-status.helpers";
import { LicenseStatusBadge } from "./license-status-badge";
import { LicensePlanPanel } from "./license-plan-panel";
import { LicenseAssignmentPanel } from "./license-assignment-panel";
import { LicenseCheckinPanel } from "./license-checkin-panel";

const LICENSE_SERVICE_BASE_URL = "http://localhost:3000";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export const LicenseStatusPage: FC = () => {
  const { t } = useTranslation();

  // Read all license state from store
  const status = useLicenseStore((s) => s.status);
  const activationToken = useLicenseStore((s) => s.activationToken);
  const tokenExpiresAt = useLicenseStore((s) => s.tokenExpiresAt);
  const planName = useLicenseStore((s) => s.planName);
  const planCode = useLicenseStore((s) => s.planCode);
  const planFeatures = useLicenseStore((s) => s.planFeatures);
  const maxLocations = useLicenseStore((s) => s.maxLocations);
  const maxWorkstationsPerLocation = useLicenseStore(
    (s) => s.maxWorkstationsPerLocation,
  );
  const locationName = useLicenseStore((s) => s.locationName);
  const locationAddress = useLicenseStore((s) => s.locationAddress);
  const locationCity = useLicenseStore((s) => s.locationCity);
  const locationRegion = useLicenseStore((s) => s.locationRegion);
  const workstationName = useLicenseStore((s) => s.workstationName);
  const activatedAt = useLicenseStore((s) => s.activatedAt);
  const lastCheckInAt = useLicenseStore((s) => s.lastCheckInAt);
  const daysUntilExpiry = useLicenseStore((s) => s.daysUntilExpiry);
  const daysUntilGracePeriodEnd = useLicenseStore(
    (s) => s.daysUntilGracePeriodEnd,
  );
  const checkInsLast30Days = useLicenseStore((s) => s.checkInsLast30Days);

  // ---- Local UI state ----

  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [checkInMessage, setCheckInMessage] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // ---- Status visual ----

  const descriptor = getStatusDescriptor(status, t, tokenExpiresAt);

  // ---- Handlers ----

  const handleCheckIn = useCallback(async () => {
    setIsCheckingIn(true);
    setCheckInMessage(null);

    try {
      const licenseService = createLicenseService({
        baseUrl: LICENSE_SERVICE_BASE_URL,
      });
      await licenseService.checkIn();
      setCheckInMessage(t("licensing.status_page.checkin_success"));
    } catch {
      setCheckInMessage(t("licensing.status_page.checkin_error"));
    } finally {
      setIsCheckingIn(false);
    }
  }, [t]);

  const handleExport = useCallback(() => {
    setExportMessage(t("licensing.status_page.export_triggered"));
    setTimeout(() => setExportMessage(null), 4_000);
  }, [t]);

  // ---- Render ----

  return (
    <section
      aria-label={t("licensing.status_page.title")}
      className="flex h-full flex-col overflow-y-auto p-pos-lg"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      {/* Page header */}
      <div className="mb-pos-lg flex items-center justify-between">
        <h1
          className="pos-page-title"
          style={{ color: "var(--color-ink)" }}
        >
          {t("licensing.status_page.title")}
        </h1>

        <div className="flex gap-pos-sm">
          <button
            type="button"
            className="pos-button pos-button-primary"
            onClick={handleCheckIn}
            disabled={isCheckingIn || !activationToken}
            aria-busy={isCheckingIn}
          >
            {isCheckingIn
              ? t("licensing.status_page.renewing")
              : t("licensing.status_page.renew_now")}
          </button>

          <button
            type="button"
            className="pos-button pos-button-secondary"
            onClick={handleExport}
          >
            {t("licensing.status_page.export_data")}
          </button>
        </div>
      </div>

      {/* Status badge */}
      <LicenseStatusBadge descriptor={descriptor} />

      {/* Action feedback messages */}
      {checkInMessage && (
        <div
          className="mb-pos-md rounded-pos px-pos-md py-pos-sm text-body-sm"
          role="alert"
          style={{
            backgroundColor: checkInMessage.includes(
              t("licensing.status_page.checkin_success"),
            )
              ? "color-mix(in srgb, var(--color-pharma) 10%, white)"
              : "#FFEBEE",
            border: `1px solid ${
              checkInMessage.includes(
                t("licensing.status_page.checkin_success"),
              )
                ? "var(--color-pharma)"
                : "#D32F2F"
            }`,
            color: checkInMessage.includes(
              t("licensing.status_page.checkin_success"),
            )
              ? "var(--color-pharma)"
              : "#C62828",
          }}
        >
          {checkInMessage}
        </div>
      )}

      {exportMessage && (
        <div
          className="mb-pos-md rounded-pos px-pos-md py-pos-sm text-body-sm"
          role="status"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-sync) 10%, white)",
            border: "1px solid var(--color-sync)",
            color: "var(--color-sync)",
          }}
        >
          {exportMessage}
        </div>
      )}

      {/* Panels */}
      <LicensePlanPanel
        planName={planName}
        planCode={planCode}
        planFeatures={planFeatures}
        maxLocations={maxLocations}
        maxWorkstationsPerLocation={maxWorkstationsPerLocation}
      />

      <LicenseAssignmentPanel
        locationName={locationName}
        locationAddress={locationAddress}
        locationCity={locationCity}
        locationRegion={locationRegion}
        workstationName={workstationName}
        activatedAt={activatedAt}
      />

      <LicenseCheckinPanel
        status={status}
        lastCheckInAt={lastCheckInAt}
        daysUntilExpiry={daysUntilExpiry}
        daysUntilGracePeriodEnd={daysUntilGracePeriodEnd}
        checkInsLast30Days={checkInsLast30Days}
      />
    </section>
  );
};
