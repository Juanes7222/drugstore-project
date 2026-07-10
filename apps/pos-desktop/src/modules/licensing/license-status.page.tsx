/**
 * LicenseStatusPage — manager/admin panel showing the license details.
 *
 * Displays the current license status with domain-appropriate visual
 * treatment (green for active, amber for grace period, red for locked/
 * revoked), plan details, workstation info, and check-in history.
 *
 * Provides two actions:
 *   - "Renovar ahora": forces an immediate check-in via the license service.
 *   - "Exportar datos": mock export of local database data.
 *
 * @category Page
 */
import {
  type FC,
  useCallback,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { LicenseStatus } from "@pharmacy/shared-types";
import { useLicenseStore } from "../../domain/licensing/license.store";
import { createLicenseService } from "../../domain/licensing/license.service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LICENSE_SERVICE_BASE_URL = "http://localhost:3000";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO date string into a Spanish-locale date.
 */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

/**
 * Format an ISO date string into a short date + time for the check-in stamp.
 */
function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-ES", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

// ---------------------------------------------------------------------------
// Status descriptor
// ---------------------------------------------------------------------------

interface StatusDescriptor {
  label: string;
  bgClass: string;
  textClass: string;
  dotClass: string;
}

function getStatusDescriptor(
  status: LicenseStatus,
  t: (key: string, options?: Record<string, unknown>) => string,
  tokenExpiresAt: string | null,
): StatusDescriptor {
  switch (status) {
    case LicenseStatus.ACTIVE:
      return {
        label: t("licensing.status_page.active_label", {
          date: formatDate(tokenExpiresAt),
        }),
        bgClass: "bg-pharma",
        textClass: "text-panel",
        dotClass: "bg-panel",
      };
    case LicenseStatus.GRACE_PERIOD:
      return {
        label: t("licensing.status_page.grace_period_label", {
          date: formatDate(tokenExpiresAt),
        }),
        bgClass: "bg-urgency",
        textClass: "text-panel",
        dotClass: "bg-panel",
      };
    case LicenseStatus.LOCKED:
      return {
        label: t("licensing.status_page.locked_label"),
        bgClass: "bg-red-700",
        textClass: "text-panel",
        dotClass: "bg-panel",
      };
    case LicenseStatus.REVOKED:
      return {
        label: t("licensing.status_page.revoked_label"),
        bgClass: "bg-red-700",
        textClass: "text-panel",
        dotClass: "bg-panel",
      };
    default:
      return {
        label: t("licensing.status_page.unknown_label"),
        bgClass: "bg-sync",
        textClass: "text-panel",
        dotClass: "bg-panel",
      };
  }
}

// ---------------------------------------------------------------------------
// Plan features mapping (for display)
// ---------------------------------------------------------------------------

const FEATURE_LABELS: Record<string, string> = {
  MULTI_LOCATION: "licensing.status_page.feature_multi_location",
  ADVANCED_REPORTS: "licensing.status_page.feature_advanced_reports",
  MULTI_TERMINAL_SYNC: "licensing.status_page.feature_multi_terminal_sync",
  LABEL_PRINTING: "licensing.status_page.feature_label_printing",
  CUSTOMER_DISPLAY: "licensing.status_page.feature_customer_display",
  PRIORITY_SUPPORT: "licensing.status_page.feature_priority_support",
};

// ---------------------------------------------------------------------------
// Component
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
    // In a future phase this will call a service to export the local
    // database as CSV/JSON.
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

        {/* Actions row */}
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
      <div
        className={`mb-pos-lg inline-flex items-center gap-pos-sm rounded-pos px-pos-md py-pos-sm ${descriptor.bgClass} ${descriptor.textClass}`}
        role="status"
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${descriptor.dotClass}`}
          aria-hidden="true"
        />
        <span className="text-body-sm font-semibold">{descriptor.label}</span>
      </div>

      {/* Action feedback messages */}
      {checkInMessage && (
        <div
          className="mb-pos-md rounded-pos px-pos-md py-pos-sm text-body-sm"
          role="alert"
          style={{
            backgroundColor: checkInMessage.includes(t("licensing.status_page.checkin_success"))
              ? "color-mix(in srgb, var(--color-pharma) 10%, white)"
              : "#FFEBEE",
            border: `1px solid ${
              checkInMessage.includes(t("licensing.status_page.checkin_success"))
                ? "var(--color-pharma)"
                : "#D32F2F"
            }`,
            color: checkInMessage.includes(t("licensing.status_page.checkin_success"))
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
            backgroundColor: "color-mix(in srgb, var(--color-sync) 10%, white)",
            border: "1px solid var(--color-sync)",
            color: "var(--color-sync)",
          }}
        >
          {exportMessage}
        </div>
      )}

      {/* Plan details panel */}
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

        {/* Features list */}
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

      {/* Location & workstation panel */}
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

      {/* Check-in history panel */}
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

          {/* Grace period end — only show in GRACE_PERIOD */}
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
    </section>
  );
};
