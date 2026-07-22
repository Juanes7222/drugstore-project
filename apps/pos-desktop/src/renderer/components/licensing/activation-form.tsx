/**
 * ActivationForm — code input, workstation name, optional location fields,
 * submit button, and inline error/success feedback.
 *
 * @category Component
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { stripCodeFormatting } from "./activation.helpers";

interface ActivationFormProps {
  activationCode: string;
  workstationName: string;
  locationName: string;
  locationAddress: string;
  locationCity: string;
  locationRegion: string;
  isLoading: boolean;
  errorMessage: string | null;
  successMessage: string | null;
  onCodeChange: (raw: string) => void;
  onWorkstationNameChange: (value: string) => void;
  onLocationNameChange: (value: string) => void;
  onLocationAddressChange: (value: string) => void;
  onLocationCityChange: (value: string) => void;
  onLocationRegionChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const ActivationForm: FC<ActivationFormProps> = ({
  activationCode,
  workstationName,
  locationName,
  locationAddress,
  locationCity,
  locationRegion,
  isLoading,
  errorMessage,
  successMessage,
  onCodeChange,
  onWorkstationNameChange,
  onLocationNameChange,
  onLocationAddressChange,
  onLocationCityChange,
  onLocationRegionChange,
  onSubmit,
}) => {
  const { t } = useTranslation();

  const canSubmit =
    !isLoading && stripCodeFormatting(activationCode).length >= 8 && workstationName.trim().length > 0;

  return (
    <form
      onSubmit={onSubmit}
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
        onChange={(e) => onCodeChange(e.currentTarget.value)}
        disabled={isLoading}
        maxLength={14}
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
        onChange={(e) => onWorkstationNameChange(e.currentTarget.value)}
        disabled={isLoading}
        aria-label={t("licensing.activation.workstation_aria")}
      />

      {/* Location fields — always shown on fresh install */}
      <>
        <hr className="pos-divider my-pos-md" role="separator" />

        <p
          className="mb-pos-sm text-body-sm font-semibold"
          style={{ color: "var(--color-ink)" }}
        >
          {t("licensing.activation.location_section")}
        </p>

        <label
          className="mb-pos-xs mt-pos-sm block text-body-sm font-medium"
          style={{ color: "color-mix(in srgb, var(--color-ink) 70%, transparent)" }}
        >
          {t("licensing.activation.location_name_label")}
        </label>
        <input
          type="text"
          className="pos-input mb-pos-sm"
          value={locationName}
          onChange={(e) => onLocationNameChange(e.currentTarget.value)}
          disabled={isLoading}
          aria-label={t("licensing.activation.location_name_aria")}
        />

        <label
          className="mb-pos-xs mt-pos-sm block text-body-sm font-medium"
          style={{ color: "color-mix(in srgb, var(--color-ink) 70%, transparent)" }}
        >
          {t("licensing.activation.location_address_label")}
        </label>
        <input
          type="text"
          className="pos-input mb-pos-sm"
          value={locationAddress}
          onChange={(e) => onLocationAddressChange(e.currentTarget.value)}
          disabled={isLoading}
          aria-label={t("licensing.activation.location_address_aria")}
        />

        <div className="flex gap-pos-md">
          <div className="flex-1">
            <label
              className="mb-pos-xs mt-pos-sm block text-body-sm font-medium"
              style={{ color: "color-mix(in srgb, var(--color-ink) 70%, transparent)" }}
            >
              {t("licensing.activation.location_city_label")}
            </label>
            <input
              type="text"
              className="pos-input"
              value={locationCity}
              onChange={(e) => onLocationCityChange(e.currentTarget.value)}
              disabled={isLoading}
              aria-label={t("licensing.activation.location_city_aria")}
            />
          </div>
          <div className="flex-1">
            <label
              className="mb-pos-xs mt-pos-sm block text-body-sm font-medium"
              style={{ color: "color-mix(in srgb, var(--color-ink) 70%, transparent)" }}
            >
              {t("licensing.activation.location_region_label")}
            </label>
            <input
              type="text"
              className="pos-input"
              value={locationRegion}
              onChange={(e) => onLocationRegionChange(e.currentTarget.value)}
              disabled={isLoading}
              aria-label={t("licensing.activation.location_region_aria")}
            />
          </div>
        </div>
      </>

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
  );
};
