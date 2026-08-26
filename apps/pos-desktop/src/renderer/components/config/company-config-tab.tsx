/**
 * Company configuration tab — read-only ledger synchronized from the RUT /
 * company-setup draft, plus custom fields.
 *
 * Identity data (NIT, razón social, régimen, CIIU, municipio, dirección,
 * contacto) is the single source of truth from CompanyDraft. It is never
 * typed here — always auto-filled from the RUT upload or the initial
 * company-setup flow. Editing happens via the wizard (Editar / Actualizar
 * con nuevo RUT), not via loose TextFields that duplicate the profile.
 *
 * Custom company fields remain tenant-config managed and editable here.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  FileTextIcon,
  ArrowUpFromLineIcon,
} from "@/components/ui/icons";
import { FieldRequirementIndicator } from "./field-requirement-indicator";
import { useCompanySetup } from "@/hooks/use-company-setup";
import { formatNit } from "../../../domain/company";
import type {
  TenantConfig,
  EffectiveConfig,
  CustomCompanyField,
} from "../../../domain/config";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CompanyConfigTabProps {
  config: TenantConfig | null;
  effectiveConfig: EffectiveConfig | null;
  readOnly: boolean;
  onAddCustomField: () => void;
  onEditCustomField: (field: CustomCompanyField) => void;
  onRemoveCustomField: (fieldId: string) => Promise<void>;
  /** Opens the company-setup wizard (edit mode). */
  onOpenCompanySetup?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProfileRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

