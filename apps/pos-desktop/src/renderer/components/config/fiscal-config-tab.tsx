/**
 * Fiscal configuration tab — synchronized fiscal profile (read-only mirror
 * of the company-setup draft) plus receipt presentation preferences.
 *
 * Fiscal identity data (regime, VAT rate, DIAN resolution, numbering) is
 * derived from the synced fiscal issuer profile and is never edited here;
 * only presentation preferences (logo/QR on receipt, header/footer text)
 * remain editable.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { CheckboxField, TextAreaField } from "./config-form-fields";
import { formatNit, mapRegimenToTaxLevelCode } from "../../../domain/company";
import type { CompanyDraft } from "../../../domain/company";
import type { TenantConfig } from "../../../domain/config/types";
import { useCompanySetup } from "@/hooks/use-company-setup";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FiscalConfigTabProps {
  config: TenantConfig | null;
  readOnly: boolean;
  onFieldChange: (section: "fiscal" | "workflow", key: string, value: unknown) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Derived fiscal values (read-only mirror of the synced profile)
// ---------------------------------------------------------------------------

/**
 * Default VAT fraction implied by the regimen label: COMÚN regimes are
 * IVA responsables (0.19), simplified/exempt/others charge no IVA.
 */
function defaultVatFraction(draft: CompanyDraft): number {
  const code = mapRegimenToTaxLevelCode(draft.regimen, draft.organizationType);
  return code === "R-99-PN" || code === "R-99-PJ" ? 0.19 : 0;
}

/** Read-only profile row: term/value pair of the synchronized fiscal data. */
interface ProfileRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

const ProfileRow: FC<ProfileRowProps> = ({ label, value, mono = false }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-x-pos-md gap-y-pos-xs border-b border-border py-pos-sm last:border-b-0">
    <dt className="text-body-sm text-ink-muted">{label}</dt>
    <dd
      className={`text-right text-body-sm font-semibold text-ink ${
        mono ? "font-data tabular-nums" : ""
      }`}
    >
      {value}
    </dd>
  </div>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FiscalConfigTab: FC<FiscalConfigTabProps> = ({
  config,
  readOnly,
  onFieldChange,
}) => {
  const { t } = useTranslation();
  const { draft } = useCompanySetup();

  return (
    <div className="space-y-6">
      <h3 className="text-ui font-semibold text-ink">
        {t("config.tabs.fiscal")}
      </h3>

      {/* Synchronized fiscal profile — read-only mirror of company-setup */}
      <section
        aria-labelledby="fiscal-profile-heading"
        className="rounded-sm border border-border bg-panel p-pos-md"
        style={{ boxShadow: "var(--shadow-pos-panel)" }}
      >
        <h4
          id="fiscal-profile-heading"
          className="text-body-sm font-semibold text-ink"
        >
          {t("config.fiscal.profile_title")}
        </h4>
        <p className="mt-pos-xs max-w-prose text-caption text-ink-muted">
          {t("config.fiscal.sync_note")}{" "}
          <a
            href={`mailto:${t("dian_habilitation.footer.support_email")}`}
            className="font-medium underline decoration-border underline-offset-2 transition-colors hover:text-pharma focus-visible:text-pharma"
          >
            {t("config.fiscal.sync_contact")}
          </a>
        </p>

        {draft ? (
          <>
            <dl className="mt-pos-md">
              <ProfileRow
                label={t("config.fiscal.legal_name")}
                value={draft.name}
              />
              <ProfileRow
                label={t("config.fiscal.nit_dv")}
                value={`${formatNit(draft.nit)}-${draft.dv}`}
                mono
              />
              <ProfileRow
                label={t("config.fiscal.tax_regime")}
                value={draft.regimen || t("config.fiscal.value_unavailable")}
              />
              <ProfileRow
                label={t("config.fiscal.default_tax_rate")}
                value={`${defaultVatFraction(draft) * 100} %`}
                mono
              />
            </dl>

            {/* Authorized numbering — present only with a saved resolution */}
            {draft.resolutionNumber ? (
              <dl className="pos-divider mt-pos-md pt-pos-md">
                <ProfileRow
                  label={t("config.fiscal.dian_resolution_number")}
                  value={draft.resolutionNumber}
                  mono
                />
                <ProfileRow
                  label={t("config.fiscal.dian_prefix")}
                  value={draft.resolutionPrefix}
                  mono
                />
                {draft.resolutionRangeStart && draft.resolutionRangeEnd && (
                  <ProfileRow
                    label={t("config.fiscal.numbering_range")}
                    value={`${draft.resolutionRangeStart}–${draft.resolutionRangeEnd}`}
                    mono
                  />
                )}
                {(draft.resolutionValidTo ?? draft.resolutionDate) && (
                  <ProfileRow
                    label={t("config.fiscal.valid_until")}
                    value={(draft.resolutionValidTo ?? draft.resolutionDate ?? "").slice(0, 10)}
                    mono
                  />
                )}
              </dl>
            ) : (
              <p className="mt-pos-md flex items-start gap-pos-xs rounded-sm px-pos-md py-pos-sm text-body-sm text-sync" style={{ backgroundColor: "var(--color-surface-variant)" }}>
                <span
                  aria-hidden="true"
                  className="mt-[7px] h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: "var(--color-sync)" }}
                />
                {t("config.fiscal.numbering_pending")}
              </p>
            )}
          </>
        ) : (
          <p className="mt-pos-md text-body-sm text-ink-muted">
            {t("config.fiscal.profile_unavailable")}
          </p>
        )}
      </section>

      {/* Receipt display options — legitimate presentation preferences */}
      <div className="space-y-pos-xs rounded-sm border border-border bg-panel p-pos-md" style={{ boxShadow: 'var(--shadow-pos-panel)' }}>
        <h4 className="text-body-sm font-semibold text-ink">
          {t("config.fiscal.receipt_section")}
        </h4>
        <CheckboxField
          label={t("config.fiscal.show_logo_on_receipt")}
          checked={config?.fiscal.showLogoOnReceipt ?? true}
          onChange={(v) => onFieldChange("fiscal", "showLogoOnReceipt", v)}
          disabled={readOnly}
        />
        <CheckboxField
          label={t("config.fiscal.show_qr_on_receipt")}
          checked={config?.fiscal.showQrOnReceipt ?? true}
          onChange={(v) => onFieldChange("fiscal", "showQrOnReceipt", v)}
          disabled={readOnly}
        />
      </div>

      {/* Header / Footer */}
      <div className="grid grid-cols-2 gap-pos-md">
        <TextAreaField
          label={t("config.fiscal.invoice_header")}
          value={config?.fiscal.invoiceHeader ?? ""}
          onChange={(v) => onFieldChange("fiscal", "invoiceHeader", v)}
          disabled={readOnly}
        />
        <TextAreaField
          label={t("config.fiscal.invoice_footer")}
          value={config?.fiscal.invoiceFooter ?? ""}
          onChange={(v) => onFieldChange("fiscal", "invoiceFooter", v)}
          disabled={readOnly}
        />
      </div>
    </div>
  );
};
