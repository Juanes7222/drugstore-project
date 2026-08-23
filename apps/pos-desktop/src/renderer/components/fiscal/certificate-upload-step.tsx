/**
 * CertificateUploadStep — DIAN digital certificate upload (self-managed
 * billing plan).
 *
 * The step is framed as sealed material: a violet file target (the same
 * regulatory language as restricted-sale confirmation and the DIAN
 * resolution card), a compact credential ledger, and a quiet security
 * promise footer — the certificate is the pharmacy's legal signature, so
 * the interaction is deliberate, never rushed.
 *
 * Local state only: the file, the certificate password and the software
 * security code exist solely in this component's form state for the
 * duration of one upload call — nothing is persisted here, and the
 * password never leaves the upload input.
 *
 * @category Component
 */
import { type FC, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CertificateUploadInput } from "../../../domain/fiscal";
import type { CertificateValidationCode } from "../../../domain/fiscal";
import {
  AlertTriangleIcon,
  KeyRoundIcon,
  LockIcon,
  ShieldIcon,
} from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";

export type CertificateStepErrorCode =
  | CertificateValidationCode
  | "OFFLINE"
  | "SERVER_REJECTED"
  | "NETWORK";

export interface CertificateUploadStepProps {
  /** True when a certificate is already configured (success view). */
  isConfigured: boolean;
  subjectCn: string | null;
  validTo: string | null;
  isUploading: boolean;
  /** Client-side validation code or stable server-rejection code. */
  errorCode: CertificateStepErrorCode | null;
  onUpload(input: CertificateUploadInput): void;
  onClearError(): void;
  /** Skip the step — a banner keeps reminding until configured. */
  onSkip(): void;
  /** Leave the onboarding after a successful upload. */
  onFinish(): void;
}