const ProfileRow: FC<ProfileRowProps> = ({ label, value, mono = false }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-x-pos-md gap-y-pos-xs border-b border-border py-pos-sm last:border-b-0">
    <dt className="text-body-sm text-ink-muted">{label}</dt>
    <dd
      className={`text-right text-body-sm font-semibold text-ink ${mono ? "font-data tabular-nums" : ""}`}
    >
      {value || "—"}
    </dd>
  </div>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CompanyConfigTab: FC<CompanyConfigTabProps> = ({
  effectiveConfig,
  readOnly,
  onAddCustomField,
  onEditCustomField,
  onRemoveCustomField,
  onOpenCompanySetup,
}) => {
  const { t } = useTranslation();
  const { draft, status } = useCompanySetup();

  const isConfigured = status === "complete" && draft !== null;

  return (
    <div className="space-y-6">
      {/* Synchronized company profile — single source of truth */}
      <section
        aria-labelledby="company-profile-heading"
        className="rounded-sm border border-border bg-panel p-pos-md"
        style={{ boxShadow: "var(--shadow-pos-panel)" }}
      >
        <div className="flex items-start justify-between gap-pos-md">
          <div>
            <h3
              id="company-profile-heading"
              className="flex items-center gap-pos-sm text-body-sm font-semibold text-ink"
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-pharma) 12%, transparent)",
                }}
                aria-hidden="true"
              >
                <Building2Icon
                  size={14}
                  strokeWidth={1.5}
                  style={{ color: "var(--color-pharma)" }}
                />
              </span>
              {t("config.company_profile.title")}
            </h3>
            <p className="mt-pos-xs max-w-prose text-caption text-ink-muted">
              {t("config.company_profile.sync_hint")}
            </p>
          </div>

          {!readOnly && isConfigured && onOpenCompanySetup && (
            <div className="flex shrink-0 flex-col gap-pos-xs sm:flex-row">
              <button
                type="button"
                onClick={onOpenCompanySetup}
                className="pos-button pos-button-secondary inline-flex items-center gap-pos-xs text-caption font-semibold"
              >
                <PencilIcon size={14} strokeWidth={1.5} aria-hidden="true" />
                {t("config.company_profile.edit")}
              </button>
              <button
                type="button"
                onClick={onOpenCompanySetup}
                className="pos-button pos-button-secondary inline-flex items-center gap-pos-xs text-caption font-semibold"
                title={t("config.company_profile.update_rut_hint")}
              >
                <ArrowUpFromLineIcon size={14} strokeWidth={1.5} aria-hidden="true" />
                {t("config.company_profile.update_rut")}
              </button>
            </div>
          )}

          {!readOnly && !isConfigured && onOpenCompanySetup && (
            <button
              type="button"
              onClick={onOpenCompanySetup}
              className="pos-button pos-button-primary inline-flex items-center gap-pos-xs text-caption font-semibold"
            >
              <FileTextIcon size={14} strokeWidth={1.5} aria-hidden="true" />
              {t("config.company_profile.configure")}
            </button>
          )}
        </div>

        {isConfigured && draft ? (
          <div className="mt-pos-md space-y-pos-md">
            {/* Identity */}
            <dl>
              <p className="mb-pos-xs text-caption font-semibold uppercase tracking-wide text-ink-muted">
                {t("config.company_profile.section_identity")}
              </p>
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
                label={t("company_setup.review.regimen")}
                value={draft.regimen || t("config.fiscal.value_unavailable")}
              />
              <ProfileRow
                label={t("company_setup.review.ciiu")}
                value={draft.ciiu ?? "—"}
                mono
              />
              {draft.organizationType && (
                <ProfileRow
                  label={t("config.company_profile.organization_type")}
                  value={draft.organizationType}
                />
              )}
            </dl>

            {/* Location */}
            <dl>
              <p className="mb-pos-xs text-caption font-semibold uppercase tracking-wide text-ink-muted">
                {t("config.company_profile.section_location")}
              </p>
              <ProfileRow
                label={t("config.fiscal.address")}
                value={draft.address ?? "—"}
              />
              <ProfileRow
                label={t("company_setup.review.municipio")}
                value={
                  draft.municipio
                    ? draft.municipioCode
                      ? `${draft.municipio} (${draft.municipioCode})`
                      : draft.municipio
                    : "—"
                }
                mono={Boolean(draft.municipioCode)}
              />
              <ProfileRow
                label={t("company_setup.review.departamento")}
                value={draft.departamento ?? "—"}
              />
            </dl>

            {/* Contact */}
            <dl>
              <p className="mb-pos-xs text-caption font-semibold uppercase tracking-wide text-ink-muted">
                {t("config.company_profile.section_contact")}
              </p>
              <ProfileRow
                label={t("config.fiscal.phone")}
                value={draft.phone ?? "—"}
                mono
              />
              <ProfileRow
                label={t("config.fiscal.email")}
                value={draft.email ?? "—"}
              />
            </dl>

            {/* RUT source badge */}
            <div
              className="flex items-center gap-pos-xs rounded-sm px-pos-sm py-pos-xs text-caption"
              style={{
                backgroundColor: "var(--color-success-container)",
                color: "var(--color-success)",
              }}
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: "var(--color-success)" }}
              />
              {t("config.company_profile.rut_synced_badge")}
            </div>
          </div>
        ) : (
          <div className="mt-pos-md rounded-sm border border-dashed border-border bg-surface-variant px-pos-md py-pos-lg text-center">
            <p className="text-body-sm font-medium text-ink">
              {t("config.company_profile.empty_title")}
            </p>
            <p className="mt-pos-xs text-caption text-ink-muted">
              {t("config.company_profile.empty_body")}
            </p>
            {!readOnly && onOpenCompanySetup && (
              <button
                type="button"
                onClick={onOpenCompanySetup}
                className="pos-button pos-button-primary mt-pos-md inline-flex items-center gap-pos-xs"
              >
                <FileTextIcon size={14} strokeWidth={1.5} aria-hidden="true" />
                {t("config.company_profile.configure")}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Custom fields section — tenant-config managed */}
      <div className="pos-divider pt-6" />
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-ui font-semibold text-ink">
            {t("config.custom_fields.title")}
          </h3>
          {!readOnly && (
            <button
              type="button"
              onClick={onAddCustomField}
              className="pos-button pos-button-primary flex items-center gap-pos-xs"
            >
              <PlusIcon size={14} strokeWidth={1.5} aria-hidden="true" />
              {t("config.custom_fields.add")}
            </button>
          )}
        </div>

        {!effectiveConfig?.customCompanyFields ||
        effectiveConfig.customCompanyFields.length === 0 ? (
          <p className="mt-pos-sm text-body-sm text-ink-muted">
            {t("config.custom_fields.no_fields")}
          </p>
        ) : (
          <div className="mt-pos-md space-y-pos-xs">
            {effectiveConfig.customCompanyFields.map((field) => (
              <div
                key={field.id}
                className="flex items-center justify-between rounded-sm border border-border bg-panel px-pos-md py-pos-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-pos-sm">
                    <span className="text-body-sm font-medium text-ink">
                      {field.name}
                    </span>
                    <span className="text-caption text-ink-muted">
                      ({field.key})
                    </span>
                    <FieldRequirementIndicator
                      requirement={field.required ? "REQUIRED" : "OPTIONAL"}
                    />
                  </div>
                  <p className="mt-0.5 text-caption text-ink-muted">
                    {t(
                      "config.custom_fields." +
                        (field.type.toLowerCase() as
                          | "text"
                          | "number"
                          | "date"
                          | "url"
                          | "email"),
                    )}
                    {field.showOnInvoice &&
                      ` — ${t("config.custom_fields.show_on_invoice")}`}
                    {field.showOnReport &&
                      ` — ${t("config.custom_fields.show_on_report")}`}
                  </p>
                </div>
                {!readOnly && (
                  <div className="ml-pos-md flex shrink-0 items-center gap-pos-xs">
                    <button
                      type="button"
                      onClick={() => onEditCustomField(field)}
                      className="pos-button pos-button-secondary p-1.5"
                      aria-label={`${t("config.custom_fields.edit")} ${field.name}`}
                    >
                      <PencilIcon
                        size={14}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveCustomField(field.id)}
                      className="pos-button pos-button-secondary p-1.5 hover:bg-error-container hover:text-error focus-visible:outline-error"
                      aria-label={`${t("config.custom_fields.remove")} ${field.name}`}
                    >
                      <Trash2Icon
                        size={14}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
