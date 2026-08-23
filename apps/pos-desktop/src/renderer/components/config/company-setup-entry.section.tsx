/**
 * CompanySetupEntrySection — card on the admin-menu "Empresa" tab linking to
 * the DIAN fiscal-emitter wizard (company-setup screen).
 *
 * Shows the saved issuer profile (NIT + razón social) when it exists and
 * offers the edit entry point; otherwise it invites the first-time setup.
 * Pure presentation — navigation and draft data come from the parent page.
 *
 * @category Component
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { Building2Icon, PencilIcon } from "@/components/ui/icons";

export interface CompanySetupEntrySectionProps {
  /** NIT digits of the saved issuer profile, or null when unset. */
  nit: string | null;
  /** Razón social of the saved issuer profile, or null when unset. */
  name: string | null;
  /** True when a complete profile exists (edit mode available). */
  isConfigured: boolean;
  /** Opens the company-setup wizard (edit or first-time setup). */
  onOpen: () => void;
}

export const CompanySetupEntrySection: FC<CompanySetupEntrySectionProps> = ({
  nit,
  name,
  isConfigured,
  onOpen,
}) => {
  const { t } = useTranslation();

  return (
    <section
      className="rounded-sm border border-border bg-panel p-pos-md"
      aria-label={t("config.company_setup.title")}
    >
      <div className="flex items-start justify-between gap-pos-md">
        <div className="flex min-w-0 items-start gap-pos-sm">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-pharma) 12%, transparent)",
            }}
            aria-hidden="true"
          >
            <Building2Icon
              size={18}
              strokeWidth={1.5}
              style={{ color: "var(--color-pharma)" }}
            />
          </span>

          <div className="min-w-0">
            <h3 className="text-ui font-semibold text-ink">
              {t("config.company_setup.title")}
            </h3>
            <p className="mt-pos-xs text-body-sm text-ink-muted">
              {t("config.company_setup.description")}
            </p>

            {isConfigured && nit ? (
              <dl className="mt-pos-md space-y-pos-xs">
                <div className="flex items-baseline gap-pos-sm">
                  <dt className="w-28 shrink-0 text-caption font-medium text-ink-muted">
                    {t("config.company_setup.nit")}
                  </dt>
                  <dd className="font-data text-body-sm tabular-nums text-ink">
                    {nit}
                  </dd>
                </div>
                <div className="flex items-baseline gap-pos-sm">
                  <dt className="w-28 shrink-0 text-caption font-medium text-ink-muted">
                    {t("config.company_setup.name")}
                  </dt>
                  <dd className="truncate text-body-sm text-ink">{name}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-pos-md text-body-sm text-ink-muted">
                {t("config.company_setup.empty")}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          className={`pos-button inline-flex shrink-0 items-center gap-pos-xs py-pos-sm text-body-sm font-semibold ${
            isConfigured ? "pos-button-secondary" : "pos-button-primary"
          }`}
          onClick={onOpen}
        >
          <PencilIcon size={14} strokeWidth={1.5} aria-hidden="true" />
          {isConfigured
            ? t("config.company_setup.edit")
            : t("config.company_setup.configure")}
        </button>
      </div>
    </section>
  );
};