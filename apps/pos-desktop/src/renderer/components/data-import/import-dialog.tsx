/**
 * ImportDialog — generic multi-step import wizard for products and clients.
 *
 * Owns the presentation of the local data-import flow only: file selection,
 * template download, preview review, execute confirmation, and result. All
 * parsing/validation/writing goes through the ImportService exposed by the
 * service context; per-row issue messages come back verbatim in Spanish from
 * the shared Zod schemas and are rendered as-is, never translated.
 *
 * Steps:
 *   1. select  — pick a CSV/TXT/XLSX/XLS/JSON file or download a template.
 *   2. preview — totals, warnings, unmatched headers, sample rows, and
 *                per-row errors. Nothing is written yet.
 *   3. result  — execution summary, per-row failures, recent import history.
 *
 * Role visibility is exported via `canImportEntity` so host pages can hide
 * the entry button per the design mandate (roles change what is visible);
 * the service remains the authority and throws INSUFFICIENT_ROLE otherwise.
 */
import {
  type DragEvent,
  type FC,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { RoleType } from "@pharmacy/shared-types";
import {
  CLIENT_IMPORT_COLUMNS,
  PRODUCT_IMPORT_COLUMNS,
  type ImportColumnMeta,
} from "@pharmacy/shared-validation";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronLeftIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  HistoryIcon,
  XCircleIcon,
  XIcon,
} from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";
import { useImportService } from "../common/service-context";
import { DomainError } from "../../../common/domain-error";
import { saveFileWithDialog } from "../../../common/native-save";
import type {
  ImportEntityKey,
  ImportExecutionResult,
  ImportFileInput,
  ImportHistoryEntry,
  ImportPreviewResult,
  ImportRowError,
} from "../../../domain/data-import/import.types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rows of per-row errors rendered before collapsing into a "+N more" line. */
const PREVIEW_ERRORS_DISPLAY_LIMIT = 100;
/** Recent-history entries shown on the result step. */
const HISTORY_LIMIT = 5;

/** Roles that may open the import flow, mirroring ImportService.assertRoleFor
 *  including the OWNER/SAAS_ADMIN supersession rules from AuthService. */
const IMPORT_VISIBLE_ROLES: Record<ImportEntityKey, ReadonlySet<RoleType>> = {
  products: new Set([
    RoleType.INVENTORY_ASSISTANT,
    RoleType.ADMIN,
    RoleType.OWNER,
    RoleType.SAAS_ADMIN,
  ]),
  clients: new Set([
    RoleType.CASHIER,
    RoleType.ADMIN,
    RoleType.OWNER,
    RoleType.SAAS_ADMIN,
  ]),
};

/**
 * Whether the given session role may use the import flow for an entity.
 * Exported for host pages to hide the entry button; the service enforces
 * the same rule at call time.
 */
export function canImportEntity(
  entityKey: ImportEntityKey,
  sessionRole: RoleType | string | undefined,
): boolean {
  if (sessionRole === undefined) return false;
  return IMPORT_VISIBLE_ROLES[entityKey].has(sessionRole as RoleType);
}

/** Column metadata per entity — used for the sample-table headers so the
 *  preview column labels match the downloadable template exactly. */
const COLUMNS_BY_ENTITY: Record<ImportEntityKey, ImportColumnMeta[]> = {
  products: PRODUCT_IMPORT_COLUMNS,
  clients: CLIENT_IMPORT_COLUMNS,
};

const ENTITY_SLUG: Record<ImportEntityKey, string> = {
  products: "productos",
  clients: "clientes",
};

