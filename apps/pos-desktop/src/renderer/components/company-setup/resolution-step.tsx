/**
 * ResolutionStep — optional step of the company setup wizard.
 *
 * The DIAN numbering resolution (resolución de numeración), only relevant
 * for paper/thermal invoicing under a physical resolution: electronic
 * invoicing receives its range automatically once the company is enabled
 * with the DIAN (certificate uploaded). Never comes from the RUT — typed
 * by hand from the habilitación document. Gets the Restrict Violet
 * treatment: this is the only datum in the flow typed by hand under DIAN
 * authority, the same regulatory break used for restricted-sale
 * confirmation.
 *
 * @category Component
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { CompanyDraft } from "@/hooks/use-company-setup";
import { InfoIcon, ShieldIcon } from "@/components/ui/icons";

/** The draft fields this step edits — the DIAN resolution plus the optional software habilitación ID. */
export type ResolutionField =
  | "resolutionNumber"
  | "resolutionDate"
  | "resolutionPrefix"
  | "resolutionRangeStart"
  | "resolutionRangeEnd"
  | "resolutionValidTo"
  | "softwareId";

export interface ResolutionStepProps {
  draft: CompanyDraft;
  onFieldChange: (field: ResolutionField, value: string) => void;
}

/**
 * True when the draft already carries any resolution datum entered by the
 * user. Drives the wizard's collapsible default (open when data exists,
 * collapsed on a fresh flow) and the summary's pending state. Deliberately
 * ignores `resolutionPrefix`: the parser prefills "FE" as a default, which
 * is not evidence of a physical resolution.
 */
export function hasAnyResolutionData(draft: CompanyDraft): boolean {
  return Boolean(
    draft.resolutionNumber?.trim() ||
      draft.resolutionDate?.trim() ||
      draft.resolutionRangeStart?.trim() ||
      draft.resolutionRangeEnd?.trim(),
  );
}

export const ResolutionStep: FC<ResolutionStepProps> = ({
  draft,
  onFieldChange,
}) => {
  const { t } = useTranslation();

  return (
    <div>
      {/* Why this is skippable — e-invoicing self-provisions at habilitación */}
      <p className="mb-pos-sm flex items-start gap-pos-xs text-body-sm text-ink-muted">
        <InfoIcon
          className="mt-0.5 h-4 w-4 shrink-0"
          aria-hidden="true"
        />
        {t("company_setup.resolution.optional_note")}
      </p>
      <div
        className="rounded-pos border px-pos-lg py-pos-md"
        role="region"
        aria-label={t("company_setup.resolution.title")}
        style={{
          backgroundColor: "var(--color-restrict-surface)",
          borderColor:
            "color-mix(in srgb, var(--color-restrict) 35%, transparent)",
        }}
      >
      {/* Heading — the regulatory frame, not a decorative accent */}
      <div className="mb-pos-sm flex items-center gap-pos-sm">
        <ShieldIcon
          className="h-5 w-5"
          style={{ color: "var(--color-restrict)" }}
          aria-hidden="true"
        />
        <h3
          className="text-ui font-semibold"
          style={{ color: "var(--color-restrict)" }}
        >
          {t("company_setup.resolution.title")}
        </h3>
      </div>
      <p
        className="mb-pos-md text-body-sm"
        style={{ color: "var(--color-ink-muted)" }}
      >
        {t("company_setup.resolution.subtitle")}
      </p>

      <div className="grid grid-cols-2 gap-pos-md">
        {/* Number — the one identifier cashiers most often misread, so mono */}
        <div>
          <label
            htmlFor="company-setup-resolution-number"
            className="mb-pos-xs block text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("company_setup.resolution.number")}
          </label>
          <input
            id="company-setup-resolution-number"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="pos-input font-data"
            value={draft.resolutionNumber ?? ""}
            onChange={(e) =>
              onFieldChange("resolutionNumber", e.currentTarget.value)
            }
          />
        </div>

        <div>
          <label
            htmlFor="company-setup-resolution-date"
            className="mb-pos-xs block text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("company_setup.resolution.date")}
          </label>
          <input
            id="company-setup-resolution-date"
            type="date"
            autoComplete="off"
            className="pos-input"
            value={draft.resolutionDate ?? ""}
            onChange={(e) =>
              onFieldChange("resolutionDate", e.currentTarget.value)
            }
          />
        </div>

        <div>
          <label
            htmlFor="company-setup-resolution-prefix"
            className="mb-pos-xs block text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("company_setup.resolution.prefix")}
          </label>
          <input
            id="company-setup-resolution-prefix"
            type="text"
            autoComplete="off"
            className="pos-input font-data"
            placeholder={t("company_setup.resolution.prefix_placeholder")}
            value={draft.resolutionPrefix}
            onChange={(e) =>
              onFieldChange("resolutionPrefix", e.currentTarget.value)
            }
          />
        </div>

        {/* Range — tabular mono so consecutive numbers cannot be misread */}
        <div className="grid grid-cols-2 gap-pos-sm">
          <div>
            <label
              htmlFor="company-setup-resolution-range-start"
              className="mb-pos-xs block text-body-sm font-semibold"
              style={{ color: "var(--color-ink)" }}
            >
              {t("company_setup.resolution.range_start")}
            </label>
            <input
              id="company-setup-resolution-range-start"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="pos-input font-data tabular-nums"
              value={draft.resolutionRangeStart ?? ""}
              onChange={(e) =>
                onFieldChange("resolutionRangeStart", e.currentTarget.value)
              }
            />
          </div>
          <div>
            <label
              htmlFor="company-setup-resolution-range-end"
              className="mb-pos-xs block text-body-sm font-semibold"
              style={{ color: "var(--color-ink)" }}
            >
              {t("company_setup.resolution.range_end")}
            </label>
            <input
              id="company-setup-resolution-range-end"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="pos-input font-data tabular-nums"
              value={draft.resolutionRangeEnd ?? ""}
              onChange={(e) =>
                onFieldChange("resolutionRangeEnd", e.currentTarget.value)
              }
            />
          </div>
        </div>

        {/* Software habilitación ID — optional, assigned by DIAN when the
            software is registered against this NIT. Empty until then. */}
        <div className="col-span-2">
          <label
            htmlFor="company-setup-resolution-valid-to"
            className="mb-pos-xs block text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("company_setup.resolution.valid_to")}
          </label>
          <input
            id="company-setup-resolution-valid-to"
            type="date"
            autoComplete="off"
            className="pos-input"
            value={draft.resolutionValidTo ?? ""}
            onChange={(e) =>
              onFieldChange("resolutionValidTo", e.currentTarget.value)
            }
          />
          <p
            className="mt-pos-xs text-caption"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {t("company_setup.resolution.valid_to_helper")}
          </p>
        </div>

        {/* Software habilitación ID — optional, assigned by DIAN when the
            software is registered against this NIT. Empty until then. */}
        <div className="col-span-2">
          <label
            htmlFor="company-setup-software-id"
            className="mb-pos-xs block text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("company_setup.resolution.software_id")}
          </label>
          <input
            id="company-setup-software-id"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="pos-input font-data"
            value={draft.softwareId ?? ""}
            onChange={(e) =>
              onFieldChange("softwareId", e.currentTarget.value)
            }
          />
          <p
            className="mt-pos-xs text-caption"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {t("company_setup.resolution.software_id_helper")}
          </p>
        </div>
      </div>

      <p
        className="mt-pos-md text-caption"
        style={{ color: "var(--color-ink-muted)" }}
      >
        {t("company_setup.resolution.range_note")}
      </p>
      </div>
    </div>
  );
};
