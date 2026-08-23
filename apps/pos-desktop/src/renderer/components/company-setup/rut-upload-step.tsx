/**
 * RutUploadStep — step 1 of the company setup wizard.
 *
 * Dropzone for the RUT PDF plus the parse feedback surface. Purely
 * presentational: the file bytes go out through `onFileSelected` and the
 * parent decides what the parse result means. The error panel maps the
 * pos-local parse error codes to translated copy, so the step stays dumb.
 *
 * @category Component
 */
import { type DragEvent, type FC, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangleIcon,
  FileTextIcon,
  PencilIcon,
  XCircleIcon,
} from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";

/** Parse error codes surfaced by the RUT parser (pos-local contract). */
export type RutUploadErrorCode = "UNPARSEABLE" | "INVALID_NIT_DV" | "GENERIC";

export interface RutUploadStepProps {
  /** True while the RUT file is being parsed. */
  isParsing: boolean;
  /** Last parse failure, or null when idle/successful. */
  parseError: RutUploadErrorCode | null;
  onFileSelected: (file: File) => void;
  /** Switch the flow to fully manual data entry. */
  onManualEntry: () => void;
  /** Dismiss the current parse error and allow picking the file again. */
  onRetry: () => void;
}

const ERROR_CODE_KEY: Record<RutUploadErrorCode, string> = {
  UNPARSEABLE: "company_setup.upload.error_unparseable",
  INVALID_NIT_DV: "company_setup.upload.error_invalid_nit_dv",
  GENERIC: "company_setup.upload.error_generic",
};

export const RutUploadStep: FC<RutUploadStepProps> = ({
  isParsing,
  parseError,
  onFileSelected,
  onManualEntry,
  onRetry,
}) => {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);

  // Cleared after every selection so the same file can be picked again
  // without remounting the input.
  const handleFileChange = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      onFileSelected(file);
    },
    [onFileSelected],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      handleFileChange(event.dataTransfer.files?.[0]);
    },
    [handleFileChange],
  );

  return (
    <div className="flex flex-col gap-pos-lg">
      {/* Parsing feedback replaces the dropzone while reading the PDF. */}
      {isParsing ? (
        <div
          className="flex flex-col items-center gap-pos-sm rounded-pos border px-pos-lg py-pos-xl text-center"
          role="status"
          aria-live="polite"
          style={{
            backgroundColor: "var(--color-panel)",
            borderColor:
              "color-mix(in srgb, var(--color-ink) 15%, transparent)",
          }}
        >
          <LoaderIcon
            size={28}
            style={{ color: "var(--color-pharma)" }}
            aria-hidden="true"
          />
          <p
            className="text-body font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("company_setup.upload.parsing")}
          </p>
          <p
            className="text-caption"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {t("company_setup.upload.parsing_detail")}
          </p>
        </div>
      ) : (
        <>
          {/* Parse failure — real error when the NIT-DV check fails, warning
              otherwise. Color always paired with a text label. */}
          {parseError !== null && (
            <div
              className="flex items-start gap-pos-sm rounded-pos border px-pos-md py-pos-sm text-body-sm"
              role="alert"
              style={
                parseError === "INVALID_NIT_DV"
                  ? {
                      backgroundColor: "var(--color-error-container)",
                      borderColor: "var(--color-error)",
                      color: "#C62828",
                    }
                  : {
                      backgroundColor: "var(--color-urgency-surface)",
                      borderColor: "var(--color-urgency)",
                      color: "var(--color-urgency)",
                    }
              }
            >
              {parseError === "INVALID_NIT_DV" ? (
                <XCircleIcon
                  className="mt-0.5 h-4 w-4 flex-shrink-0"
                  aria-hidden="true"
                />
              ) : (
                <AlertTriangleIcon
                  className="mt-0.5 h-4 w-4 flex-shrink-0"
                  aria-hidden="true"
                />
              )}
              <div>
                <p className="font-semibold">
                  {t("company_setup.upload.error_title")}
                </p>
                <p className="mt-pos-xs">{t(ERROR_CODE_KEY[parseError])}</p>
                <button
                  type="button"
                  className="mt-pos-sm text-caption font-semibold underline underline-offset-2 transition-opacity hover:opacity-70"
                  onClick={onRetry}
                >
                  {t("common.retry")}
                </button>
              </div>
            </div>
          )}

          {/* File dropzone — label wraps the visually hidden input so the
              whole area is clickable and the input stays keyboard-focusable. */}
          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-pos-sm rounded-pos border-2 border-dashed px-pos-lg py-pos-xl text-center transition-colors"
            style={{
              backgroundColor: "var(--color-panel)",
              borderColor: isDragOver
                ? "var(--color-pharma)"
                : "color-mix(in srgb, var(--color-ink) 20%, transparent)",
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(event) => {
                handleFileChange(event.target.files?.[0]);
                event.target.value = "";
              }}
              aria-label={t("company_setup.upload.file_input_label")}
            />
            <FileTextIcon
              size={32}
              strokeWidth={1.5}
              style={{ color: "var(--color-pharma)" }}
              aria-hidden="true"
            />
            <span
              className="text-body font-medium"
              style={{ color: "var(--color-ink)" }}
            >
              {t("company_setup.upload.dropzone_hint")}
            </span>
            <span
              className="text-caption"
              style={{ color: "var(--color-ink-muted)" }}
            >
              {t("company_setup.upload.formats")}
            </span>
          </label>

          {/* Manual entry fallback */}
          <div
            className="rounded-pos px-pos-md py-pos-sm"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-ink) 4%, transparent)",
            }}
          >
            <p
              className="text-body-sm font-semibold"
              style={{ color: "var(--color-ink)" }}
            >
              {t("company_setup.upload.manual_title")}
            </p>
            <p
              className="mt-pos-xs text-caption"
              style={{ color: "var(--color-ink-muted)" }}
            >
              {t("company_setup.upload.manual_hint")}
            </p>
            <button
              type="button"
              className="pos-button pos-button-secondary mt-pos-sm"
              onClick={onManualEntry}
            >
              <PencilIcon className="h-4 w-4" aria-hidden="true" />
              {t("company_setup.upload.manual_cta")}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
