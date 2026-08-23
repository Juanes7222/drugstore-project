/**
 * CompanySetupWizard — post-activation onboarding for the DIAN fiscal
 * emitter data (NIT, razón social, régimen, resolución de numeración).
 *
 * Composition container of the three-step flow: RUT upload (or manual
 * entry) → editable review → DIAN resolution, then a final summary before
 * submit. All parsing, persistence and validation go through
 * `useCompanySetup` (pos-local contract); this component only orchestrates
 * the views and holds the editable draft while the user moves through them.
 *
 * @category Page
 */
import { type FC, type ReactElement, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { type CompanyDraft, useCompanySetup } from "@/hooks/use-company-setup";
import { useAppDispatch } from "@/store/hooks";
import { navigateToHome } from "@/store/slices/ui-slice";
import {
  CheckIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  FileTextIcon,
  PencilIcon,
  ShieldIcon,
  type IconComponent,
} from "@/components/ui/icons";
import { LoaderIcon, SuccessCheckIcon } from "@/components/ui/icons/animated";
import { RutUploadStep, type RutUploadErrorCode } from "./rut-upload-step";
import {
  RutReviewStep,
  type CompanyIdentityField,
  type DvStatus,
} from "./rut-review-step";
import { ResolutionStep, type ResolutionField } from "./resolution-step";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type WizardView = "upload" | "review" | "resolution" | "summary" | "done";
type StepView = "upload" | "review" | "resolution";
type ParseSource = "rut" | "manual";

interface StepMeta {
  labelKey: string;
  icon: IconComponent;
}

const EMPTY_DRAFT: CompanyDraft = {
  nit: "",
  dv: "",
  name: "",
  regimen: "",
  organizationType: null,
  ciiu: "",
  municipio: "",
  municipioCode: "",
  departamento: "",
  address: "",
  phone: "",
  email: "",
  resolutionNumber: "",
  resolutionDate: "",
  resolutionPrefix: "",
  resolutionRangeStart: "",
  resolutionRangeEnd: "",
};

const STEP_ORDER: StepView[] = ["upload", "review", "resolution"];

const STEP_META: Record<StepView, StepMeta> = {
  upload: {
    labelKey: "company_setup.wizard.step_rut",
    icon: FileTextIcon,
  },
  review: {
    labelKey: "company_setup.wizard.step_review",
    icon: PencilIcon,
  },
  resolution: {
    labelKey: "company_setup.wizard.step_resolution",
    icon: ShieldIcon,
  },
};

const resolutionDateFormatter = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Render an ISO date ("yyyy-mm-dd") as "dd/mm/yyyy" for the summary view.
 * Falls back to the raw value when the string is not a parseable date.
 */
function formatResolutionDate(iso: string): string {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return resolutionDateFormatter.format(date);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CompanySetupWizard: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    draft: storedDraft,
    parsedFromRut,
    uploadRutFile,
    submitCompany,
  } = useCompanySetup();

  // ---- Flow state ----
  const [view, setView] = useState<WizardView>("upload");
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<RutUploadErrorCode | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);

  // Editable draft, seeded from whatever pos-local already holds (a previous
  // successful parse or a stored draft) so re-entering the wizard never
  // asks for the same data twice.
  const [draft, setDraft] = useState<CompanyDraft>(
    () => parsedFromRut ?? storedDraft ?? EMPTY_DRAFT,
  );

  // Where the current draft came from — set locally on parse/manual choice
  // so the review badges never depend on hook store timing.
  const [parseSource, setParseSource] = useState<ParseSource>(() =>
    parsedFromRut ? "rut" : "manual",
  );

  // A successful parse means the parser already ran its NIT-DV check, so the
  // badge reads "valid"; manual entry leaves the check digit unverified.
  const dvStatus: DvStatus = parseSource === "rut" ? "valid" : "unknown";

  // ---- Handlers ----

  const handleFileSelected = useCallback(
    async (file: File) => {
      setParseError(null);
      setIsParsing(true);
      try {
        const result = await uploadRutFile(file);
        if (result.ok) {
          setDraft(result.draft);
          setParseSource("rut");
          setView("review");
        } else {
          setParseError(result.errorCode);
        }
      } catch {
        // The parser contract resolves with a result; a rejection is a
        // genuine unexpected failure — surface it as a generic error.
        setParseError("GENERIC");
      } finally {
        setIsParsing(false);
      }
    },
    [uploadRutFile],
  );

  const handleManualEntry = useCallback(() => {
    setParseError(null);
    setDraft(EMPTY_DRAFT);
    setParseSource("manual");
    setView("review");
  }, []);

  const handleReviewFieldChange = useCallback(
    (field: CompanyIdentityField, value: string) => {
      setDraft((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleResolutionFieldChange = useCallback(
    (field: ResolutionField, value: string) => {
      setDraft((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    setSubmitFailed(false);
    setIsSubmitting(true);
    try {
      await submitCompany(draft);
      setView("done");
    } catch {
      setSubmitFailed(true);
    } finally {
      setIsSubmitting(false);
    }
  }, [draft, submitCompany]);

  const handleComplete = useCallback(() => {
    dispatch(navigateToHome());
  }, [dispatch]);

  const activeStepIndex = STEP_ORDER.indexOf(view as StepView);

  // ---- Render helpers ----

  const renderStepIndicator = (): ReactElement | null => {
    if (view === "summary" || view === "done") return null;
    return (
      <ol
        className="mb-pos-lg flex items-center gap-pos-sm"
        aria-label={t("company_setup.wizard.steps_aria")}
      >
        {STEP_ORDER.map((step, index) => {
          const isDone = index < activeStepIndex;
          const isCurrent = index === activeStepIndex;
          const Icon = STEP_META[step].icon;
          return (
            <li key={step} className="flex items-center gap-pos-sm">
              {index > 0 && (
                <span
                  className="h-px w-6"
                  style={{
                    backgroundColor: isDone
                      ? "var(--color-pharma)"
                      : "color-mix(in srgb, var(--color-ink) 20%, transparent)",
                  }}
                  aria-hidden="true"
                />
              )}
              <span
                className={`flex items-center gap-pos-xs ${
                  isCurrent ? "" : "opacity-70"
                }`}
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full"
                  style={
                    isDone
                      ? { backgroundColor: "var(--color-pharma)" }
                      : isCurrent
                        ? {
                            backgroundColor:
                              "color-mix(in srgb, var(--color-pharma) 12%, transparent)",
                            color: "var(--color-pharma)",
                          }
                        : {
                            backgroundColor:
                              "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                            color: "var(--color-ink-muted)",
                          }
                  }
                >
                  {isDone ? (
                    <CheckIcon
                      className="h-3.5 w-3.5 text-white"
                      aria-hidden="true"
                    />
                  ) : (
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </span>
                <span
                  className={`text-caption font-semibold ${
                    isCurrent ? "" : "font-medium"
                  }`}
                  style={{
                    color: isCurrent
                      ? "var(--color-ink)"
                      : "var(--color-ink-muted)",
                  }}
                >
                  {t(STEP_META[step].labelKey)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    );
  };

  const renderFooter = (): ReactElement | null => {
    if (view === "upload" || view === "done") return null;

    const isLastStep = view === "summary";
    return (
      <div className="mt-pos-lg flex items-center justify-between gap-pos-md">
        <button
          type="button"
          className="pos-button pos-button-secondary inline-flex items-center gap-pos-xs"
          onClick={() => {
            setSubmitFailed(false);
            if (view === "summary") setView("resolution");
            else if (view === "resolution") setView("review");
            else setView("upload");
          }}
          disabled={isSubmitting}
        >
          <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
          {t("common.back")}
        </button>

        {isLastStep ? (
          <button
            type="button"
            className="pos-button pos-button-primary inline-flex min-w-52 items-center justify-center gap-pos-xs py-pos-md text-ui font-bold"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <LoaderIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
            )}
            {isSubmitting
              ? t("company_setup.wizard.submitting")
              : t("company_setup.wizard.submit")}
          </button>
        ) : (
          <button
            type="button"
            className="pos-button pos-button-primary inline-flex min-w-40 items-center justify-center py-pos-md text-ui font-bold"
            onClick={() => {
              setSubmitFailed(false);
              if (view === "review") setView("resolution");
              else setView("summary");
            }}
          >
            {t("company_setup.wizard.continue")}
          </button>
        )}
      </div>
    );
  };

  // ---- Success view ----
  if (view === "done") {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center overflow-y-auto p-pos-lg"
        style={{ backgroundColor: "var(--color-surface)" }}
      >
        <div
          className="w-full max-w-md rounded-pos border border-pharma/30 bg-panel p-pos-xl text-center shadow-pos-panel"
          role="status"
        >
          <SuccessCheckIcon
            size={48}
            className="mx-auto mb-pos-md text-pharma"
            aria-hidden="true"
          />
          <h1 className="mb-pos-sm text-heading font-semibold text-ink">
            {t("company_setup.wizard.done_title")}
          </h1>
          <p className="mb-pos-lg text-body text-ink-muted">
            {t("company_setup.wizard.done_body")}
          </p>
          <button
            type="button"
            className="pos-button pos-button-primary w-full py-pos-md text-ui font-bold"
            onClick={handleComplete}
          >
            {t("company_setup.wizard.done_continue")}
          </button>
        </div>
      </div>
    );
  }

  const isSummary = view === "summary";

  return (
    <div
      className="flex h-screen flex-col items-center overflow-y-auto p-pos-lg"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <div className="w-full max-w-2xl py-pos-md">
        {/* Title */}
        <div className="mb-pos-md">
          <h1 className="text-heading font-bold text-ink">
            {isSummary
              ? t("company_setup.wizard.summary_title")
              : t("company_setup.wizard.title")}
          </h1>
          <p className="mt-pos-xs text-body-sm text-ink-muted">
            {isSummary
              ? t("company_setup.wizard.summary_subtitle")
              : t("company_setup.wizard.subtitle")}
          </p>
        </div>

        {renderStepIndicator()}

        <div className="pos-panel p-pos-xl">
          {view === "upload" && (
            <>
              <p
                className="mb-pos-sm text-caption font-semibold uppercase tracking-wide text-ink-muted"
                aria-live="polite"
              >
                {t("company_setup.wizard.step_of", {
                  current: 1,
                  total: STEP_ORDER.length,
                })}
              </p>
              <RutUploadStep
                isParsing={isParsing}
                parseError={parseError}
                onFileSelected={(file) => void handleFileSelected(file)}
                onManualEntry={handleManualEntry}
                onRetry={() => setParseError(null)}
              />
            </>
          )}

          {view === "review" && (
            <>
              <p
                className="mb-pos-sm text-caption font-semibold uppercase tracking-wide text-ink-muted"
                aria-live="polite"
              >
                {t("company_setup.wizard.step_of", {
                  current: 2,
                  total: STEP_ORDER.length,
                })}
              </p>
              <h2 className="mb-pos-xs text-ui font-semibold text-ink">
                {parseSource === "rut"
                  ? t("company_setup.review.title")
                  : t("company_setup.review.manual_title")}
              </h2>
              <p className="mb-pos-md text-body-sm text-ink-muted">
                {parseSource === "rut"
                  ? t("company_setup.review.subtitle")
                  : t("company_setup.review.manual_subtitle")}
              </p>
              <RutReviewStep
                draft={draft}
                isManual={parseSource === "manual"}
                dvStatus={dvStatus}
                onFieldChange={handleReviewFieldChange}
              />
            </>
          )}

          {view === "resolution" && (
            <>
              <p
                className="mb-pos-sm text-caption font-semibold uppercase tracking-wide text-ink-muted"
                aria-live="polite"
              >
                {t("company_setup.wizard.step_of", {
                  current: 3,
                  total: STEP_ORDER.length,
                })}
              </p>
              <ResolutionStep
                draft={draft}
                onFieldChange={handleResolutionFieldChange}
              />
            </>
          )}

          {isSummary && <SummaryTable draft={draft} />}

          {submitFailed && (
            <div
              className="mt-pos-md rounded-pos border px-pos-md py-pos-sm text-body-sm"
              role="alert"
              style={{
                backgroundColor: "var(--color-error-container)",
                borderColor: "var(--color-error)",
                color: "#C62828",
              }}
            >
              {t("company_setup.wizard.submit_error")}
            </div>
          )}
        </div>

        {renderFooter()}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Summary — read-only ledger of the assembled draft, grouped by section
// ---------------------------------------------------------------------------

interface SummaryTableProps {
  draft: CompanyDraft;
}

const SummaryTable: FC<SummaryTableProps> = ({ draft }) => {
  const { t } = useTranslation();

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    // Identity
    {
      label: t("company_setup.review.nit"),
      value: `${draft.nit}-${draft.dv}`,
      mono: true,
    },
    { label: t("company_setup.review.name"), value: draft.name },
    { label: t("company_setup.review.regimen"), value: draft.regimen },
    { label: t("company_setup.review.ciiu"), value: draft.ciiu ?? "", mono: true },
    // Location
    {
      label: t("company_setup.review.municipio"),
      value: draft.municipioCode
        ? `${draft.municipio ?? ""} (${draft.municipioCode})`
        : (draft.municipio ?? ""),
      mono: Boolean(draft.municipioCode),
    },
    {
      label: t("company_setup.review.departamento"),
      value: draft.departamento ?? "",
    },
    { label: t("company_setup.review.address"), value: draft.address ?? "" },
    // Contact
    { label: t("company_setup.review.phone"), value: draft.phone ?? "", mono: true },
    { label: t("company_setup.review.email"), value: draft.email ?? "" },
    // Resolution — the DIAN-authorized numbering
    {
      label: t("company_setup.resolution.number"),
      value: draft.resolutionNumber ?? "",
      mono: true,
    },
    {
      label: t("company_setup.resolution.date"),
      value: formatResolutionDate(draft.resolutionDate ?? ""),
    },
    {
      label: t("company_setup.resolution.prefix"),
      value: draft.resolutionPrefix,
      mono: true,
    },
    {
      label: `${t("company_setup.resolution.range_start")} — ${t(
        "company_setup.resolution.range_end",
      )}`,
      value: `${draft.resolutionRangeStart} — ${draft.resolutionRangeEnd}`,
      mono: true,
    },
  ];

  return (
    <dl className="overflow-hidden rounded-pos border border-border">
      {rows.map((row, index) => (
        <div
          key={row.label}
          className={`grid grid-cols-[10rem_1fr] items-baseline gap-pos-md px-pos-md py-pos-sm ${
            index > 0 ? "border-t border-border/70" : ""
          }`}
        >
          <dt className="text-body-sm font-medium text-ink-muted">
            {row.label}
          </dt>
          <dd
            className={`text-body-sm text-ink ${row.mono ? "font-data tabular-nums" : ""}`}
          >
            {row.value || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
};
