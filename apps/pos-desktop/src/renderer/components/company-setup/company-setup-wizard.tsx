/**
 * CompanySetupWizard — post-activation onboarding for the DIAN fiscal
 * emitter data (NIT, razón social, régimen).
 *
 * Composition container of the flow: RUT upload (or manual entry) →
 * editable review → optional/collapsible numbering resolution → summary →
 * submit. The resolution step is skippable ("Omitir por ahora"):
 * electronic invoicing receives its range automatically once the company
 * is enabled with the DIAN, so the minimal path is RUT → review → submit.
 * All parsing, persistence and validation go through `useCompanySetup`
 * (pos-local contract); this component only orchestrates the views and
 * holds the editable draft while the user moves through them.
 *
 * @category Page
 */
import { type FC, type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type CompanyDraft, useCompanySetup } from "@/hooks/use-company-setup";
import { useAppDispatch } from "@/store/hooks";
import { navigateToHome, setActiveScreen } from "@/store/slices/ui-slice";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import {
  CheckIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  FileTextIcon,
  InfoIcon,
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
import {
  ResolutionStep,
  hasAnyResolutionData,
  type ResolutionField,
} from "./resolution-step";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type WizardView = "upload" | "review" | "resolution" | "summary" | "done";
type StepView = "upload" | "review" | "resolution";
/** Where the draft came from — RUT parse, manual typing, or saved profile. */
type ParseSource = "rut" | "manual" | "saved";

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
  softwareId: "",
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
    labelKey: "company_setup.wizard.step_resolution_optional",
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
  const billingMethod = useLicenseStore((s) => s.billingMethod);
  const {
    status,
    draft: storedDraft,
    parsedFromRut,
    uploadRutFile,
    submitCompany,
  } = useCompanySetup();

  // Edit mode: the profile already exists (server or persisted store), so
  // the wizard opens directly on the review view with the saved draft —
  // including the resolution that was stored with it.
  const isEditing = status === "complete" && storedDraft !== null;

  // ---- Flow state ----
  const [view, setView] = useState<WizardView>(() =>
    isEditing ? "review" : "upload",
  );
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<RutUploadErrorCode | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);

  // Editable draft, seeded from whatever pos-local already holds (a previous
  // successful parse or a stored draft) so re-entering the wizard never
  // asks for the same data twice. In edit mode the stored (server) draft
  // wins over any leftover parse.
  const [draft, setDraft] = useState<CompanyDraft>(
    () =>
      (isEditing ? storedDraft : null) ??
      parsedFromRut ??
      storedDraft ??
      EMPTY_DRAFT,
  );

  // Where the current draft came from — set locally on parse/manual choice
  // so the review badges never depend on hook store timing.
  const [parseSource, setParseSource] = useState<ParseSource>(() =>
    isEditing ? "saved" : parsedFromRut ? "rut" : "manual",
  );

  // A successful parse means the parser already ran its NIT-DV check, so the
  // badge reads "valid"; a saved profile was validated on its last submit.
  // Manual entry leaves the check digit unverified.
  const dvStatus: DvStatus =
    parseSource === "rut" || parseSource === "saved" ? "valid" : "unknown";

  // The resolution step is optional and collapsible. Collapsed on a fresh
  // flow (skip is the low-friction path); open when the draft already
  // carries resolution data (edit mode / re-entry) since that is what the
  // user came to see.
  const [isResolutionFormOpen, setIsResolutionFormOpen] = useState(() =>
    hasAnyResolutionData(draft),
  );

  // Guards the auto-jump below: once the user has interacted with the flow
  // (chose manual entry or uploaded a file), a late "complete" status must
  // not yank them out of their current step.
  const userStartedRef = useRef(false);

  // Status can flip to "complete" asynchronously (profile fetch resolving
  // after mount, e.g. entering the wizard right after login). Jump into the
  // review view with the loaded draft instead of asking for the RUT again.
  useEffect(() => {
    if (view !== "upload" || userStartedRef.current) return;
    if (status !== "complete" || !storedDraft) return;
    setDraft(storedDraft);
    setParseSource("saved");
    setView("review");
  }, [status, storedDraft, view]);

  // ---- Handlers ----

  const handleFileSelected = useCallback(
    async (file: File) => {
      userStartedRef.current = true;
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
    userStartedRef.current = true;
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
    // Edit mode returns to the admin menu it was opened from; onboarding
    // continues into the certificate step for self-managed plans, or into
    // the system for plans with billing included.
    if (isEditing) {
      dispatch(setActiveScreen("admin-menu"));
    } else if (useLicenseStore.getState().billingMethod === "CERTIFICATE") {
      dispatch(setActiveScreen("certificate-setup"));
    } else {
      dispatch(navigateToHome());
    }
  }, [dispatch, isEditing]);

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
    // Collapsed resolution has nothing to advance past — its prominent
    // skip button in the card body is the way forward.
    const showContinue =
      !isLastStep && !(view === "resolution" && !isResolutionFormOpen);
    return (
      <div className="mt-pos-lg flex items-center justify-between gap-pos-md">
        <button
          type="button"
          className="pos-button pos-button-secondary inline-flex items-center gap-pos-xs"
          onClick={() => {
            setSubmitFailed(false);
            // Edit mode has no upload step — back from the review view
            // exits the wizard to the admin menu.
            if (isEditing && view === "review") {
              dispatch(setActiveScreen("admin-menu"));
            } else if (view === "summary") setView("resolution");
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
        ) : showContinue ? (
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
        ) : null}
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
            {isEditing
              ? t("company_setup.wizard.edit_done_title")
              : t("company_setup.wizard.done_title")}
          </h1>
          <p className="mb-pos-lg text-body text-ink-muted">
            {isEditing
              ? t("company_setup.wizard.edit_done_body")
              : t("company_setup.wizard.done_body")}
          </p>
          <button
            type="button"
            className="pos-button pos-button-primary w-full py-pos-md text-ui font-bold"
            onClick={handleComplete}
          >
            {isEditing
              ? t("company_setup.wizard.edit_done_continue")
              : billingMethod === "CERTIFICATE"
                ? t("company_setup.wizard.next_certificate_step")
                : t("company_setup.wizard.done_continue")}
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
              : isEditing
                ? t("company_setup.wizard.edit_title")
                : t("company_setup.wizard.title")}
          </h1>
          <p className="mt-pos-xs text-body-sm text-ink-muted">
            {isSummary
              ? t("company_setup.wizard.summary_subtitle")
              : isEditing
                ? t("company_setup.wizard.edit_subtitle")
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
                  : parseSource === "saved"
                    ? t("company_setup.review.saved_title")
                    : t("company_setup.review.manual_title")}
              </h2>
              <p className="mb-pos-md text-body-sm text-ink-muted">
                {parseSource === "rut"
                  ? t("company_setup.review.subtitle")
                  : parseSource === "saved"
                    ? t("company_setup.review.saved_subtitle")
                    : t("company_setup.review.manual_subtitle")}
              </p>
              <RutReviewStep
                draft={draft}
                isManual={parseSource === "manual"}
                savedMode={parseSource === "saved"}
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
              <section
                className="rounded-pos border px-pos-lg py-pos-md"
                aria-label={t(
                  "company_setup.wizard.resolution_optional_title",
                )}
              >
                <div className="flex items-center justify-between gap-pos-md">
                  <div className="flex items-center gap-pos-sm">
                    <ShieldIcon
                      className="h-5 w-5 shrink-0"
                      style={{ color: "var(--color-restrict)" }}
                      aria-hidden="true"
                    />
                    <h2 className="text-ui font-semibold text-ink">
                      {t("company_setup.wizard.resolution_optional_title")}
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="pos-button pos-button-secondary inline-flex shrink-0 items-center gap-pos-xs py-pos-xs text-caption font-semibold"
                    aria-expanded={isResolutionFormOpen}
                    aria-controls="company-setup-resolution-form"
                    onClick={() =>
                      setIsResolutionFormOpen((open) => !open)
                    }
                  >
                    <ChevronDownIcon
                      className={`h-4 w-4 transition-transform duration-150 motion-reduce:transition-none ${
                        isResolutionFormOpen ? "" : "-rotate-90"
                      }`}
                      aria-hidden="true"
                    />
                    {isResolutionFormOpen
                      ? t("company_setup.wizard.hide_resolution_cta")
                      : t("company_setup.wizard.fill_resolution_cta")}
                  </button>
                </div>

                <p className="mt-pos-sm flex items-start gap-pos-xs text-body-sm text-ink-muted">
                  <InfoIcon
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  {t("company_setup.resolution.optional_note")}
                </p>

                {isResolutionFormOpen ? (
                  <div
                    id="company-setup-resolution-form"
                    className="mt-pos-md"
                  >
                    <ResolutionStep
                      draft={draft}
                      onFieldChange={handleResolutionFieldChange}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="pos-button pos-button-primary mt-pos-md w-full py-pos-md text-ui font-bold"
                    onClick={() => {
                      setSubmitFailed(false);
                      setView("summary");
                    }}
                  >
                    {t("company_setup.wizard.skip_for_now")}
                  </button>
                )}
              </section>
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

  // Resolution present → render its rows as before; absent → the summary
  // states that electronic invoicing self-provisions at DIAN habilitación.
  const hasResolution = hasAnyResolutionData(draft);

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
    // Resolution — the DIAN-authorized numbering (only when provided)
    ...(hasResolution
      ? [
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
          {
            label: t("company_setup.resolution.software_id"),
            value: draft.softwareId ?? "",
            mono: true,
          },
        ]
      : []),
  ];

  return (
    <>
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

      {!hasResolution && (
        <div
          className="mt-pos-md flex items-start gap-pos-sm rounded-pos border px-pos-md py-pos-sm"
          role="status"
          style={{
            backgroundColor: "var(--color-success-container)",
            borderColor:
              "color-mix(in srgb, var(--color-success) 35%, transparent)",
          }}
        >
          <InfoIcon
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: "var(--color-success)" }}
            aria-hidden="true"
          />
          <div>
            <p className="text-body-sm font-semibold text-ink">
              {t("company_setup.wizard.summary_electronic_pending_title")}
            </p>
            <p className="text-caption text-ink-muted">
              {t("company_setup.wizard.summary_electronic_pending_body")}
            </p>
          </div>
        </div>
      )}
    </>
  );
};
