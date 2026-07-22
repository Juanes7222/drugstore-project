/**
 * Set PIN dialog — modal for resetting a user's numeric access PIN.
 *
 * @category Component
 */

import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SetPinDialogProps {
  isOpen: boolean;
  userName: string;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (newPin: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SetPinDialog: FC<SetPinDialogProps> = ({
  isOpen,
  userName,
  isSubmitting,
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation();

  const [pin, setPin] = useState("");

  if (!isOpen) return null;

  const pinError = pin.length > 0 && pin.length < 4;

  const handlePinChange = (value: string) => {
    setPin(value.replace(/\D/g, "").slice(0, 6));
  };

  const handleSubmit = async () => {
    if (pin.length < 4) return;
    await onSubmit(pin);
    setPin("");
  };

  const handleOverlayClick = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={handleOverlayClick}
    >
      <div
        className="pos-panel w-full max-w-md p-pos-xl"
        style={{ backgroundColor: "var(--color-surface)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          className="text-heading font-bold mb-4"
          style={{ color: "var(--color-ink)" }}
        >
          {t("user_management.set_pin_title", { name: userName })}
        </h2>

        <div>
          <label className="mb-1 block text-sm font-medium">
            {t("user_management.pin_label")}
          </label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={pin}
            onChange={(e) => handlePinChange(e.target.value)}
            className="pos-input w-full"
            placeholder={t("user_management.pin_placeholder")}
            disabled={isSubmitting}
          />
          {pinError && (
            <p
              className="mt-1 text-sm"
              style={{ color: "var(--color-danger)" }}
            >
              {t("user_management.pin_too_short")}
            </p>
          )}
        </div>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="pos-button pos-button--ghost flex-1"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={pin.length < 4 || isSubmitting}
            onClick={handleSubmit}
            className="pos-button pos-button--primary flex-1"
          >
            {isSubmitting ? t("common.loading") : t("user_management.set_pin_confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
