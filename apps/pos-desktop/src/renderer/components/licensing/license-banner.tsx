/**
 * LicenseBanner — non-intrusive notification shown in the main POS interface.
 *
 * Reads the current license state from the Zustand store and, when appropriate,
 * renders a compact full-width banner below the sync pulse:
 *
 *   - ACTIVE & token within 7 days of expiry & online:
 *       "Su suscripción se renueva el {date}. Verifique que el pago esté al día."
 *
 *   - GRACE_PERIOD:
 *       Yellow persistent banner: "Suscripción pendiente de pago. La app sigue
 *       funcionando. Tiene hasta {date} para renovar."
 *
 *   - LOCKED:
 *       Red persistent banner: "Suscripción vencida. Contacte a su proveedor
 *       para renovar. Puede seguir viendo sus datos y exportarlos."
 *
 *   - REVOKED:
 *       Red persistent banner: "Su licencia fue revocada. Contacte a su
 *       proveedor."
 *
 *   - UNACTIVATED: No banner (the activation page takes over the full screen).
 *
 * @category Component
 */
import { type FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LicenseStatus } from "@pharmacy/shared-types";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { useOnlineStatus } from "@/hooks/use-online-status";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of days before expiry to start showing the upcoming-renewal banner. */
const UPCOMING_RENEWAL_THRESHOLD_DAYS = 7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO date string into a Spanish-locale short date.
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BannerConfig {
  visible: boolean;
  message: string;
  /** CSS class for the background colour. */
  bgClass: string;
  /** CSS class for the border colour. */
  borderClass: string;
  /** CSS class for the text colour. */
  textClass: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const LicenseBanner: FC = () => {
  const { t } = useTranslation();

  const status = useLicenseStore((s) => s.status);
  const tokenExpiresAt = useLicenseStore((s) => s.tokenExpiresAt);
  const daysUntilExpiry = useLicenseStore((s) => s.daysUntilExpiry);
  const daysUntilGracePeriodEnd = useLicenseStore(
    (s) => s.daysUntilGracePeriodEnd,
  );
  const isOnline = useOnlineStatus();

  const banner = useMemo<BannerConfig>(() => {
    // ---- UNACTIVATED — no banner (activation page is full-screen) ----
    if (status === LicenseStatus.UNACTIVATED) {
      return { visible: false, message: "", bgClass: "", borderClass: "", textClass: "" };
    }

    // ---- LOCKED ----
    if (status === LicenseStatus.LOCKED) {
      return {
        visible: true,
        message: t("licensing.banner.locked"),
        bgClass: "bg-red-50",
        borderClass: "border-red-500",
        textClass: "text-red-900",
      };
    }

    // ---- REVOKED ----
    if (status === LicenseStatus.REVOKED) {
      return {
        visible: true,
        message: t("licensing.banner.revoked"),
        bgClass: "bg-red-50",
        borderClass: "border-red-500",
        textClass: "text-red-900",
      };
    }

    // ---- GRACE_PERIOD ----
    if (status === LicenseStatus.GRACE_PERIOD) {
      return {
        visible: true,
        message: daysUntilGracePeriodEnd !== null && daysUntilGracePeriodEnd > 0
          ? t("licensing.banner.grace_period", {
              date: formatDate(tokenExpiresAt),
            })
          : t("licensing.banner.grace_expired"),
        bgClass: "bg-urgency-surface",
        borderClass: "border-urgency",
        textClass: "text-urgency",
      };
    }

    // ---- ACTIVE — only show if within the upcoming-renewal window AND online ----
    if (status === LicenseStatus.ACTIVE) {
      if (
        isOnline &&
        daysUntilExpiry !== null &&
        daysUntilExpiry >= 0 &&
        daysUntilExpiry <= UPCOMING_RENEWAL_THRESHOLD_DAYS
      ) {
        return {
          visible: true,
          message: t("licensing.banner.upcoming_renewal", {
            date: formatDate(tokenExpiresAt),
          }),
          bgClass: "bg-urgency-surface",
          borderClass: "border-urgency",
          textClass: "text-urgency",
        };
      }

      // No banner when expiry is further away or when offline (can't check payment status)
      return { visible: false, message: "", bgClass: "", borderClass: "", textClass: "" };
    }

    // ---- Fallback — no banner for unknown states ----
    return { visible: false, message: "", bgClass: "", borderClass: "", textClass: "" };
  }, [status, tokenExpiresAt, daysUntilExpiry, daysUntilGracePeriodEnd, isOnline, t]);

  if (!banner.visible) return null;

  return (
    <div
      className={`flex items-center gap-pos-sm border-b px-pos-lg py-pos-sm text-body-sm ${banner.bgClass} ${banner.borderClass} ${banner.textClass}`}
      role="alert"
    >
      {/* Alert icon */}
      <span
        aria-hidden="true"
        className="flex-shrink-0 text-ui font-bold leading-none"
      >
        ⚠
      </span>
      <span className="flex-1">{banner.message}</span>
    </div>
  );
};
