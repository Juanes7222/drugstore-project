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
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { LicenseStatus } from "@pharmacy/shared-types";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { createLicenseService } from "../../../domain/licensing/license.service";
import {
  ActivationFailedException,
  AlreadyActivatedException,
} from "../../../domain/licensing/exceptions";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  formatActivationCode,
  stripCodeFormatting,
} from "./activation.helpers";
import { ActivationForm } from "./activation-form";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LICENSE_SERVICE_BASE_URL = "http://localhost:3000";

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
      </div>
    </div>
  );
};
