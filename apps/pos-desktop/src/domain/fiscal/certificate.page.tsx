/**
 * CertificateSetupPage — onboarding gate for the self-managed billing plan.
 *
 * Shown after company setup when the subscription plan is CERTIFICATE:
 * the user uploads their DIAN digital certificate (PKCS#12), its password
 * and the DIAN software security code. Presentational pieces live in
 * `renderer/components/fiscal/certificate-upload-step.tsx` (frontend-pos);
 * this container owns the domain wiring and the flow state only.
 *
 * The step can be skipped — a persistent banner keeps reminding until the
 * certificate is uploaded, because electronic invoicing cannot be
 * transmitted without it (sales still work through contingency).
 *
 * @category Page
 */
import { type FC, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "@/store/hooks";
import { navigateToHome } from "@/store/slices/ui-slice";
import { useFiscalCertificate } from "@/hooks/use-fiscal-certificate";
import type {
  CertificateUploadInput,
} from "../../domain/fiscal";
import {
  CertificateUploadOfflineException,
  CertificateUploadRejectedException,
} from "../../domain/fiscal";
import { CertificateUploadStep } from "@/components/fiscal/certificate-upload-step";

/**
 * Error code handed to the step: a client-side validation code when the
 * input failed locally, or a stable server-rejection code otherwise.
 */
type UploadErrorCode =
  | import("../../domain/fiscal").CertificateValidationCode
  | "OFFLINE"
  | "SERVER_REJECTED"
  | "NETWORK";

export const CertificateSetupPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    status,
    subjectCn,
    validTo,
    isUploading,
    uploadErrorCode,
    upload,
    clearUploadError,
  } = useFiscalCertificate();

  const [serverError, setServerError] = useState<UploadErrorCode | null>(null);

  // Validation codes come from the store (set by the hook on failed
  // client-side validation); server/offline codes are set here.
  const errorCode: UploadErrorCode | null = serverError ?? uploadErrorCode;

  const handleUpload = useCallback(
    async (input: CertificateUploadInput) => {
      setServerError(null);
      try {
        await upload(input);
      } catch (error) {
        if (error instanceof CertificateUploadOfflineException) {
          setServerError("OFFLINE");
        } else if (error instanceof CertificateUploadRejectedException) {
          setServerError("SERVER_REJECTED");
        } else {
          setServerError("NETWORK");
        }
      }
    },
    [upload],
  );

  const handleSkip = useCallback(() => {
    dispatch(navigateToHome());
  }, [dispatch]);

  const handleFinish = useCallback(() => {
    dispatch(navigateToHome());
  }, [dispatch]);

  // Only a healthy certificate shows the "configured" view. EXPIRING and
  // EXPIRED must present the upload form again (with a status notice) so a
  // renewal can be uploaded from this screen.
  const isConfigured = status === "ACTIVE";

  return (
    <div
      className="flex h-screen flex-col items-center justify-center overflow-y-auto p-pos-lg"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <div className="w-full max-w-md">
        <div className="mb-pos-lg text-center">
          <h1
            className="text-heading font-bold"
            style={{ color: "var(--color-ink)" }}
          >
            {isConfigured
              ? t("certificate_setup.done_title")
              : t("certificate_setup.title")}
          </h1>
          <p
            className="mt-pos-sm text-body-sm"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
            }}
          >
            {isConfigured
              ? t("certificate_setup.done_subtitle")
              : t("certificate_setup.subtitle")}
          </p>
        </div>

        {status === "EXPIRING" && (
          <div
            className="mb-pos-md rounded-pos border px-pos-md py-pos-sm text-body-sm"
            role="alert"
            style={{
              backgroundColor: "var(--color-urgency-surface)",
              borderColor: "var(--color-urgency)",
              color: "var(--color-urgency)",
            }}
          >
            {t("certificate_banner.expiring_message", {
              date: validTo ?? "—",
            })}
          </div>
        )}

        {status === "EXPIRED" && (
          <div
            className="mb-pos-md rounded-pos border px-pos-md py-pos-sm text-body-sm"
            role="alert"
            style={{
              backgroundColor: "var(--color-urgency-surface)",
              borderColor: "var(--color-urgency)",
              color: "var(--color-urgency)",
            }}
          >
            {t("certificate_banner.expired_message")}
          </div>
        )}

        <CertificateUploadStep
          isConfigured={isConfigured}
          subjectCn={subjectCn}
          validTo={validTo}
          isUploading={isUploading}
          errorCode={errorCode}
          onUpload={(input) => void handleUpload(input)}
          onClearError={() => {
            setServerError(null);
            clearUploadError();
          }}
          onSkip={handleSkip}
          onFinish={handleFinish}
        />
      </div>
    </div>
  );
};