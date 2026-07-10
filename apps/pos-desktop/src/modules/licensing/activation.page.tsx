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
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { LicenseStatus } from "@pharmacy/shared-types";
import { useLicenseStore } from "../../domain/licensing/license.store";
import { createLicenseService } from "../../domain/licensing/license.service";
import {
  ActivationFailedException,
  AlreadyActivatedException,
} from "../../domain/licensing/exceptions";
import { useOnlineStatus } from "@/hooks/use-online-status";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LICENSE_SERVICE_BASE_URL = "http://localhost:3000";

const MAX_CODE_LENGTH = 12; // 12 alphanumeric chars => "XXXX-XXXX-XXXX"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format raw input into activation-code groups of 4 separated by dashes.
 * Only keeps alphanumeric characters, uppercases them, and limits to 12 chars.
 */
function formatActivationCode(raw: string): string {
  const cleaned = raw.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < cleaned.length && i < MAX_CODE_LENGTH; i += 4) {
    groups.push(cleaned.slice(i, i + 4));
  }
  return groups.join("-");
}

/**
 * Strip dashes to get the raw code for submission.
 */
function stripCodeFormatting(formatted: string): string {
  return formatted.replace(/-/g, "");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ActivationPage: FC = () => {
  const { t } = useTranslation();
  const status = useLicenseStore((s) => s.status);
  const hardwareFingerprint = useLicenseStore((s) => s.hardwareFingerprint);
  const isOnline = useOnlineStatus();

  // ---- Form state ----

  const [activationCode, setActivationCode] = useState("");
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

  // ---- Derived ----

  const showLocationFields = useMemo(
    () => true, // On a fresh install there is no location yet; always show.
    [],
  );

  const canSubmit = useMemo(
    () =>
      !isLoading &&
      stripCodeFormatting(activationCode).length >= 8 &&
      workstationName.trim().length > 0,
    [isLoading, activationCode, workstationName],
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

  // ---- Handlers ----

  const handleCodeChange = useCallback(
    (raw: string) => {
      setErrorMessage(null);
      setActivationCode(formatActivationCode(raw));
    },
    [],
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

        // Notify the app shell to transition to the main POS interface.
        window.dispatchEvent(new CustomEvent("license:activated"));
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
      t,
    ],
  );

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
        <form
          onSubmit={handleSubmit}
          className="pos-panel p-pos-xl"
          noValidate
          aria-label={t("licensing.activation.form_aria")}
        >
          {/* Activation code */}
          <label
            className="mb-pos-xs block text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("licensing.activation.code_label")}
          </label>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoFocus
            className="pos-input font-data mb-pos-md tracking-widest"
            placeholder="ABCD-EFGH-IJKL"
            value={activationCode}
            onChange={(e) => handleCodeChange(e.currentTarget.value)}
            disabled={isLoading}
            maxLength={14} /* 12 chars + 2 dashes */
            aria-label={t("licensing.activation.code_aria")}
          />

          {/* Workstation name */}
          <label
            className="mb-pos-xs mt-pos-md block text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("licensing.activation.workstation_label")}
          </label>
          <input
            type="text"
            className="pos-input mb-pos-md"
            value={workstationName}
            onChange={(e) => setWorkstationName(e.currentTarget.value)}
            disabled={isLoading}
            aria-label={t("licensing.activation.workstation_aria")}
          />

          {/* Location fields — shown on fresh install */}
          {showLocationFields && (
            <>
              <hr
                className="pos-divider my-pos-md"
                role="separator"
              />

              <p
                className="mb-pos-sm text-body-sm font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                {t("licensing.activation.location_section")}
              </p>

              <label
                className="mb-pos-xs mt-pos-sm block text-body-sm font-medium"
                style={{
                  color: "color-mix(in srgb, var(--color-ink) 70%, transparent)",
                }}
              >
                {t("licensing.activation.location_name_label")}
              </label>
              <input
                type="text"
                className="pos-input mb-pos-sm"
                value={locationName}
                onChange={(e) => setLocationName(e.currentTarget.value)}
                disabled={isLoading}
                aria-label={t("licensing.activation.location_name_aria")}
              />

              <label
                className="mb-pos-xs mt-pos-sm block text-body-sm font-medium"
                style={{
                  color: "color-mix(in srgb, var(--color-ink) 70%, transparent)",
                }}
              >
                {t("licensing.activation.location_address_label")}
              </label>
              <input
                type="text"
                className="pos-input mb-pos-sm"
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.currentTarget.value)}
                disabled={isLoading}
                aria-label={t("licensing.activation.location_address_aria")}
              />

              <div className="flex gap-pos-md">
                <div className="flex-1">
                  <label
                    className="mb-pos-xs mt-pos-sm block text-body-sm font-medium"
                    style={{
                      color: "color-mix(in srgb, var(--color-ink) 70%, transparent)",
                    }}
                  >
                    {t("licensing.activation.location_city_label")}
                  </label>
                  <input
                    type="text"
                    className="pos-input"
                    value={locationCity}
                    onChange={(e) => setLocationCity(e.currentTarget.value)}
                    disabled={isLoading}
                    aria-label={t("licensing.activation.location_city_aria")}
                  />
                </div>
                <div className="flex-1">
                  <label
                    className="mb-pos-xs mt-pos-sm block text-body-sm font-medium"
                    style={{
                      color: "color-mix(in srgb, var(--color-ink) 70%, transparent)",
                    }}
                  >
                    {t("licensing.activation.location_region_label")}
                  </label>
                  <input
                    type="text"
                    className="pos-input"
                    value={locationRegion}
                    onChange={(e) => setLocationRegion(e.currentTarget.value)}
                    disabled={isLoading}
                    aria-label={t("licensing.activation.location_region_aria")}
                  />
                </div>
              </div>
            </>
          )}

          {/* Error message */}
          {errorMessage && (
            <div
              className="mt-pos-md rounded-pos px-pos-md py-pos-sm text-body-sm"
              role="alert"
              style={{
                backgroundColor: "#FFEBEE",
                border: "1px solid #D32F2F",
                color: "#C62828",
              }}
            >
              {errorMessage}
            </div>
          )}

          {/* Success message */}
          {successMessage && (
            <div
              className="mt-pos-md rounded-pos px-pos-md py-pos-sm text-body-sm"
              role="status"
              style={{
                backgroundColor: "var(--color-urgency-surface)",
                border: "1px solid var(--color-pharma)",
                color: "var(--color-pharma)",
              }}
            >
              {successMessage}
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            className="pos-button pos-button-primary mt-pos-lg w-full py-pos-md text-ui font-bold"
            disabled={!canSubmit}
            aria-busy={isLoading}
          >
            {isLoading
              ? t("licensing.activation.activating")
              : t("licensing.activation.activate")}
          </button>
        </form>

        {/* Footer help */}
        <p
          className="mt-pos-md text-center text-caption"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 45%, transparent)",
          }}
        >
          {t("licensing.activation.help")}
        </p>
      </div>
    </div>
  );
};
