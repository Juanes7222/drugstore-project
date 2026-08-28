/**
 * Company configuration tab — expediente fiscal dossier.
 *
 * Redesign 2026-08: dense, document-grounded layout that echoes the
 * Colombian RUT casilla grid rather than a generic SaaS settings card.
 * Small eyebrow labels (10px uppercase), JetBrains Mono for every precise
 * value, gap-px grid with panel cells, and a single stamped sync seal.
 * Motion is stagger-entrance only (Emil: invisible polish, not decoration).
 *
 * Identity data stays the single source of truth from CompanyDraft — never
 * typed here, always auto-filled from the RUT / company-setup wizard.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Building2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  FileTextIcon,
  ArrowUpFromLineIcon,
  CheckIcon,
  MapPinIcon,
  PhoneIcon,
  ShieldIcon,
  TagIcon,
  Settings2Icon,
} from "@/components/ui/icons";
import { useCompanySetup } from "@/hooks/use-company-setup";
import {
  formatNit,
  mapRegimenToTaxLevelCode,
} from "../../../domain/company";
import type {
  TenantConfig,
  EffectiveConfig,
  CustomCompanyField,
} from "../../../domain/config";
import { FieldRequirementIndicator } from "./field-requirement-indicator";

// ---------------------------------------------------------------------------
// Helpers — VAT derivation (mirrors fiscal-config-tab logic)
// ---------------------------------------------------------------------------

function defaultVatFraction(regimen: string, orgType: string | null): number {
  const upper = regimen.toUpperCase();
  if (
    upper.includes("NO RESPONSABLE") ||
    upper.includes("NO_RESPONSABLE") ||
    upper.includes("EXENTO") ||
    upper.includes("EXCLUIDO") ||
    upper.includes("SIMPLIFICADO") ||
    upper.includes("SIMPLE") ||
    upper.includes("SIN ANIMO") ||
    upper.includes("SIN ÁNIMO")
  ) {
    return 0;
  }
  const code = mapRegimenToTaxLevelCode(regimen, orgType);
  return code === "R-99-PN" || code === "R-99-PJ" ? 0.19 : 0;
}

// ---------------------------------------------------------------------------
// Small presentational atoms
// ---------------------------------------------------------------------------

interface EyebrowProps {
  children: string;
}

const Eyebrow: FC<EyebrowProps> = ({ children }) => (
  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
    {children}
  </span>
);

interface FieldCellProps {
  label: string;
  value: string;
  mono?: boolean;
  span?: 1 | 2 | 3;
}

const FieldCell: FC<FieldCellProps> = ({ label, value, mono = false, span = 1 }) => (
  <div
    className={`flex flex-col gap-1 bg-panel px-3 py-2.5 ${
      span === 2 ? "col-span-2" : ""
    } ${span === 3 ? "col-span-3 sm:col-span-2 lg:col-span-3" : ""}`}
  >
    <Eyebrow>{label}</Eyebrow>
    <span
      className={`truncate text-[13px] font-semibold leading-tight text-ink ${
        mono ? "font-data tabular-nums" : ""
      } ${value === "—" ? "font-normal text-ink-muted" : ""}`}
      title={value}
    >
      {value}
    </span>
  </div>
);

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
  onOpenCompanySetup?: () => void;
}

// ---------------------------------------------------------------------------
// Motion variants — Emil: entrance only, 60ms stagger, short 250ms easeOut
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

const sectionVariants = {
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const },
  },
};

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
  const vatFraction = draft ? defaultVatFraction(draft.regimen, draft.organizationType) : 0;
  const vatLabel = `${Math.round(vatFraction * 100)} %`;

  // Completeness chips — small dossier meta
  const filledFields = draft
    ? [
        draft.name,
        draft.nit,
        draft.regimen,
        draft.address,
        draft.municipio,
        draft.phone,
        draft.email,
      ].filter(Boolean).length
    : 0;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      {/* ── Dossier header card ──────────────────────────────────────── */}
      <motion.section
        variants={sectionVariants}
        aria-labelledby="company-profile-heading"
        className="overflow-hidden rounded-md border border-border bg-panel"
        style={{ boxShadow: "var(--shadow-pos-panel)" }}
      >
        {/* top hairline — dossier edge */}
        <div className="h-[2px] w-full bg-pharma" aria-hidden="true" />

        {/* header row */}
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-sm border"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--color-pharma) 9%, white)",
                  borderColor: "color-mix(in srgb, var(--color-pharma) 18%, transparent)",
                  color: "var(--color-pharma)",
                }}
                aria-hidden="true"
              >
                <Building2Icon size={14} strokeWidth={1.7} />
              </span>
              <h3
                id="company-profile-heading"
                className="text-[13px] font-bold uppercase tracking-wide text-ink"
              >
                {t("config.company_profile.title")}
              </h3>
              <span
                className="hidden h-3 w-px bg-border sm:block"
                aria-hidden="true"
              />
              <span className="hidden text-[11px] tracking-wide text-ink-muted sm:inline">
                {t("config.company_profile.sync_hint")}
              </span>
              {isConfigured && (
                <span className="inline-flex items-center gap-1 rounded-full border border-pharma/20 bg-success-container px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pharma">
                  <CheckIcon size={10} strokeWidth={2.5} aria-hidden="true" />
                  {t("config.company_profile.rut_synced_badge").split("—")[0]?.trim() ??
                    "Sincronizado"}
                </span>
              )}
            </div>

            {/* collapsed hint on mobile */}
            <p className="mt-1.5 text-[11px] leading-snug text-ink-muted sm:hidden">
              {t("config.company_profile.sync_hint")}
            </p>

            {isConfigured && draft && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-sm bg-surface-variant px-1.5 py-0.5 font-data text-[10px] tabular-nums text-ink">
                  <span aria-hidden="true" className="font-bold">#</span>
                  NIT {formatNit(draft.nit)}-{draft.dv}
                </span>
                <span className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  <ShieldIcon size={10} strokeWidth={1.7} aria-hidden="true" />
                  {draft.regimen || t("config.fiscal.value_unavailable")} · {vatLabel}
                </span>
                {draft.ciiu && (
                  <span className="inline-flex items-center rounded-sm border border-border px-1.5 py-0.5 font-data text-[10px] tabular-nums text-ink-muted">
                    CIIU {draft.ciiu}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* actions — compact, icon-forward */}
          {!readOnly && onOpenCompanySetup && (
            <div className="flex shrink-0 items-center gap-1.5">
              {isConfigured ? (
                <>
                  <button
                    type="button"
                    onClick={onOpenCompanySetup}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-panel px-2.5 py-1.5 text-[12px] font-semibold text-ink transition-colors hover:bg-surface-variant focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
                  >
                    <PencilIcon size={12} strokeWidth={1.7} aria-hidden="true" />
                    {t("config.company_profile.edit")}
                  </button>
                  <button
                    type="button"
                    onClick={onOpenCompanySetup}
                    className="inline-flex items-center gap-1.5 rounded-sm bg-pharma px-2.5 py-1.5 text-[12px] font-semibold text-white transition-[filter,transform] hover:brightness-[1.06] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
                    title={t("config.company_profile.update_rut_hint")}
                  >
                    <ArrowUpFromLineIcon size={12} strokeWidth={1.7} aria-hidden="true" />
                    <span className="hidden sm:inline">
                      {t("config.company_profile.update_rut")}
                    </span>
                    <span className="sm:hidden">RUT</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onOpenCompanySetup}
                  className="inline-flex items-center gap-1.5 rounded-sm bg-pharma px-3 py-2 text-[12px] font-semibold text-white transition-[filter,transform] hover:brightness-[1.06] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
                >
                  <FileTextIcon size={13} strokeWidth={1.7} aria-hidden="true" />
                  {t("config.company_profile.configure")}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Dossier grid ─────────────────────────────────────────── */}
        {isConfigured && draft ? (
          <div className="border-t border-border">
            {/* Identificación — gap-px dossier table */}
            <div className="flex items-center gap-2 bg-surface-variant px-4 py-2 sm:px-5">
              <Building2Icon
                size={11}
                strokeWidth={1.7}
                className="shrink-0 text-ink-muted"
                aria-hidden="true"
              />
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                {t("config.company_profile.section_identity")}
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              <span className="hidden text-[10px] tabular-nums text-ink-muted sm:inline">
                {filledFields}/7 · NIT-DV verificado
              </span>
            </div>
            <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
              <FieldCell
                label={t("config.fiscal.legal_name")}
                value={draft.name}
                span={3}
              />
              <FieldCell
                label={t("config.fiscal.nit_dv")}
                value={`${formatNit(draft.nit)}-${draft.dv}`}
                mono
              />
              <FieldCell
                label={t("company_setup.review.regimen")}
                value={draft.regimen || t("config.fiscal.value_unavailable")}
              />
              <FieldCell
                label={`${t("company_setup.review.ciiu")} · IVA`}
                value={`${draft.ciiu ?? "—"} · ${vatLabel}`}
                mono
              />
              {draft.organizationType && (
                <FieldCell
                  label={t("config.company_profile.organization_type")}
                  value={draft.organizationType}
                />
              )}
            </div>

            {/* Ubicación */}
            <div className="flex items-center gap-2 bg-surface-variant px-4 py-2 sm:px-5">
              <MapPinIcon
                size={11}
                strokeWidth={1.7}
                className="shrink-0 text-ink-muted"
                aria-hidden="true"
              />
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                {t("config.company_profile.section_location")}
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </div>
            <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-3">
              <FieldCell
                label={t("config.fiscal.address")}
                value={draft.address ?? "—"}
                span={3}
              />
              <FieldCell
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
              <FieldCell
                label={t("company_setup.review.departamento")}
                value={draft.departamento ?? "—"}
              />
              <FieldCell
                label="DANE"
                value={draft.municipioCode ?? "—"}
                mono
              />
            </div>

            {/* Contacto */}
            <div className="flex items-center gap-2 bg-surface-variant px-4 py-2 sm:px-5">
              <PhoneIcon
                size={11}
                strokeWidth={1.7}
                className="shrink-0 text-ink-muted"
                aria-hidden="true"
              />
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                {t("config.company_profile.section_contact")}
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </div>
            <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
              <FieldCell
                label={t("config.fiscal.phone")}
                value={draft.phone ?? "—"}
                mono
              />
              <FieldCell
                label={t("config.fiscal.email")}
                value={draft.email ?? "—"}
              />
            </div>

            {/* Resolución strip — compact, not a full section */}
            {draft.resolutionNumber ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border bg-success-container/60 px-4 py-2.5 text-[11px] sm:px-5">
                <span className="inline-flex items-center gap-1.5 font-semibold text-pharma">
                  <span className="h-1.5 w-1.5 rounded-full bg-pharma" aria-hidden="true" />
                  DIAN {draft.resolutionNumber}
                </span>
                {draft.resolutionPrefix && (
                  <span className="font-data tabular-nums text-ink">
                    Prefijo {draft.resolutionPrefix}
                  </span>
                )}
                {draft.resolutionRangeStart && draft.resolutionRangeEnd && (
                  <span className="font-data tabular-nums text-ink">
                    · {draft.resolutionRangeStart} – {draft.resolutionRangeEnd}
                  </span>
                )}
                {(draft.resolutionValidTo ?? draft.resolutionDate) && (
                  <span className="ml-auto font-data tabular-nums text-ink-muted">
                    Vigencia{" "}
                    {(draft.resolutionValidTo ?? draft.resolutionDate ?? "").slice(0, 10)}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 border-t border-border bg-surface-variant px-4 py-2.5 text-[11px] text-ink-muted sm:px-5">
                <span className="h-1.5 w-1.5 rounded-full bg-sync" aria-hidden="true" />
                {t("config.fiscal.numbering_pending")}
              </div>
            )}
          </div>
        ) : (
          /* Empty — dossier placeholder, not a big generic card */
          <div className="border-t border-dashed border-border bg-surface-variant/50 px-6 py-8 text-center">
            <div
              className="mx-auto flex h-9 w-9 items-center justify-center rounded-sm border border-dashed border-border bg-panel"
              aria-hidden="true"
            >
              <FileTextIcon size={16} strokeWidth={1.6} className="text-ink-muted" />
            </div>
            <p className="mx-auto mt-3 max-w-[28ch] text-[13px] font-semibold text-ink">
              {t("config.company_profile.empty_title")}
            </p>
            <p className="mx-auto mt-1 max-w-[42ch] text-[12px] leading-relaxed text-ink-muted">
              {t("config.company_profile.empty_body")}
            </p>
            {!readOnly && onOpenCompanySetup && (
              <button
                type="button"
                onClick={onOpenCompanySetup}
                className="mt-4 inline-flex items-center gap-1.5 rounded-sm bg-pharma px-3 py-2 text-[12px] font-semibold text-white transition-[filter,transform] hover:brightness-[1.06] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
              >
                <FileTextIcon size={13} strokeWidth={1.7} aria-hidden="true" />
                {t("config.company_profile.configure")}
              </button>
            )}
          </div>
        )}
      </motion.section>

      {/* ── Campos personalizados — dense list ─────────────────────── */}
      <motion.section
        variants={sectionVariants}
        aria-labelledby="custom-fields-heading"
        className="overflow-hidden rounded-md border border-border bg-panel"
        style={{ boxShadow: "var(--shadow-pos-panel)" }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-sm border"
              style={{
                backgroundColor: "color-mix(in srgb, var(--color-ink) 6%, white)",
                borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                color: "var(--color-ink)",
              }}
              aria-hidden="true"
            >
              <TagIcon size={13} strokeWidth={1.7} />
            </span>
            <div>
              <h3
                id="custom-fields-heading"
                className="text-[13px] font-bold uppercase tracking-wide text-ink"
              >
                {t("config.custom_fields.title")}
              </h3>
              <p className="hidden text-[11px] text-ink-muted sm:block">
                Atributos propios de esta droguería — aparecen en factura si se configura.
              </p>
            </div>
            {effectiveConfig?.customCompanyFields &&
              effectiveConfig.customCompanyFields.length > 0 && (
                <span className="rounded-full bg-ink px-1.5 py-0.5 font-data text-[10px] font-bold tabular-nums text-white">
                  {effectiveConfig.customCompanyFields.length}
                </span>
              )}
          </div>

          {!readOnly && (
            <button
              type="button"
              onClick={onAddCustomField}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-white transition-[filter,transform] hover:brightness-[1.06] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <PlusIcon size={12} strokeWidth={2} aria-hidden="true" />
              <span className="hidden sm:inline">{t("config.custom_fields.add")}</span>
              <span className="sm:hidden">Agregar</span>
            </button>
          )}
        </div>

        {!effectiveConfig?.customCompanyFields ||
        effectiveConfig.customCompanyFields.length === 0 ? (
          <div className="border-t border-dashed border-border bg-surface-variant/40 px-4 py-6 text-center sm:px-5">
            <Settings2Icon
              size={16}
              strokeWidth={1.6}
              className="mx-auto text-ink-muted"
              aria-hidden="true"
            />
            <p className="mt-2 text-[12px] text-ink-muted">
              {t("config.custom_fields.no_fields")}
            </p>
          </div>
        ) : (
          <div className="border-t border-border">
            {/* header row — tiny, tabular */}
            <div className="hidden grid-cols-[1fr_90px_160px_72px] gap-px bg-border text-[10px] font-bold uppercase tracking-widest text-ink-muted sm:grid">
              <span className="bg-surface-variant px-3 py-1.5">Campo</span>
              <span className="bg-surface-variant px-3 py-1.5">Tipo</span>
              <span className="bg-surface-variant px-3 py-1.5">Visibilidad</span>
              <span className="bg-surface-variant px-3 py-1.5 text-right">Acción</span>
            </div>

            <div className="grid gap-px bg-border">
              {effectiveConfig.customCompanyFields.map((field) => (
                <div
                  key={field.id}
                  className="grid grid-cols-1 gap-2 bg-panel px-3 py-2.5 sm:grid-cols-[1fr_90px_160px_72px] sm:items-center sm:gap-px sm:px-0 sm:py-0"
                >
                  {/* name + key */}
                  <div className="min-w-0 px-0 sm:bg-panel sm:px-3 sm:py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold text-ink">
                        {field.name}
                      </span>
                      <span className="rounded-sm bg-surface-variant px-1 py-0.5 font-data text-[10px] tabular-nums text-ink-muted">
                        {field.key}
                      </span>
                      <FieldRequirementIndicator
                        requirement={field.required ? "REQUIRED" : "OPTIONAL"}
                      />
                    </div>
                  </div>

                  {/* type */}
                  <div className="flex items-center gap-1.5 px-0 text-[11px] text-ink-muted sm:bg-panel sm:px-3 sm:py-2.5">
                    <span className="sm:hidden text-[10px] font-bold uppercase tracking-widest text-ink-muted">
                      Tipo
                    </span>
                    <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink">
                      {t(
                        "config.custom_fields." +
                          (field.type.toLowerCase() as
                            | "text"
                            | "number"
                            | "date"
                            | "url"
                            | "email"),
                      )}
                    </span>
                  </div>

                  {/* visibility chips */}
                  <div className="flex flex-wrap items-center gap-1 px-0 sm:bg-panel sm:px-3 sm:py-2.5">
                    <span className="sm:hidden text-[10px] font-bold uppercase tracking-widest text-ink-muted">
                      Visible
                    </span>
                    {field.showOnInvoice ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success-container px-1.5 py-0.5 text-[10px] font-semibold text-pharma">
                        <FileTextIcon size={10} strokeWidth={1.7} aria-hidden="true" />
                        Factura
                      </span>
                    ) : (
                      <span className="text-[11px] text-ink-muted">—</span>
                    )}
                    {field.showOnReport ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-variant px-1.5 py-0.5 text-[10px] font-semibold text-ink">
                        Reporte
                      </span>
                    ) : null}
                  </div>

                  {/* actions */}
                  {!readOnly ? (
                    <div className="flex items-center justify-end gap-1 px-0 sm:bg-panel sm:px-3 sm:py-2">
                      <button
                        type="button"
                        onClick={() => onEditCustomField(field)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border text-ink-muted transition-colors hover:bg-surface-variant hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
                        aria-label={`${t("config.custom_fields.edit")} ${field.name}`}
                      >
                        <PencilIcon size={12} strokeWidth={1.7} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveCustomField(field.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-ink-muted transition-colors hover:bg-error-container hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error"
                        aria-label={`${t("config.custom_fields.remove")} ${field.name}`}
                      >
                        <Trash2Icon size={12} strokeWidth={1.7} aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <div className="hidden sm:block sm:bg-panel sm:px-3 sm:py-2.5" aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.section>
    </motion.div>
  );
};
