/**
 * PrescriptionForm — form for capturing medical prescription data for a
 * single cart item during checkout.
 *
 * Includes physician details, patient ID, prescription date, and optional
 * controlled-substance book-keeping fields.  The submit button changes its
 * label depending on whether this is the last item requiring a prescription
 * in the current transaction.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";

interface PrescriptionFormProps {
  physicianName: string;
  onPhysicianNameChange: (value: string) => void;
  licenseNumber: string;
  onLicenseNumberChange: (value: string) => void;
  prescriptionDate: string;
  onPrescriptionDateChange: (value: string) => void;
  patientId: string;
  onPatientIdChange: (value: string) => void;
  isControlledSubstance: boolean;
  onIsControlledSubstanceChange: (value: boolean) => void;
  bookEntry: string;
  onBookEntryChange: (value: string) => void;
  bookPage: string;
  onBookPageChange: (value: string) => void;
  error: string | null;
  isProcessing: boolean;
  canSubmit: boolean;
  isLastItem: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

export const PrescriptionForm: FC<PrescriptionFormProps> = ({
  physicianName,
  onPhysicianNameChange,
  licenseNumber,
  onLicenseNumberChange,
  prescriptionDate,
  onPrescriptionDateChange,
  patientId,
  onPatientIdChange,
  isControlledSubstance,
  onIsControlledSubstanceChange,
  bookEntry,
  onBookEntryChange,
  bookPage,
  onBookPageChange,
  error,
  isProcessing,
  canSubmit,
  isLastItem,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation();

  const submitLabel = isProcessing
    ? t("prescriptions.processing")
    : isLastItem
      ? t("prescriptions.submit_finish")
      : t("prescriptions.submit_next");

  return (
    <div className="pos-panel p-pos-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        noValidate
        className="flex flex-col gap-pos-lg"
      >
        {/* ── Physician Name ───────────────────────────────────────── */}

        <label className="flex flex-col gap-pos-xs">
          <span
            className="text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("prescriptions.physician_name")}
            <span
              className="ml-pos-xs"
              style={{ color: "var(--color-urgency)" }}
              aria-hidden="true"
            >
              *
            </span>
          </span>
          <input
            type="text"
            value={physicianName}
            onChange={(e) => onPhysicianNameChange(e.target.value)}
            className="pos-input"
            autoFocus
            aria-required="true"
          />
        </label>

        {/* ── License Number ──────────────────────────────────────── */}

        <label className="flex flex-col gap-pos-xs">
          <span
            className="text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("prescriptions.license_number")}
            <span
              className="ml-pos-xs"
              style={{ color: "var(--color-urgency)" }}
              aria-hidden="true"
            >
              *
            </span>
          </span>
          <input
            type="text"
            value={licenseNumber}
            onChange={(e) => onLicenseNumberChange(e.target.value)}
            className="pos-input"
            aria-required="true"
          />
        </label>

        {/* ── Prescription Date ───────────────────────────────────── */}

        <label className="flex flex-col gap-pos-xs">
          <span
            className="text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("prescriptions.prescription_date")}
          </span>
          <input
            type="date"
            value={prescriptionDate}
            onChange={(e) => onPrescriptionDateChange(e.target.value)}
            className="pos-input"
          />
        </label>

        {/* ── Patient ID ──────────────────────────────────────────── */}

        <label className="flex flex-col gap-pos-xs">
          <span
            className="text-body-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {t("prescriptions.patient_id")}
            <span
              className="ml-pos-xs"
              style={{ color: "var(--color-urgency)" }}
              aria-hidden="true"
            >
              *
            </span>
          </span>
          <input
            type="text"
            value={patientId}
            onChange={(e) => onPatientIdChange(e.target.value)}
            className="pos-input"
            placeholder="CC / CE / NIT"
            aria-required="true"
          />
        </label>

        {/* ── Divider ─────────────────────────────────────────────── */}

        <hr className="pos-divider" />

        {/* ── Controlled Substance Checkbox ───────────────────────── */}

        <label className="flex items-center gap-pos-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isControlledSubstance}
            onChange={(e) => onIsControlledSubstanceChange(e.target.checked)}
            className="h-4 w-4 rounded-pos"
            style={{
              accentColor: "var(--color-restrict)",
              borderColor: isControlledSubstance
                ? "var(--color-restrict)"
                : "color-mix(in srgb, var(--color-ink) 15%, transparent)",
            }}
          />
          <span
            className="text-body-sm font-semibold"
            style={{ color: "var(--color-restrict)" }}
          >
            {t("prescriptions.controlled_substance")}
          </span>
        </label>

        {/* ── Controlled Substance Fields ─────────────────────────── */}

        {isControlledSubstance && (
          <div
            className="flex flex-col gap-pos-md rounded-pos p-pos-md"
            style={{
              backgroundColor: "var(--color-restrict-surface)",
              border: "1px solid color-mix(in srgb, var(--color-restrict) 25%, transparent)",
            }}
          >
            <label className="flex flex-col gap-pos-xs">
              <span
                className="text-body-sm font-semibold"
                style={{ color: "var(--color-restrict)" }}
              >
                {t("prescriptions.book_entry")}
                <span
                  className="ml-pos-xs"
                  style={{ color: "var(--color-urgency)" }}
                  aria-hidden="true"
                >
                  *
                </span>
              </span>
              <input
                type="text"
                value={bookEntry}
                onChange={(e) => onBookEntryChange(e.target.value)}
                className="pos-input"
                aria-required="true"
                style={{
                  borderColor: "color-mix(in srgb, var(--color-restrict) 30%, transparent)",
                }}
              />
            </label>

            <label className="flex flex-col gap-pos-xs">
              <span
                className="text-body-sm font-semibold"
                style={{ color: "var(--color-restrict)" }}
              >
                {t("prescriptions.book_page")}
                <span
                  className="ml-pos-xs"
                  style={{ color: "var(--color-urgency)" }}
                  aria-hidden="true"
                >
                  *
                </span>
              </span>
              <input
                type="text"
                value={bookPage}
                onChange={(e) => onBookPageChange(e.target.value)}
                className="pos-input"
                aria-required="true"
                style={{
                  borderColor: "color-mix(in srgb, var(--color-restrict) 30%, transparent)",
                }}
              />
            </label>
          </div>
        )}

        {/* ── Error Banner ────────────────────────────────────────── */}

        {error && (
          <div
            role="alert"
            className="rounded-pos p-pos-md text-body-sm"
            style={{
              backgroundColor: "var(--color-urgency-surface)",
              color: "var(--color-urgency)",
              border: "1px solid color-mix(in srgb, var(--color-urgency) 25%, transparent)",
            }}
          >
            {error}
          </div>
        )}

        {/* ── Actions ─────────────────────────────────────────────── */}

        <div className="flex justify-end gap-pos-sm pt-pos-sm">
          <button
            type="button"
            onClick={onCancel}
            className="pos-button pos-button-secondary"
            disabled={isProcessing}
          >
            {t("common.cancel")}
          </button>

          <button
            type="submit"
            className="pos-button pos-button-restrict"
            disabled={isProcessing}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
};