/** Render the certificate validity end as a long Colombian date. */
function formatValidityDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** Human file size so the target never shows a raw byte count. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export const CertificateUploadStep: FC<CertificateUploadStepProps> = ({
  isConfigured,
  subjectCn,
  validTo,
  isUploading,
  errorCode,
  onUpload,
  onClearError,
  onSkip,
  onFinish,
}) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [softwareSecurityCode, setSoftwareSecurityCode] = useState("");

  const handleFileChange = useCallback(
    (next: File | null) => {
      onClearError();
      setFile(next);
    },
    [onClearError],
  );

  // Configured: the certificate is live — show the identity card.
  if (isConfigured) {
    return (
      <div
        className="pos-panel p-pos-xl"
        role="status"
        style={{
          borderColor: "color-mix(in srgb, var(--color-restrict) 35%, transparent)",
        }}
      >
        <div
          className="mx-auto mb-pos-md flex h-12 w-12 items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--color-restrict-surface)" }}
          aria-hidden="true"
        >
          <ShieldIcon size={24} style={{ color: "var(--color-restrict)" }} />
        </div>

        <div
          className="rounded-pos border px-pos-md py-pos-sm text-center"
          style={{
            backgroundColor: "var(--color-restrict-surface)",
            borderColor: "color-mix(in srgb, var(--color-restrict) 35%, transparent)",
          }}
        >
          <p className="font-data text-body-sm tabular-nums text-ink">
            {t("certificate_setup.configured_subject", { subject: subjectCn || "—" })}
          </p>
          <p className="mt-pos-xs font-data text-caption tabular-nums text-ink-muted">
            {t("certificate_setup.configured_validity", {
              date: formatValidityDate(validTo),
            })}
          </p>
        </div>

        <button
          type="button"
          className="pos-button pos-button-primary mt-pos-lg w-full py-pos-md text-ui font-bold"
          onClick={onFinish}
        >
          {t("certificate_setup.finish")}
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        className="pos-panel p-pos-xl"
        style={{
          borderColor: "color-mix(in srgb, var(--color-restrict) 35%, transparent)",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pfx,.p12"
          className="hidden"
          aria-label={t("certificate_setup.file_aria")}
          onChange={(e) => handleFileChange(e.currentTarget.files?.[0] ?? null)}
        />

        {/* File target — sealed-document frame */}
        {file ? (
          <div
            className="flex items-center gap-pos-md rounded-pos border border-dashed px-pos-md py-pos-md"
            style={{
              backgroundColor: "var(--color-restrict-surface)",
              borderColor: "var(--color-restrict)",
            }}
          >
            <ShieldIcon
              size={20}
              className="flex-shrink-0"
              style={{ color: "var(--color-restrict)" }}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-data text-body-sm tabular-nums text-ink">
                {file.name}
              </p>
              <p className="text-caption text-ink-muted">{formatFileSize(file.size)}</p>
            </div>
            <button
              type="button"
              className="text-caption font-medium underline underline-offset-2 transition-colors hover:text-pharma"
              style={{ color: "var(--color-restrict)" }}
              onClick={() => fileInputRef.current?.click()}
            >
              {t("certificate_setup.file_change")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="flex w-full flex-col items-center justify-center gap-pos-sm rounded-pos border border-dashed px-pos-md py-pos-lg transition-colors focus-visible:outline-2 focus-visible:outline-pharma"
            style={{
              backgroundColor: "var(--color-restrict-surface)",
              borderColor: "color-mix(in srgb, var(--color-restrict) 60%, transparent)",
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <LockIcon size={22} style={{ color: "var(--color-restrict)" }} aria-hidden="true" />
            <span className="text-body-sm font-semibold text-ink">
              {t("certificate_setup.pick_file")}
            </span>
            <span className="text-caption text-ink-muted">
              {t("certificate_setup.file_hint")}
            </span>
          </button>
        )}

        {/* Credential ledger */}
        <div className="mt-pos-md space-y-pos-md">
          <div>
            <label
              htmlFor="certificate-password"
              className="mb-pos-xs flex items-center gap-pos-xs text-body-sm font-semibold text-ink"
            >
              <LockIcon size={14} style={{ color: "var(--color-ink-muted)" }} aria-hidden="true" />
              {t("certificate_setup.password")}
            </label>
            <input
              id="certificate-password"
              type="password"
              autoComplete="new-password"
              className="pos-input w-full"
              value={password}
              onChange={(e) => {
                onClearError();
                setPassword(e.currentTarget.value);
              }}
            />
            <p className="mt-pos-xs text-caption text-ink-muted">
              {t("certificate_setup.password_hint")}
            </p>
          </div>

          <div>
            <label
              htmlFor="certificate-security-code"
              className="mb-pos-xs flex items-center gap-pos-xs text-body-sm font-semibold text-ink"
            >
              <KeyRoundIcon
                size={14}
                style={{ color: "var(--color-ink-muted)" }}
                aria-hidden="true"
              />
              {t("certificate_setup.security_code")}
            </label>
            <input
              id="certificate-security-code"
              type="text"
              autoComplete="off"
              className="pos-input w-full font-data tabular-nums"
              value={softwareSecurityCode}
              onChange={(e) => {
                onClearError();
                setSoftwareSecurityCode(e.currentTarget.value);
              }}
            />
            <p className="mt-pos-xs text-caption text-ink-muted">
              {t("certificate_setup.security_code_hint")}
            </p>
          </div>
        </div>

        {errorCode && (
          <div
            className="mt-pos-md flex items-start gap-pos-sm rounded-pos border border-error/30 bg-error-container px-pos-md py-pos-sm text-body-sm text-error"
            role="alert"
          >
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <p>{t(`certificate_setup.error.${errorCode}`)}</p>
          </div>
        )}

        <button
          type="button"
          className="pos-button pos-button-primary mt-pos-lg inline-flex w-full items-center justify-center gap-pos-xs py-pos-md text-ui font-bold"
          disabled={isUploading || !file}
          aria-busy={isUploading}
          onClick={() => {
            if (file) onUpload({ file, password, softwareSecurityCode });
          }}
        >
          {isUploading && <LoaderIcon className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {isUploading ? t("certificate_setup.uploading") : t("certificate_setup.upload")}
        </button>

        <div className="mt-pos-lg text-center">
          <button
            type="button"
            className="text-body-sm font-medium underline underline-offset-2 transition-colors hover:text-ink"
            style={{ color: "var(--color-ink-muted)" }}
            onClick={onSkip}
          >
            {t("certificate_setup.skip")}
          </button>
          <p className="mt-pos-xs text-caption text-ink-muted">
            {t("certificate_setup.skip_hint")}
          </p>
        </div>
      </div>

      {/* Security promise — the trust anchor of the whole step */}
      <p
        className="mt-pos-md flex items-center justify-center gap-pos-xs text-center text-caption"
        style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}
      >
        <LockIcon size={12} aria-hidden="true" />
        {t("certificate_setup.security_promise")}
      </p>
    </>
  );
};