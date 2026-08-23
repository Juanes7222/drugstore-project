/**
 * CertificateStatusBanner — persistent reminder for the self-managed DIAN
 * billing plan.
 *
 * Mounted on the Home dashboard between the welcome header and the quick
 * actions. Invisible for PROVIDER plans and for a healthy certificate; the
 * three visible states grow in severity through the existing palette
 * (Restrict Violet = action needed, Urgency Amber = expires soon, error red
 * = transmission suspended). The message always carries a CTA back to the
 * certificate setup screen.
 *
 * @category Component
 */
import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "@/store/hooks";
import { setActiveScreen } from "@/store/slices/ui-slice";
import { useFiscalCertificate } from "@/hooks/use-fiscal-certificate";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { ClockIcon, ShieldAlertIcon, ShieldOffIcon } from "@/components/ui/icons";

type BannerVariant = "none" | "expiring" | "expired";

interface BannerStyle {
  surface: string;
  border: string;
  accent: string;
}

/** Render the certificate expiry as a short Colombian date. */
function formatExpiryDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export const CertificateStatusBanner: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { status, validTo, needsCertificate } = useFiscalCertificate();
  const billingMethod = useLicenseStore((s) => s.billingMethod);

  const handleOpenCertificateSetup = useCallback(() => {
    dispatch(setActiveScreen("certificate-setup"));
  }, [dispatch]);

  // Self-managed plan only — PROVIDER customers never upload a certificate.
  if (billingMethod !== "CERTIFICATE") return null;

  let variant: BannerVariant | null = null;
  if (status === "NONE" && needsCertificate) variant = "none";
  else if (status === "EXPIRING") variant = "expiring";
  else if (status === "EXPIRED") variant = "expired";
  if (!variant) return null;

  const style: BannerStyle =
    variant === "none"
      ? {
          surface: "var(--color-restrict-surface)",
          border: "var(--color-restrict)",
          accent: "var(--color-restrict)",
        }
      : variant === "expiring"
        ? {
            surface: "var(--color-urgency-surface)",
            border: "var(--color-urgency)",
            accent: "var(--color-urgency)",
          }
        : {
            surface: "var(--color-error-container)",
            border: "var(--color-error)",
            accent: "var(--color-error)",
          };

  const Icon = variant === "none" ? ShieldAlertIcon : variant === "expiring" ? ClockIcon : ShieldOffIcon;

  return (
    <div
      role="region"
      aria-label={t("certificate_banner.aria")}
      className="mb-pos-xl flex flex-col items-start gap-pos-sm rounded-pos border px-pos-md py-pos-sm sm:flex-row sm:items-center"
      style={{
        backgroundColor: style.surface,
        borderColor: "color-mix(in srgb, var(--color-ink) 15%, transparent)",
        borderLeft: `4px solid ${style.border}`,
      }}
    >
      <div className="flex items-start gap-pos-sm">
        <Icon
          className="mt-0.5 flex-shrink-0"
          size={18}
          style={{ color: style.accent }}
          aria-hidden="true"
        />
        <p className="text-body-sm font-medium text-ink">
          {variant === "none"
            ? t("certificate_banner.none_message")
            : variant === "expiring"
              ? t("certificate_banner.expiring_message", {
                  date: formatExpiryDate(validTo),
                })
              : t("certificate_banner.expired_message")}
        </p>
      </div>
      <button
        type="button"
        className="pos-button pos-button-secondary ml-auto flex-shrink-0 border-transparent px-pos-md py-pos-xs text-body-sm font-semibold"
        style={{
          backgroundColor: style.accent,
          color: "var(--color-panel)",
        }}
        onClick={handleOpenCertificateSetup}
      >
        {variant === "none" ? t("certificate_banner.none_cta") : t("certificate_banner.cta")}
      </button>
    </div>
  );
};