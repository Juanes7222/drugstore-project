/**
 * RutReviewStep — step 2 of the company setup wizard.
 *
 * Editable ledger of the fields the RUT parser extracted (or that the user
 * typed by hand). Every value is an input — the RUT is the document of
 * truth, but the cashier may correct it. The NIT row carries a DV badge
 * whose state comes from the parent (never computed here — DV validation is
 * business logic owned by pos-local).
 *
 * @category Component
 */
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CompanyDraft } from "@/hooks/use-company-setup";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/purchases/searchable-select";
import {
  DANE_DEPARTAMENTOS,
  findDaneMunicipioByName,
} from "../../../domain/company";

/** Verdict on the NIT check digit, supplied by the parent flow. */
export type DvStatus = "valid" | "invalid" | "unknown";

/** The draft fields this step edits — everything except the DIAN resolution. */
export type CompanyIdentityField = Exclude<
  keyof CompanyDraft,
  | "resolutionNumber"
  | "resolutionDate"
  | "resolutionPrefix"
  | "resolutionRangeStart"
  | "resolutionRangeEnd"
>;

export interface RutReviewStepProps {
  draft: CompanyDraft;
  /** True when the user chose manual entry instead of a RUT upload. */
  isManual: boolean;
  /** True when the draft was loaded from a saved server profile (edit mode). */
  savedMode?: boolean;
  dvStatus: DvStatus;
  onFieldChange: (field: CompanyIdentityField, value: string) => void;
}

const DV_BADGE_STYLE: Record<DvStatus, { background: string; color: string }> =
  {
    valid: {
      background: "var(--color-success-container)",
      color: "var(--color-success)",
    },
    invalid: {
      background: "var(--color-error-container)",
      color: "#C62828",
    },
    unknown: {
      background: "var(--color-surface-variant)",
      color: "var(--color-ink-muted)",
    },
  };

const DV_BADGE_LABEL: Record<DvStatus, string> = {
  valid: "company_setup.review.dv_valid",
  invalid: "company_setup.review.dv_invalid",
  unknown: "company_setup.review.dv_unknown",
};

// ---------------------------------------------------------------------------
// DANE catalog helpers — accent/case-insensitive lookup over all municipios
// ---------------------------------------------------------------------------

/** Legacy option id for a municipio name that has no catalog match yet. */
const LEGACY_MUNICIPIO_PREFIX = "legacy:";

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("es-CO");
}

/** Starts-with first, then contains — fastest path for a typing cashier. */
function filterMunicipios(
  options: SearchableSelectOption[],
  query: string,
): SearchableSelectOption[] {
  const needle = normalizeForSearch(query.trim());
  if (!needle) return options;
  const startsWith: SearchableSelectOption[] = [];
  const contains: SearchableSelectOption[] = [];
  for (const option of options) {
    const haystack = normalizeForSearch(option.label);
    if (haystack.startsWith(needle)) startsWith.push(option);
    else if (haystack.includes(needle)) contains.push(option);
  }
  return [...startsWith, ...contains];
}

interface FieldRowProps {
  label: string;
  labelFor: string;
  mono?: boolean;
  children: React.ReactNode;
}

/** One ledger row: label on the left, input(s) on the right. */
const FieldRow: FC<FieldRowProps> = ({ label, labelFor, mono, children }) => (
  <div
    className="grid grid-cols-[10rem_1fr] items-center gap-pos-md border-b px-pos-md py-pos-sm"
    style={{
      borderColor: "color-mix(in srgb, var(--color-ink) 8%, transparent)",
    }}
  >
    <label
      htmlFor={labelFor}
      className="text-body-sm font-medium"
      style={{ color: "var(--color-ink-muted)" }}
    >
      {label}
    </label>
    <div className={mono ? "font-data" : undefined}>{children}</div>
  </div>
);

