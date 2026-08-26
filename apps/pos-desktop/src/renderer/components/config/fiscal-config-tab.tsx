/**
 * Fiscal configuration tab — DIAN numbering resolution + receipt
 * presentation preferences.
 *
 * Company identity (razón social, NIT, régimen) lives in the Empresa tab
 * as the single source of truth. This tab never duplicates it — it shows
 * only fiscal-specific data: VAT rate derived from régimen, authorized
 * numbering resolution, and receipt appearance controls.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { Building2Icon } from "@/components/ui/icons";
import { CheckboxField, TextAreaField } from "./config-form-fields";
import { mapRegimenToTaxLevelCode } from "../../../domain/company";
import type { CompanyDraft } from "../../../domain/company";
import type { TenantConfig } from "../../../domain/config/types";
import { useCompanySetup } from "@/hooks/use-company-setup";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FiscalConfigTabProps {
  config: TenantConfig | null;
  readOnly: boolean;
  onFieldChange: (
    section: "fiscal" | "workflow",
    key: string,
    value: unknown,
  ) => Promise<void>;
  /** Navigate to Empresa tab — avoids duplicating identity here. */
  onNavigateToCompany?: () => void;
}

// ---------------------------------------------------------------------------
// Derived fiscal values
// ---------------------------------------------------------------------------

/**
 * Default VAT fraction implied by the regimen label.
 *
 * Fix: the previous mapper treated any unknown regimen (including
 * "NO RESPONSABLE") as R-99-PN → 19%, which displayed an incoherent
 * pair: "NO RESPONSABLE DE IVA" with "19%". Now we check the raw text
 * first: NO RESPONSABLE / EXENTO / SIMPLE / SIN ANIMO → 0%, only
 * RESPONSABLE COMÚN → 19%.
 */
function defaultVatFraction(draft: CompanyDraft): number {
  const upper = draft.regimen.toUpperCase();
  // Explicit non-responsible / exempt cases → 0%
  if (
    upper.includes("NO RESPONSABLE") ||
    upper.includes("NO_RESPONSABLE") ||
    upper.includes("EXENTO") ||
    upper.includes("EXCLUIDO") ||
    upper.includes("SIMPLIFICADO") ||
    // "RÉGIMEN SIMPLE" (tributario) also does not charge 19% IVA
    upper.includes("SIMPLE") ||
    upper.includes("SIN ANIMO") ||
    upper.includes("SIN ÁNIMO")
  ) {
    return 0;
  }
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
  onNavigateToCompany,
}) => {
  const { t } = useTranslation();
  const { draft } = useCompanySetup();

  return (
    <div className="space-y-6">
      <h3 className="text-ui font-semibold text-ink">
        {t("config.tabs.fiscal")}
      </h3>

      {/* Reference to Empresa — single source of truth banner */}
      <div
        className="flex items-start gap-pos-sm rounded-sm border px-pos-md py-pos-sm"
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--color-pharma) 8%, transparent)",
          borderColor:
            "color-mix(in srgb, var(--color-pharma) 25%, transparent)",
        }}
      >
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-pharma) 15%, transparent)",
          }}
          aria-hidden="true"
        >
          <Building2Icon
            size={14}
            strokeWidth={1.5}
            style={{ color: "var(--color-pharma)" }}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-medium text-ink">
            {t("config.fiscal.managed_in_company_title")}
          </p>
          <p className="mt-0.5 text-caption leading-snug text-ink-muted">
            {t("config.fiscal.managed_in_company_body")}
          </p>
        </div>
        {onNavigateToCompany && (
          <button
            type="button"
            onClick={onNavigateToCompany}
            className="pos-button pos-button-secondary shrink-0 text-caption font-semibold"
          >
            {t("config.fiscal.go_to_company")}
          </button>
        )}
      </div>

      {/* Fiscal resolution — the only DIAN-authorized datum typed by hand */}
      <section
        aria-labelledby="fiscal-resolution-heading"
        className="rounded-sm border border-border bg-panel p-pos-md"
        style={{ boxShadow: "var(--shadow-pos-panel)" }}
      >
        <h4
          id="fiscal-resolution-heading"
          className="text-body-sm font-semibold text-ink"
        >
          {t("config.fiscal.resolution_section_title")}
        </h4>
        <p className="mt-pos-xs max-w-prose text-caption text-ink-muted">
          {t("config.fiscal.resolution_section_hint")}
        </p>

        {draft ? (
          <>
            {/* VAT rate — fiscal-specific derived value */}
            <dl className="mt-pos-md">
              <ProfileRow
                label={t("config.fiscal.default_tax_rate")}
                value={`${defaultVatFraction(draft) * 100} %`}
                mono
              />
              <ProfileRow
                label={t("company_setup.review.regimen")}
                value={draft.regimen || t("config.fiscal.value_unavailable")}
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
                    value={(
                      draft.resolutionValidTo ??
                      draft.resolutionDate ??
                      ""
                    ).slice(0, 10)}
                    mono
                  />
                )}
              </dl>
            ) : (
              <p
                className="mt-pos-md flex items-start gap-pos-xs rounded-sm px-pos-md py-pos-sm text-body-sm text-sync"
                style={{ backgroundColor: "var(--color-surface-variant)" }}
              >
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

        <p className="mt-pos-md text-caption text-ink-muted">
          {t("config.fiscal.sync_note")}{" "}
          <a
            href={`mailto:${t("dian_habilitation.footer.support_email")}`}
            className="font-medium underline decoration-border underline-offset-2 transition-colors hover:text-pharma focus-visible:text-pharma"
          >
            {t("config.fiscal.sync_contact")}
          </a>
        </p>
      </section>

      {/* Receipt display options — legitimate presentation preferences */}
      <div
        className="space-y-pos-xs rounded-sm border border-border bg-panel p-pos-md"
        style={{ boxShadow: "var(--shadow-pos-panel)" }}
      >
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