const TEMPLATE_MIME: Record<"CSV" | "XLSX", string> = {
  CSV: "text/csv;charset=utf-8;",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const TEMPLATE_EXTENSION: Record<"CSV" | "XLSX", string> = {
  CSV: "csv",
  XLSX: "xlsx",
};

type Step = "select" | "preview" | "result";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ImportDialogProps {
  entityKey: ImportEntityKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful execute so the host page can refresh its list. */
  onImported?: () => void;
}

// ---------------------------------------------------------------------------
// Animation variants (mirrors the other Radix dialogs)
// ---------------------------------------------------------------------------

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const contentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ImportDialog: FC<ImportDialogProps> = ({
  entityKey,
  open,
  onOpenChange,
  onImported,
}) => {
  const { t, i18n } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const importService = useImportService();
  const locale = i18n.language === "en" ? "en-US" : "es-CO";

  const entityLabel = t(
    entityKey === "products" ? "products.title" : "clients.title",
  );

  // ---- Step state ----
  const [step, setStep] = useState<Step>("select");
  const [pendingFile, setPendingFile] = useState<ImportFileInput | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [execution, setExecution] = useState<ImportExecutionResult | null>(
    null,
  );
  const [history, setHistory] = useState<ImportHistoryEntry[]>([]);

  // ---- Busy + error state ----
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<
    "CSV" | "XLSX" | null
  >(null);
  const [error, setError] = useState<{ title: string; detail: string | null }>(
    { title: "", detail: null },
  );
  const [isDragOver, setIsDragOver] = useState(false);
  /** Bumped on open so the file input forgets any previously chosen file. */
  const [inputKey, setInputKey] = useState(0);

  // ---- Fresh state per open ----
  useEffect(() => {
    if (!open) return;
    setStep("select");
    setPendingFile(null);
    setPreview(null);
    setExecution(null);
    setError({ title: "", detail: null });
    setIsPreviewing(false);
    setIsExecuting(false);
    setInputKey((key) => key + 1);
    setHistory(importService.listHistory().slice(0, HISTORY_LIMIT));
  }, [open, importService]);

  // ---- Domain-error → i18n copy (per the errorCode contract) ----
  const mapError = useCallback(
    (err: unknown): { title: string; detail: string | null } => {
      if (err instanceof DomainError) {
        switch (err.errorCode) {
          case "IMPORT_FILE_INVALID":
            return { title: t("import.error_file_invalid"), detail: err.message };
          case "IMPORT_VALIDATION_FAILED":
            return {
              title: t("import.error_validation_failed"),
              detail: err.message,
            };
          case "IMPORT_ROW_REJECTED":
            return { title: t("import.error_row_rejected"), detail: err.message };
          case "IMPORT_EXECUTION_FAILED":
            return {
              title: t("import.error_execution_failed"),
              detail: err.message,
            };
          case "NO_ACTIVE_SESSION":
            return { title: t("errors.no_session"), detail: null };
          case "INSUFFICIENT_ROLE":
            return {
              title: t(
                entityKey === "products"
                  ? "errors.role_inventory_admin"
                  : "errors.role_cashier_admin",
              ),
              detail: null,
            };
          default:
            return { title: t("common.unexpected_error"), detail: err.message };
        }
      }
      return {
        title: t("common.unexpected_error"),
        detail: err instanceof Error ? err.message : null,
      };
    },
    [entityKey, t],
  );

  // ---- File selection → preview ----
  const handleFileChange = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError({ title: "", detail: null });
      setIsPreviewing(true);
      try {
        const data = await file.arrayBuffer();
        const result = await importService.preview(entityKey, {
          fileName: file.name,
          data,
        });
        setPendingFile({ fileName: file.name, data });
        setPreview(result);
        setStep("preview");
      } catch (err) {
        console.error("[ImportDialog] preview failed:", err);
        setError(mapError(err));
      } finally {
        setIsPreviewing(false);
      }
    },
    [entityKey, importService, mapError],
  );

  // ---- Execute (re-validates and writes row by row) ----
  const handleConfirm = useCallback(async () => {
    if (!pendingFile) return;
    setError({ title: "", detail: null });
    setIsExecuting(true);
    try {
      const result = await importService.execute(entityKey, pendingFile);
      setExecution(result);
      setHistory(importService.listHistory().slice(0, HISTORY_LIMIT));
      setStep("result");
      onImported?.();
    } catch (err) {
      console.error("[ImportDialog] execute failed:", err);
      setError(mapError(err));
    } finally {
      setIsExecuting(false);
    }
  }, [entityKey, importService, pendingFile, mapError, onImported]);

  // ---- Template download (native save dialog, browser fallback) ----
  const handleTemplateDownload = useCallback(
    async (format: "CSV" | "XLSX") => {
      setError({ title: "", detail: null });
      setDownloadingFormat(format);
      try {
        const content = await importService.buildTemplate(entityKey, format);
        const extension = TEMPLATE_EXTENSION[format];
        await saveFileWithDialog({
          content,
          filename: `plantilla-${ENTITY_SLUG[entityKey]}.${extension}`,
          mimeType: TEMPLATE_MIME[format],
          filters: [{ name: format, extensions: [extension] }],
          title: t("import.template_dialog_title"),
        });
      } catch (err) {
        console.error("[ImportDialog] template download failed:", err);
        setError({
          title: t("import.template_download_error"),
          detail: err instanceof Error ? err.message : null,
        });
      } finally {
        setDownloadingFormat(null);
      }
    },
    [entityKey, importService, t],
  );

  // ---- Close guard: never dismiss mid-execution ----
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isExecuting) return;
      onOpenChange(nextOpen);
    },
    [isExecuting, onOpenChange],
  );

  // ---- Drag & drop ----
  const handleDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      void handleFileChange(event.dataTransfer.files?.[0]);
    },
    [handleFileChange],
  );

  const stepMeta: Record<Step, { eyebrow: string; title: string; description: string }> = {
    select: {
      eyebrow: t("import.step_select"),
      title: t("import.title", { entity: entityLabel }),
      description: t("import.select_description", { entity: entityLabel }),
    },
    preview: {
      eyebrow: t("import.step_preview"),
      title: t("import.preview_heading"),
      description: t("import.preview_description"),
    },
    result: {
      eyebrow: t("import.step_result"),
      title: t("import.result_heading"),
      description: t("import.result_description"),
    },
  };

  const meta = stepMeta[step];
  const validCount = preview?.validRows ?? 0;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        {/* Overlay */}
        <Dialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{ duration: shouldReduceMotion ? 0.01 : 0.2 }}
          />
        </Dialog.Overlay>

        {/* Content */}
        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2"
            variants={contentVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{
              duration: shouldReduceMotion ? 0.01 : 0.2,
              ease: "easeOut",
            }}
          >
            <div
              className="max-h-[calc(100dvh-2.5rem)] overflow-y-auto rounded-md bg-white shadow-lg"
              style={{
                border:
                  "1px solid color-mix(in srgb, var(--color-pharma) 18%, transparent)",
              }}
            >
              {/* ===== Header ===== */}
              <div className="flex items-start justify-between gap-3 px-6 pt-5">
                <div className="min-w-0">
                  <p
                    className="mb-1 text-caption font-semibold uppercase tracking-wider"
                    style={{
                      color:
                        "color-mix(in srgb, var(--color-pharma) 75%, transparent)",
                    }}
                  >
                    {meta.eyebrow}
                  </p>
                  <Dialog.Title
                    className="m-0 text-body font-semibold"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {meta.title}
                  </Dialog.Title>
                  <Dialog.Description
                    className="mt-1 text-body-sm"
                    style={{ color: "var(--color-ink-muted)" }}
                  >
                    {meta.description}
                  </Dialog.Description>
                </div>

                <Dialog.Close asChild>
                  <button
                    type="button"
                    disabled={isExecuting}
                    className="flex size-6 shrink-0 items-center justify-center rounded-sm opacity-50 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma disabled:opacity-30"
                    aria-label={t("common.close")}
                  >
                    <XIcon className="size-4" />
                  </button>
                </Dialog.Close>
              </div>

              {/* ===== Body ===== */}
              <div className="px-6 py-4">
                {error.title && <ErrorBanner error={error} />}

                {isPreviewing ? (
                  <div
                    className="flex flex-col items-center justify-center gap-2 py-14"
                    role="status"
                  >
                    <LoaderIcon
                      className="size-7 animate-spin"
                      style={{ color: "var(--color-pharma)" }}
                      aria-hidden="true"
                    />
                    <p
                      className="m-0 text-body-sm font-medium"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {t("import.previewing")}
                    </p>
                    <p
                      className="m-0 text-caption"
                      style={{ color: "var(--color-ink-muted)" }}
                    >
                      {t("import.previewing_description")}
                    </p>
                  </div>
                ) : (
                  <>
                    {step === "select" && (
                      <SelectStep
                        inputKey={inputKey}
                        isDragOver={isDragOver}
                        downloadingFormat={downloadingFormat}
                        onIsDragOverChange={setIsDragOver}
                        onDrop={handleDrop}
                        onFileChange={handleFileChange}
                        onTemplateDownload={handleTemplateDownload}
                      />
                    )}

                    {step === "preview" && preview && (
                      <PreviewStep
                        entityKey={entityKey}
                        preview={preview}
                        isExecuting={isExecuting}
                        locale={locale}
                      />
                    )}

                    {step === "result" && execution && (
                      <ResultStep
                        execution={execution}
                        history={history}
                        locale={locale}
                      />
                    )}
                  </>
                )}
              </div>

              {/* ===== Footer ===== */}
              <footer
                className="flex items-center gap-2 border-t px-6 py-4"
                style={{
                  borderColor:
                    "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                }}
              >
                {step === "select" && (
                  <button
                    type="button"
                    onClick={() => handleOpenChange(false)}
                    disabled={isPreviewing}
                    className="pos-button pos-button-secondary"
                  >
                    <XIcon className="size-4" aria-hidden="true" />
                    {t("common.cancel")}
                  </button>
                )}

                {step === "preview" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setStep("select")}
                      disabled={isExecuting}
                      className="pos-button pos-button-secondary"
                    >
                      <ChevronLeftIcon className="size-4" aria-hidden="true" />
                      {t("import.back")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleConfirm()}
                      disabled={isExecuting || validCount === 0}
                      className="pos-button pos-button-primary"
                    >
                      {isExecuting ? (
                        <LoaderIcon
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <CheckIcon className="size-4" aria-hidden="true" />
                      )}
                      {isExecuting
                        ? t("import.executing")
                        : validCount === 1
                          ? t("import.import_action_one")
                          : t("import.import_action", { count: validCount })}
                    </button>
                  </>
                )}

                {step === "result" && (
                  <button
                    type="button"
                    onClick={() => handleOpenChange(false)}
                    className="pos-button pos-button-primary"
                  >
                    <CheckIcon className="size-4" aria-hidden="true" />
                    {t("import.close")}
                  </button>
                )}
              </footer>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