export const RutReviewStep: FC<RutReviewStepProps> = ({
  draft,
  isManual,
  savedMode = false,
  dvStatus,
  onFieldChange,
}) => {
  const { t } = useTranslation();

  const dvBadgeStyle = DV_BADGE_STYLE[dvStatus];

  // ---- DANE municipio catalog ---------------------------------------------
  // Flat list of every municipio (1123) with its departamento as sublabel,
  // keyed by the 5-digit DANE code so a selection fills all three fields.
  const { municipioOptions, departamentoByCode } = useMemo(() => {
    const options: SearchableSelectOption[] = [];
    const departamentos = new Map<string, string>();
    for (const departamento of DANE_DEPARTAMENTOS) {
      for (const municipio of departamento.municipios) {
        options.push({
          id: municipio.cod,
          label: municipio.nombre,
          sublabel: departamento.nombre,
        });
        departamentos.set(municipio.cod, departamento.nombre);
      }
    }
    return { municipioOptions: options, departamentoByCode: departamentos };
  }, []);

  const [municipioQuery, setMunicipioQuery] = useState("");

  // A code only counts when it actually exists in the catalog; anything
  // else (RUT parse without code, stale code) falls back to the free-text
  // name shown as a legacy option, mirroring department-municipality-fields.
  const hasCatalogCode =
    draft.municipioCode != null && departamentoByCode.has(draft.municipioCode);
  const legacyMunicipioId = draft.municipio
    ? `${LEGACY_MUNICIPIO_PREFIX}${draft.municipio}`
    : null;
  const selectedMunicipioId = hasCatalogCode
    ? draft.municipioCode
    : legacyMunicipioId;

  const visibleMunicipios = useMemo(() => {
    const filtered = filterMunicipios(municipioOptions, municipioQuery);
    if (draft.municipio && !hasCatalogCode) {
      return [{ id: legacyMunicipioId as string, label: draft.municipio }, ...filtered];
    }
    return filtered;
  }, [municipioOptions, municipioQuery, draft.municipio, hasCatalogCode, legacyMunicipioId]);

  const handleMunicipioSelect = useCallback(
    (option: SearchableSelectOption) => {
      if (option.id.startsWith(LEGACY_MUNICIPIO_PREFIX)) {
        onFieldChange("municipio", option.label);
        return;
      }
      onFieldChange("municipio", option.label);
      onFieldChange("municipioCode", option.id);
      const departamentoName = departamentoByCode.get(option.id);
      if (departamentoName) onFieldChange("departamento", departamentoName);
    },
    [onFieldChange, departamentoByCode],
  );

  // Preselect from a RUT-parsed name: when the draft carries the municipio
  // but the code could not be extracted, resolve it against the catalog and
  // fill code + departamento so the cashier only confirms the match.
  useEffect(() => {
    if (!draft.municipio || draft.municipioCode) return;
    const match = findDaneMunicipioByName(
      draft.municipio,
      draft.departamento ?? undefined,
    );
    if (!match) return;
    onFieldChange("municipioCode", match.cod);
    const departamentoName = departamentoByCode.get(match.cod);
    if (departamentoName) onFieldChange("departamento", departamentoName);
  }, [draft.municipio, draft.municipioCode, departamentoByCode, onFieldChange]);

  const needsMunicipioCode =
    Boolean(draft.municipio) && !hasCatalogCode;

  return (
    <div className="flex flex-col gap-pos-md">
      {/* Source banner — parsed from RUT, typed by hand, or loaded from a
          saved profile (edit mode) */}
      <div
        className="flex items-center gap-pos-sm rounded-pos border px-pos-md py-pos-sm"
        role="status"
        style={{
          backgroundColor:
            isManual || savedMode
              ? "color-mix(in srgb, var(--color-ink) 4%, transparent)"
              : "var(--color-success-container)",
          borderColor:
            isManual || savedMode
              ? "color-mix(in srgb, var(--color-ink) 12%, transparent)"
              : "var(--color-success)",
          color:
            isManual || savedMode
              ? "var(--color-ink-muted)"
              : "var(--color-success)",
        }}
      >
        <p className="text-body-sm font-semibold">
          {savedMode
            ? t("company_setup.review.saved_badge")
            : isManual
              ? t("company_setup.review.manual_subtitle")
              : t("company_setup.review.extracted_badge")}
        </p>
      </div>

      <fieldset>
        <legend
          className="mb-pos-sm px-0 text-caption font-semibold uppercase tracking-wide"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {t("company_setup.review.section_identity")}
        </legend>

        <div
          className="rounded-pos border"
          style={{
            backgroundColor: "var(--color-panel)",
            borderColor:
              "color-mix(in srgb, var(--color-ink) 15%, transparent)",
          }}
        >
          {/* NIT + DV + validation badge */}
          <div
            className="grid grid-cols-[10rem_1fr] items-center gap-pos-md border-b px-pos-md py-pos-sm"
            style={{
              borderColor:
                "color-mix(in srgb, var(--color-ink) 8%, transparent)",
            }}
          >
            <span
              className="text-body-sm font-medium"
              style={{ color: "var(--color-ink-muted)" }}
            >
              {t("company_setup.review.nit")}
            </span>
            <div className="flex items-center gap-pos-sm">
              <input
                id="company-setup-nit"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className="pos-input font-data"
                value={draft.nit}
                onChange={(e) => onFieldChange("nit", e.currentTarget.value)}
                aria-label={`${t("company_setup.review.nit")} (${t("company_setup.review.dv")})`}
              />
              <input
                id="company-setup-dv"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={2}
                className="pos-input w-16 font-data"
                value={draft.dv}
                onChange={(e) => onFieldChange("dv", e.currentTarget.value)}
                aria-label={t("company_setup.review.dv")}
              />
              <span className="pos-badge" role="status" style={dvBadgeStyle}>
                {t(DV_BADGE_LABEL[dvStatus])}
              </span>
            </div>
          </div>

          <FieldRow
            label={t("company_setup.review.name")}
            labelFor="company-setup-name"
          >
            <input
              id="company-setup-name"
              type="text"
              autoComplete="organization"
              className="pos-input"
              value={draft.name}
              onChange={(e) => onFieldChange("name", e.currentTarget.value)}
            />
          </FieldRow>

          <FieldRow
            label={t("company_setup.review.regimen")}
            labelFor="company-setup-regimen"
          >
            <input
              id="company-setup-regimen"
              type="text"
              autoComplete="off"
              className="pos-input"
              value={draft.regimen}
              onChange={(e) => onFieldChange("regimen", e.currentTarget.value)}
            />
          </FieldRow>

          <FieldRow
            label={t("company_setup.review.ciiu")}
            labelFor="company-setup-ciiu"
            mono
          >
            <input
              id="company-setup-ciiu"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="pos-input"
              value={draft.ciiu ?? ""}
              onChange={(e) => onFieldChange("ciiu", e.currentTarget.value)}
            />
          </FieldRow>
        </div>
      </fieldset>

      <fieldset>
        <legend
          className="mb-pos-sm px-0 text-caption font-semibold uppercase tracking-wide"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {t("company_setup.review.section_location")}
        </legend>

        <div
          className="rounded-pos border"
          style={{
            backgroundColor: "var(--color-panel)",
            borderColor:
              "color-mix(in srgb, var(--color-ink) 15%, transparent)",
          }}
        >
          <div
            className="grid grid-cols-[10rem_1fr] items-center gap-pos-md border-b px-pos-md py-pos-sm"
            style={{
              borderColor:
                "color-mix(in srgb, var(--color-ink) 8%, transparent)",
            }}
          >
            <span
              className="text-body-sm font-medium"
              style={{ color: "var(--color-ink-muted)" }}
            >
              {t("company_setup.review.municipio")}
            </span>
            <div className="flex flex-col gap-pos-xs">
              <div className="flex items-center gap-pos-sm">
                <div className="min-w-0 flex-1">
                  <SearchableSelect
                    options={visibleMunicipios}
                    onSearch={setMunicipioQuery}
                    onSelect={handleMunicipioSelect}
                    selectedId={selectedMunicipioId}
                    placeholder={t("company_setup.review.select_municipio")}
                    ariaLabel={t("company_setup.review.municipio")}
                  />
                </div>
                <input
                  id="company-setup-municipio-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className="pos-input w-24 font-data"
                  value={draft.municipioCode ?? ""}
                  onChange={(e) =>
                    onFieldChange("municipioCode", e.currentTarget.value)
                  }
                  aria-label={t("company_setup.review.municipio_code")}
                />
              </div>
              {needsMunicipioCode && (
                <p
                  className="text-caption"
                  style={{ color: "var(--color-amber)" }}
                >
                  {t("company_setup.review.municipio_code_hint")}
                </p>
              )}
            </div>
          </div>

          <FieldRow
            label={t("company_setup.review.departamento")}
            labelFor="company-setup-departamento"
          >
            <input
              id="company-setup-departamento"
              type="text"
              autoComplete="address-level1"
              className="pos-input"
              value={draft.departamento ?? ""}
              onChange={(e) =>
                onFieldChange("departamento", e.currentTarget.value)
              }
            />
          </FieldRow>

          <FieldRow
            label={t("company_setup.review.address")}
            labelFor="company-setup-address"
          >
            <input
              id="company-setup-address"
              type="text"
              autoComplete="street-address"
              className="pos-input"
              value={draft.address ?? ""}
              onChange={(e) => onFieldChange("address", e.currentTarget.value)}
            />
          </FieldRow>
        </div>
      </fieldset>

      <fieldset>
        <legend
          className="mb-pos-sm px-0 text-caption font-semibold uppercase tracking-wide"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {t("company_setup.review.section_contact")}
        </legend>

        <div
          className="rounded-pos border"
          style={{
            backgroundColor: "var(--color-panel)",
            borderColor:
              "color-mix(in srgb, var(--color-ink) 15%, transparent)",
          }}
        >
          <FieldRow
            label={t("company_setup.review.phone")}
            labelFor="company-setup-phone"
            mono
          >
            <input
              id="company-setup-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className="pos-input"
              value={draft.phone ?? ""}
              onChange={(e) => onFieldChange("phone", e.currentTarget.value)}
            />
          </FieldRow>

          <FieldRow
            label={t("company_setup.review.email")}
            labelFor="company-setup-email"
          >
            <input
              id="company-setup-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              className="pos-input"
              value={draft.email ?? ""}
              onChange={(e) => onFieldChange("email", e.currentTarget.value)}
            />
          </FieldRow>
        </div>
      </fieldset>
    </div>
  );
};
