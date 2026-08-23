/**
 * ActivationPage — first screen shown on a fresh install.
 *
 * Renders a centered full-screen activation form when the license status is
 * UNACTIVATED. On success, dispatches a custom DOM event (`license:activated`)
 * so the app shell can transition to the main POS interface.
 *
 * The workstation cannot reach the main app until activation is complete.
 *
 * @category Page
 */
import {
  type FC,
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { LicenseStatus } from "@pharmacy/shared-types";
import { type RecoverableCode } from "../../../domain/licensing";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { createLicenseService } from "../../../domain/licensing/license.service";
import {
  ActivationFailedException,
  AlreadyActivatedException,
} from "../../../domain/licensing/exceptions";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useCompanySetup } from "@/hooks/use-company-setup";
import { useAppDispatch } from "@/store/hooks";
import { setActiveScreen } from "@/store/slices/ui-slice";
import {
  formatActivationCode,
  stripCodeFormatting,
} from "./activation.helpers";
import { ActivationForm } from "./activation-form";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LICENSE_SERVICE_BASE_URL = "http://localhost:3000";

/** Loose email check; matches the checkout form's expectations. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const recoveryExpiryFormatter = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Format a recoverable code's ISO expiry as "dd/mm/yyyy" (es-CO).
 * Falls back to the raw value if the server returned an unparseable date.
 */
function formatExpiryDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return recoveryExpiryFormatter.format(date);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ActivationPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const status = useLicenseStore((s) => s.status);
  const hardwareFingerprint = useLicenseStore((s) => s.hardwareFingerprint);
  const pendingActivationCode = useLicenseStore(
    (s) => s.pendingActivationCode,
  );
  const isOnline = useOnlineStatus();
  const { status: companySetupStatus } = useCompanySetup();

  // ---- Form state ----

  // Prefill the code from a completed self-service checkout; the user can
  // still overwrite it before submitting.
  const [activationCode, setActivationCode] = useState(() =>
    pendingActivationCode ? formatActivationCode(pendingActivationCode) : "",
  );
  const [workstationName, setWorkstationName] = useState<string>(() => {
    const fingerprint = hardwareFingerprint ?? crypto.randomUUID();
    const shortId = fingerprint.slice(0, 8).toUpperCase();
    return `Workstation-${shortId}`;
  });
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationCity, setLocationCity] = useState("");
  const [locationRegion, setLocationRegion] = useState("");

  // ---- UI state ----

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // ---- Code-recovery UI state ----

  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [recoveryTaxId, setRecoveryTaxId] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryFieldErrors, setRecoveryFieldErrors] = useState<{
    taxId: string | null;
    email: string | null;
  }>({ taxId: null, email: null });
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveredCodes, setRecoveredCodes] = useState<RecoverableCode[] | null>(
    null,
  );

  // Keep the code input prefilled when a code arrives from a completed
  // checkout or from the code-recovery panel below.
  useEffect(() => {
    if (pendingActivationCode) {
      setActivationCode(formatActivationCode(pendingActivationCode));
    }
  }, [pendingActivationCode]);

  // ---- Redirect guard ----

  // ---- Handlers ----

  const handleCodeChange = useCallback(
    (raw: string) => {
      setErrorMessage(null);
      setActivationCode(formatActivationCode(raw));
    },
    [],
  );

  const handleOpenPlans = useCallback(() => {
    dispatch(setActiveScreen("licensing-plans"));
  }, [dispatch]);

  // ---- Code-recovery handlers ----

  const resetRecoveryState = useCallback(() => {
    setRecoveryFieldErrors({ taxId: null, email: null });
    setRecoveryError(null);
    setRecoveredCodes(null);
  }, []);

  const handleCloseRecovery = useCallback(() => {
    setRecoveryTaxId("");
    setRecoveryEmail("");
    resetRecoveryState();
    setIsRecoveryOpen(false);
  }, [resetRecoveryState]);

  const handleToggleRecovery = useCallback(() => {
    if (isRecoveryOpen) {
      handleCloseRecovery();
    } else {
      setIsRecoveryOpen(true);
    }
  }, [isRecoveryOpen, handleCloseRecovery]);

  const handleRecoveryFieldChange = useCallback(
    (field: "taxId" | "email", value: string) => {
      if (field === "taxId") {
        setRecoveryTaxId(value);
      } else {
        setRecoveryEmail(value);
      }
      // Clear the inline error for the field the user is fixing.
      setRecoveryFieldErrors((prev) => ({ ...prev, [field]: null }));
    },
    [],
  );

  const handleRecoverCodes = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setRecoveryError(null);
      setRecoveredCodes(null);

      const taxId = recoveryTaxId.trim();
      const email = recoveryEmail.trim();
      const errors = {
        taxId: taxId
          ? null
          : t("licensing.activation.recover_tax_id_required"),
        email: !email
          ? t("licensing.activation.recover_email_required")
          : EMAIL_PATTERN.test(email)
            ? null
            : t("licensing.activation.recover_email_invalid"),
      };
      setRecoveryFieldErrors(errors);
      if (errors.taxId || errors.email) return;

      setIsRecovering(true);

      try {
        const licenseService = createLicenseService({
          baseUrl: LICENSE_SERVICE_BASE_URL,
        });
        const codes = await licenseService.recoverActivationCodes(
          taxId,
          email,
        );
        setRecoveredCodes(codes);
      } catch {
        // Never surface the raw exception; keep the notice generic.
        setRecoveryError(t("licensing.activation.recover_error"));
      } finally {
        setIsRecovering(false);
      }
    },
    [recoveryTaxId, recoveryEmail, t],
  );

  const handleUseRecoveredCode = useCallback(
    (code: string) => {
      // The pending-code banner and the code input prefill take over.
      useLicenseStore.getState().setPendingActivationCode(code);
      handleCloseRecovery();
    },
    [handleCloseRecovery],
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setErrorMessage(null);

      if (!isOnline) {
        setErrorMessage(t("licensing.activation.offline_error"));
        return;
      }

      const rawCode = stripCodeFormatting(activationCode);
      if (rawCode.length < 8) {
        setErrorMessage(t("licensing.activation.code_invalid"));
        return;
      }

      const wsName = workstationName.trim();
      if (!wsName) {
        setErrorMessage(t("licensing.activation.workstation_required"));
        return;
      }

      setIsLoading(true);

      try {
        const licenseService = createLicenseService({
          baseUrl: LICENSE_SERVICE_BASE_URL,
        });

        const locationData =
          locationName.trim().length > 0
            ? {
                name: locationName.trim(),
                address: locationAddress.trim() || undefined,
                city: locationCity.trim() || undefined,
                region: locationRegion.trim() || undefined,
              }
            : undefined;

        await licenseService.activate(rawCode, wsName, locationData);

        setSuccessMessage(t("licensing.activation.success"));

        // Without the fiscal emitter data no electronic invoice can be
        // issued, so a fresh company goes straight into the setup wizard.
        // Otherwise notify the app shell to transition to the main POS.
        if (companySetupStatus === "needs-setup") {
          dispatch(setActiveScreen("company-setup"));
        } else {
          window.dispatchEvent(new CustomEvent("license:activated"));
        }
      } catch (error) {
        if (
          error instanceof ActivationFailedException ||
          error instanceof AlreadyActivatedException
        ) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage(t("licensing.activation.generic_error"));
        }
      } finally {
        setIsLoading(false);
      }
    },
    [
      activationCode,
      workstationName,
      locationName,
      locationAddress,
      locationCity,
      locationRegion,
      isOnline,
      companySetupStatus,
      dispatch,
      t,
    ],
  );

  // ---- Redirect guard ----

  if (status !== LicenseStatus.UNACTIVATED) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ backgroundColor: "var(--color-surface)" }}
      >
        <div className="pos-panel max-w-md p-pos-xl text-center">
          <p
            className="text-body"
            style={{ color: "var(--color-ink)" }}
          >
            {t("licensing.already_activated_redirect")}
          </p>
        </div>
      </div>
    );
  }

  // ---- Render ----

  return (
    <div
      className="flex h-screen flex-col items-center justify-center overflow-y-auto p-pos-lg"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <div className="w-full max-w-md">
        {/* Brand / title */}
        <div className="mb-pos-xl text-center">
          <h1
            className="text-heading font-bold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("licensing.activation.title")}
          </h1>
          <p
            className="mt-pos-sm text-body-sm"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
            }}
          >
            {t("licensing.activation.subtitle")}
          </p>
        </div>

        {/* Pending-code banner — code obtained from an approved checkout */}
        {pendingActivationCode && (
          <div
            className="mb-pos-md rounded-pos border px-pos-md py-pos-sm"
            role="status"
            style={{
              backgroundColor: "var(--color-success-container)",
              borderColor: "var(--color-success)",
              color: "var(--color-success)",
            }}
          >
            <p className="text-body-sm font-semibold">
              {t("licensing.activation.pending_code_banner")}
            </p>
            <p className="mt-pos-xs text-body-sm">
              <span className="font-semibold">
                {t("licensing.activation.pending_code_label")}:
              </span>{" "}
              <span className="font-data tracking-widest">
                {formatActivationCode(pendingActivationCode)}
              </span>
            </p>
          </div>
        )}

        {/* Offline warning */}
        {!isOnline && (
          <div
            className="mb-pos-md rounded-pos border px-pos-md py-pos-sm text-body-sm font-semibold"
            role="alert"
            style={{
              backgroundColor: "var(--color-urgency-surface)",
              borderColor: "var(--color-urgency)",
              color: "var(--color-urgency)",
            }}
          >
            {t("licensing.activation.offline_banner")}
          </div>
        )}

        {/* Activation form */}
        <ActivationForm
          activationCode={activationCode}
          workstationName={workstationName}
          locationName={locationName}
          locationAddress={locationAddress}
          locationCity={locationCity}
          locationRegion={locationRegion}
          isLoading={isLoading}
          errorMessage={errorMessage}
          successMessage={successMessage}
          onCodeChange={handleCodeChange}
          onWorkstationNameChange={setWorkstationName}
          onLocationNameChange={setLocationName}
          onLocationAddressChange={setLocationAddress}
          onLocationCityChange={setLocationCity}
          onLocationRegionChange={setLocationRegion}
          onSubmit={handleSubmit}
        />

        {/* Footer help */}
        <p
          className="mt-pos-md text-center text-caption"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 45%, transparent)",
          }}
        >
          {t("licensing.activation.help")}
        </p>

        {/* Self-service purchase CTA */}
        <div className="mt-pos-md flex flex-col items-center gap-pos-sm">
          <button
            type="button"
            className="pos-button pos-button-secondary"
            onClick={handleOpenPlans}
            disabled={!isOnline}
          >
            {t("licensing.activation.buy_plans_cta")}
          </button>
          {!isOnline && (
            <p
              className="text-caption"
              style={{
                color: "color-mix(in srgb, var(--color-ink) 45%, transparent)",
              }}
            >
              {t("licensing.activation.buy_plans_offline_hint")}
            </p>
          )}
        </div>

        {/* Lost-code recovery */}
        <div className="mt-pos-md flex flex-col items-center">
          <button
            type="button"
            className="text-caption underline underline-offset-2 transition-opacity hover:opacity-70"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
            }}
            onClick={handleToggleRecovery}
            aria-expanded={isRecoveryOpen}
            aria-controls="activation-code-recovery-panel"
          >
            {t("licensing.activation.recover_link")}
          </button>
        </div>

        {isRecoveryOpen && (
          <div
            id="activation-code-recovery-panel"
            role="region"
            aria-labelledby="activation-code-recovery-title"
            className="pos-panel mt-pos-md p-pos-lg"
          >
            <h2
              id="activation-code-recovery-title"
              className="text-body font-semibold"
              style={{ color: "var(--color-ink)" }}
            >
              {t("licensing.activation.recover_title")}
            </h2>

            <form onSubmit={handleRecoverCodes} noValidate className="mt-pos-md">
              {/* Tax id / NIT */}
              <label
                htmlFor="recovery-tax-id"
                className="mb-pos-xs block text-body-sm font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                {t("licensing.activation.recover_tax_id")}
              </label>
              <input
                id="recovery-tax-id"
                type="text"
                autoComplete="off"
                className="pos-input mb-pos-xs"
                value={recoveryTaxId}
                onChange={(e) =>
                  handleRecoveryFieldChange("taxId", e.currentTarget.value)
                }
                disabled={isRecovering}
                aria-invalid={recoveryFieldErrors.taxId !== null}
                aria-describedby={
                  recoveryFieldErrors.taxId
                    ? "recovery-tax-id-error"
                    : undefined
                }
              />
              {recoveryFieldErrors.taxId && (
                <p
                  id="recovery-tax-id-error"
                  className="mb-pos-sm text-caption"
                  style={{ color: "#C62828" }}
                >
                  {recoveryFieldErrors.taxId}
                </p>
              )}

              {/* Email */}
              <label
                htmlFor="recovery-email"
                className="mb-pos-xs mt-pos-sm block text-body-sm font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                {t("licensing.activation.recover_email")}
              </label>
              <input
                id="recovery-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                className="pos-input mb-pos-xs"
                value={recoveryEmail}
                onChange={(e) =>
                  handleRecoveryFieldChange("email", e.currentTarget.value)
                }
                disabled={isRecovering}
                aria-invalid={recoveryFieldErrors.email !== null}
                aria-describedby={
                  recoveryFieldErrors.email ? "recovery-email-error" : undefined
                }
              />
              {recoveryFieldErrors.email && (
                <p
                  id="recovery-email-error"
                  className="mb-pos-sm text-caption"
                  style={{ color: "#C62828" }}
                >
                  {recoveryFieldErrors.email}
                </p>
              )}

              {/* Submit */}
              <button
                type="submit"
                className="pos-button pos-button-primary mt-pos-md w-full py-pos-md text-ui font-bold"
                disabled={isRecovering}
                aria-busy={isRecovering}
              >
                {t("licensing.activation.recover_submit")}
              </button>
            </form>

            {/* Generic failure notice */}
            {recoveryError && (
              <div
                className="mt-pos-md rounded-pos px-pos-md py-pos-sm text-body-sm"
                role="alert"
                style={{
                  backgroundColor: "#FFEBEE",
                  border: "1px solid #D32F2F",
                  color: "#C62828",
                }}
              >
                {recoveryError}
              </div>
            )}

            {/* No codes matched */}
            {recoveredCodes !== null && recoveredCodes.length === 0 && (
              <div
                className="mt-pos-md rounded-pos border px-pos-md py-pos-sm text-body-sm"
                role="status"
                style={{
                  backgroundColor: "var(--color-surface)",
                  borderColor:
                    "color-mix(in srgb, var(--color-ink) 20%, transparent)",
                  color: "color-mix(in srgb, var(--color-ink) 70%, transparent)",
                }}
              >
                {t("licensing.activation.recover_success_empty")}
              </div>
            )}

            {/* Recovered codes */}
            {recoveredCodes !== null && recoveredCodes.length > 0 && (
              <ul className="mt-pos-md space-y-pos-sm">
                {recoveredCodes.map((item) => (
                  <li
                    key={item.code}
                    className="rounded-pos border px-pos-md py-pos-sm"
                    style={{
                      backgroundColor: "var(--color-success-container)",
                      borderColor: "var(--color-success)",
                    }}
                  >
                    <p
                      className="font-data text-body-sm tracking-widest"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {formatActivationCode(item.code)}
                    </p>
                    <p
                      className="mt-pos-xs text-caption"
                      style={{
                        color:
                          "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                      }}
                    >
                      {t("licensing.activation.recover_expires")}:{" "}
                      {formatExpiryDate(item.expiresAt)}
                    </p>
                    <button
                      type="button"
                      className="pos-button pos-button-secondary mt-pos-sm"
                      onClick={() => handleUseRecoveredCode(item.code)}
                    >
                      {t("licensing.activation.recover_use_code")}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Collapse */}
            <div className="mt-pos-md text-center">
              <button
                type="button"
                className="text-caption underline underline-offset-2 transition-opacity hover:opacity-70"
                style={{
                  color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
                }}
                onClick={handleCloseRecovery}
              >
                {t("licensing.activation.recover_close")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