// ---------------------------------------------------------------------------
// Step 1 — file selection + template download
// ---------------------------------------------------------------------------

interface SelectStepProps {
  inputKey: number;
  isDragOver: boolean;
  downloadingFormat: "CSV" | "XLSX" | null;
  onIsDragOverChange: (value: boolean) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onFileChange: (file: File | undefined) => void;
  onTemplateDownload: (format: "CSV" | "XLSX") => void;
}

const SelectStep: FC<SelectStepProps> = ({
  inputKey,
  isDragOver,
  downloadingFormat,
  onIsDragOverChange,
  onDrop,
  onFileChange,
  onTemplateDownload,
}) => {
  const { t } = useTranslation();

  return (
    <div className="grid gap-4">
      {/* File dropzone — label wraps the visually hidden input so the whole
          area is clickable and the input stays keyboard-focusable. */}
      <label
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-8 text-center transition-colors"
        style={{
          borderColor: isDragOver
            ? "var(--color-pharma)"
            : "color-mix(in srgb, var(--color-ink) 20%, transparent)",
          backgroundColor: isDragOver
            ? "color-mix(in srgb, var(--color-pharma) 6%, transparent)"
            : "transparent",
        }}
        onDragOver={(event) => {
          event.preventDefault();
          onIsDragOverChange(true);
        }}
        onDragLeave={() => onIsDragOverChange(false)}
        onDrop={onDrop}
      >
        <input
          key={inputKey}
          type="file"
          accept=".csv,.txt,.xlsx,.xls,.json"
          className="sr-only"
          onChange={(event) => {
            void onFileChange(event.target.files?.[0]);
            event.target.value = "";
          }}
          aria-label={t("import.file_input_label")}
        />
        <FileSpreadsheetIcon
          className="size-8"
          style={{ color: "var(--color-pharma)" }}
          aria-hidden="true"
        />
        <span className="text-body font-medium" style={{ color: "var(--color-ink)" }}>
          {t("import.drop_hint")}
        </span>
        <span className="text-caption" style={{ color: "var(--color-ink-muted)" }}>
          {t("import.file_formats")}
        </span>
      </label>

      {/* Template download */}
      <div
        className="rounded-md px-4 py-3"
        style={{
          backgroundColor: "color-mix(in srgb, var(--color-ink) 4%, transparent)",
        }}
      >
        <p className="m-0 text-body-sm font-semibold" style={{ color: "var(--color-ink)" }}>
          {t("import.template_heading")}
        </p>
        <p className="m-0 text-caption" style={{ color: "var(--color-ink-muted)" }}>
          {t("import.template_description")}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <TemplateButton
            format="CSV"
            isDownloading={downloadingFormat === "CSV"}
            disabled={downloadingFormat !== null}
            label={t("import.template_csv")}
            onClick={onTemplateDownload}
          />
          <TemplateButton
            format="XLSX"
            isDownloading={downloadingFormat === "XLSX"}
            disabled={downloadingFormat !== null}
            label={t("import.template_xlsx")}
            onClick={onTemplateDownload}
          />
        </div>
      </div>
    </div>
  );
};

const TemplateButton: FC<{
  format: "CSV" | "XLSX";
  isDownloading: boolean;
  disabled: boolean;
  label: string;
  onClick: (format: "CSV" | "XLSX") => void;
}> = ({ format, isDownloading, disabled, label, onClick }) => (
  <button
    type="button"
    onClick={() => onClick(format)}
    disabled={disabled}
    className="pos-button pos-button-secondary px-pos-sm py-pos-xs text-caption"
  >
    {isDownloading ? (
      <LoaderIcon className="size-3.5 animate-spin" aria-hidden="true" />
    ) : (
      <DownloadIcon className="size-3.5" aria-hidden="true" />
    )}
    {label}
  </button>
);

// ---------------------------------------------------------------------------
// Step 2 — preview review
// ---------------------------------------------------------------------------

interface PreviewStepProps {
  entityKey: ImportEntityKey;
  preview: ImportPreviewResult;
  isExecuting: boolean;
  locale: string;
}

const PreviewStep: FC<PreviewStepProps> = ({
  entityKey,
  preview,
  isExecuting,
  locale,
}) => {
  const { t } = useTranslation();

  return (
    <div className="grid gap-4">
      {/* File meta */}
      <div className="flex flex-wrap items-center gap-2 text-caption" style={{ color: "var(--color-ink-muted)" }}>
        <FileTextIcon className="size-3.5" aria-hidden="true" />
        <span className="truncate font-medium" style={{ color: "var(--color-ink)" }}>
          {preview.fileName}
        </span>
        <span
          className="rounded-sm px-1.5 py-0.5 font-data font-semibold"
          style={{
            backgroundColor: "color-mix(in srgb, var(--color-ink) 7%, transparent)",
            color: "var(--color-ink)",
          }}
        >
          {preview.format}
        </span>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label={t("import.stat_total")}
          value={preview.totalRows}
          color="var(--color-ink)"
          locale={locale}
        />
        <Stat
          label={t("import.stat_valid")}
          value={preview.validRows}
          color="var(--color-pharma)"
          locale={locale}
        />
        <Stat
          label={t("import.stat_errors")}
          value={preview.errorRows}
          color="var(--color-urgency)"
          locale={locale}
        />
      </div>

      {/* Executing notice */}
      {isExecuting && (
        <div
          className="flex items-center gap-2 rounded-sm px-3 py-2 text-body-sm"
          style={{
            backgroundColor: "color-mix(in srgb, var(--color-sync) 10%, transparent)",
            color: "var(--color-sync)",
          }}
          role="status"
        >
          <LoaderIcon className="size-4 animate-spin" aria-hidden="true" />
          {t("import.executing_description", { count: preview.validRows })}
        </div>
      )}

      {/* Warnings */}
      {preview.warnings.length > 0 && (
        <div
          className="rounded-sm px-3 py-2"
          style={{ backgroundColor: "var(--color-urgency-surface)" }}
          role="note"
        >
          <p
            className="m-0 flex items-center gap-1.5 text-caption font-semibold"
            style={{ color: "var(--color-urgency)" }}
          >
            <AlertTriangleIcon className="size-3.5" aria-hidden="true" />
            {t("import.warnings_heading")}
          </p>
          <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
            {preview.warnings.map((warning, index) => (
              <li
                key={index}
                className="text-caption"
                style={{ color: "var(--color-ink)" }}
              >
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Unmatched headers */}
      {preview.unmatchedHeaders.length > 0 && (
        <div
          className="rounded-sm px-3 py-2"
          style={{
            backgroundColor: "color-mix(in srgb, var(--color-sync) 8%, transparent)",
          }}
        >
          <p
            className="m-0 flex items-center gap-1.5 text-caption font-semibold"
            style={{ color: "var(--color-sync)" }}
          >
            <FileTextIcon className="size-3.5" aria-hidden="true" />
            {t("import.unmatched_heading")}
          </p>
          <p className="m-0 mt-0.5 text-caption" style={{ color: "var(--color-ink-muted)" }}>
            {t("import.unmatched_description")}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {preview.unmatchedHeaders.map((header) => (
              <span
                key={header}
                className="rounded-sm px-1.5 py-0.5 font-data text-caption"
                style={{
                  backgroundColor: "var(--color-panel)",
                  color: "var(--color-ink)",
                  border:
                    "1px solid color-mix(in srgb, var(--color-sync) 25%, transparent)",
                }}
              >
                {header}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Sample of valid rows */}
      <section aria-label={t("import.sample_heading")}>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <h4
            className="m-0 flex items-center gap-1.5 text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            <CheckCircleIcon
              className="size-4"
              style={{ color: "var(--color-pharma)" }}
              aria-hidden="true"
            />
            {t("import.sample_heading")}
          </h4>
          {preview.validSample.length > 0 && (
            <span className="text-caption" style={{ color: "var(--color-ink-muted)" }}>
              {t("import.sample_caption", { count: preview.validSample.length })}
            </span>
          )}
        </div>

        {preview.validSample.length === 0 ? (
          <p className="m-0 text-caption" style={{ color: "var(--color-ink-muted)" }}>
            {t("import.sample_empty")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-sm border" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 8%, transparent)" }}>
            <table className="w-full border-collapse text-body-sm">
              <thead>
                <tr
                  className="text-caption font-semibold uppercase tracking-wider"
                  style={{
                    backgroundColor: "var(--color-panel)",
                    color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
                  }}
                >
                  <th className="px-3 py-2 text-left">#</th>
                  {COLUMNS_BY_ENTITY[entityKey].map((column) => (
                    <th key={column.key} className="px-3 py-2 text-left">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.validSample.map((row) => {
                  const rowData = row.data as Record<string, unknown>;
                  return (
                    <tr
                      key={row.rowNumber}
                      className="border-t"
                      style={{ borderColor: "color-mix(in srgb, var(--color-ink) 6%, transparent)" }}
                    >
                      <td className="px-3 py-2 font-data tabular-nums text-caption" style={{ color: "var(--color-ink-muted)" }}>
                        {row.rowNumber}
                      </td>
                      {COLUMNS_BY_ENTITY[entityKey].map((column) => (
                        <td
                          key={column.key}
                          className="max-w-48 truncate px-3 py-2"
                          style={{ color: "var(--color-ink)" }}
                          title={String(rowData[column.key] ?? "")}
                        >
                          {String(rowData[column.key] ?? "")}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Per-row errors */}
      <section aria-label={t("import.errors_heading")}>
        <h4
          className="mb-1.5 flex items-center gap-1.5 text-body-sm font-semibold"
          style={{ color: "var(--color-ink)" }}
        >
          <AlertTriangleIcon
            className="size-4"
            style={{ color: "var(--color-urgency)" }}
            aria-hidden="true"
          />
          {t("import.errors_heading")}
          {preview.errorRows > 0 && (
            <span className="font-data tabular-nums" style={{ color: "var(--color-urgency)" }}>
              ({preview.errorRows})
            </span>
          )}
        </h4>

        {preview.errors.length === 0 ? (
          <p className="m-0 flex items-center gap-1.5 text-caption" style={{ color: "var(--color-pharma)" }}>
            <CheckIcon className="size-3.5" aria-hidden="true" />
            {t("import.errors_empty")}
          </p>
        ) : (
          <>
            <ul className="m-0 max-h-52 list-none space-y-2 overflow-y-auto p-0 pr-1">
              {preview.errors
                .slice(0, PREVIEW_ERRORS_DISPLAY_LIMIT)
                .map((rowError) => (
                  <RowErrorItem key={rowError.rowNumber} rowError={rowError} />
                ))}
            </ul>
            {preview.errors.length > PREVIEW_ERRORS_DISPLAY_LIMIT && (
              <p className="mt-1.5 text-caption" style={{ color: "var(--color-ink-muted)" }}>
                {t("import.errors_more", {
                  count: preview.errors.length - PREVIEW_ERRORS_DISPLAY_LIMIT,
                })}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Step 3 — execution result
// ---------------------------------------------------------------------------

interface ResultStepProps {
  execution: ImportExecutionResult;
  history: ImportHistoryEntry[];
  locale: string;
}

const ResultStep: FC<ResultStepProps> = ({ execution, history, locale }) => {
  const { t } = useTranslation();

  return (
    <div className="grid gap-4">
      {/* Summary */}
      <div
        className="flex items-start gap-3 rounded-md px-4 py-3"
        style={{
          backgroundColor: "color-mix(in srgb, var(--color-pharma) 8%, transparent)",
          border: "1px solid color-mix(in srgb, var(--color-pharma) 20%, transparent)",
        }}
      >
        <CheckCircleIcon
          className="size-6 shrink-0"
          style={{ color: "var(--color-pharma)" }}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="m-0 font-data text-body font-semibold tabular-nums" style={{ color: "var(--color-pharma)" }}>
            {t("import.result_ok", { count: execution.validRows })}
          </p>
          {execution.errorRows > 0 && (
            <p className="m-0 mt-0.5 font-data text-caption font-semibold tabular-nums" style={{ color: "var(--color-urgency)" }}>
              {t("import.result_errors", { count: execution.errorRows })}
            </p>
          )}
          <p className="m-0 mt-1 text-caption" style={{ color: "var(--color-ink-muted)" }}>
            {t("import.result_import_id")}:{" "}
            <span className="font-data tabular-nums">{execution.importId}</span>
          </p>
        </div>
      </div>

      {/* Failed rows */}
      {execution.errors.length > 0 && (
        <section aria-label={t("import.result_errors_heading")}>
          <h4
            className="mb-1 flex items-center gap-1.5 text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            <XCircleIcon
              className="size-4"
              style={{ color: "var(--color-urgency)" }}
              aria-hidden="true"
            />
            {t("import.result_errors_heading")}
          </h4>
          <p className="m-0 mb-2 text-caption" style={{ color: "var(--color-ink-muted)" }}>
            {t("import.result_errors_description")}
          </p>
          <ul className="m-0 max-h-52 list-none space-y-2 overflow-y-auto p-0 pr-1">
            {execution.errors.map((rowError) => (
              <RowErrorItem key={rowError.rowNumber} rowError={rowError} />
            ))}
          </ul>
        </section>
      )}

      {/* Recent history */}
      <section aria-label={t("import.history_heading")}>
        <h4
          className="mb-1.5 flex items-center gap-1.5 text-body-sm font-semibold"
          style={{ color: "var(--color-ink)" }}
        >
          <HistoryIcon
            className="size-4"
            style={{ color: "var(--color-sync)" }}
            aria-hidden="true"
          />
          {t("import.history_heading")}
        </h4>

        {history.length === 0 ? (
          <p className="m-0 text-caption" style={{ color: "var(--color-ink-muted)" }}>
            {t("import.history_empty")}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {history.map((entry, index) => (
              <li
                key={entry.importId}
                className="flex items-center justify-between gap-3 py-1.5"
                style={
                  index > 0
                    ? {
                        borderTop:
                          "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
                      }
                    : undefined
                }
              >
                <div className="min-w-0">
                  <p className="m-0 truncate text-caption font-medium" style={{ color: "var(--color-ink)" }}>
                    {entry.fileName}
                  </p>
                  <p className="m-0 truncate text-caption" style={{ color: "var(--color-ink-muted)" }}>
                    {formatHistoryDate(entry.createdAt, locale)}
                  </p>
                </div>
                <span
                  className="shrink-0 font-data text-caption tabular-nums"
                  style={{
                    color:
                      entry.errorRows > 0 ? "var(--color-urgency)" : "var(--color-pharma)",
                  }}
                >
                  {t("import.history_summary", {
                    valid: entry.validRows,
                    errors: entry.errorRows,
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

const Stat: FC<{ label: string; value: number; color: string; locale: string }> = ({
  label,
  value,
  color,
  locale,
}) => (
  <div
    className="rounded-sm px-3 py-2 text-center"
    style={{
      backgroundColor: "color-mix(in srgb, var(--color-ink) 4%, transparent)",
    }}
  >
    <p className="m-0 text-caption" style={{ color: "var(--color-ink-muted)" }}>
      {label}
    </p>
    <p className="m-0 font-data text-body font-semibold tabular-nums" style={{ color }}>
      {value.toLocaleString(locale)}
    </p>
  </div>
);

const ErrorBanner: FC<{ error: { title: string; detail: string | null } }> = ({
  error,
}) => (
  <div
    className="mb-4 rounded-sm border px-3 py-2"
    style={{
      backgroundColor: "var(--color-error-container)",
      borderColor: "color-mix(in srgb, var(--color-error) 20%, transparent)",
    }}
    role="alert"
  >
    <p className="m-0 flex items-center gap-1.5 text-body-sm font-semibold" style={{ color: "var(--color-error)" }}>
      <XCircleIcon className="size-4 shrink-0" aria-hidden="true" />
      {error.title}
    </p>
    {error.detail && (
      <p className="m-0 mt-0.5 text-caption" style={{ color: "var(--color-error)" }}>
        {error.detail}
      </p>
    )}
  </div>
);

/** One per-row error: row number + issue path/message (verbatim from the
 *  shared schemas — never translated). */
const RowErrorItem: FC<{ rowError: ImportRowError }> = ({ rowError }) => {
  const { t } = useTranslation();
  return (
    <li
      className="rounded-sm px-3 py-2"
      style={{
        backgroundColor: "color-mix(in srgb, var(--color-urgency) 5%, transparent)",
        borderLeft: "3px solid var(--color-urgency)",
      }}
    >
      <p
        className="m-0 font-data text-caption font-semibold tabular-nums"
        style={{ color: "var(--color-urgency)" }}
      >
        {t("import.row_number", { row: rowError.rowNumber })}
      </p>
    <ul className="m-0 mt-0.5 list-none space-y-0.5 p-0">
      {rowError.issues.map((issue, index) => (
        <li key={index} className="text-caption" style={{ color: "var(--color-ink)" }}>
          {issue.path !== "row" && (
            <span className="font-data" style={{ color: "var(--color-ink-muted)" }}>
              {issue.path}:{" "}
            </span>
          )}
          {issue.message}
        </li>
      ))}
    </ul>
    </li>
  );
};

function formatHistoryDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
}