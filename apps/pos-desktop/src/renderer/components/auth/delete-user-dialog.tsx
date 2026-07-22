/**
 * Delete user confirmation dialog (OWNER only).
 *
 * Uses the native overlay+panel pattern consistent with the rest of the app.
 * The destructive action is visually highlighted with error-red styling.
 *
 * @category Component
 */

import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UserRow } from "./user-management.types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DeleteUserDialogProps {
  isOpen: boolean;
  user: UserRow;
  onClose: () => void;
  onConfirm: (userId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DeleteUserDialog: FC<DeleteUserDialogProps> = ({
  isOpen,
  user,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm(user.id);
    } finally {
      setIsSubmitting(false);
    }
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
        className="pos-panel w-full max-w-sm p-pos-xl"
        style={{ backgroundColor: "var(--color-surface)" }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-user-title"
        aria-describedby="delete-user-desc"
      >
        <h2
          id="delete-user-title"
          className="text-ui mb-2 font-bold text-error"
        >
          {t("user_management.delete_user")}
        </h2>

        <p id="delete-user-desc" className="mb-1 text-body text-ink">
          {t("user_management.delete_confirm", { name: user.displayName || user.fullName || user.username })}
        </p>
        <p className="mb-4 text-caption text-ink-muted">
          {t("user_management.delete_confirm_detail")}
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="pos-button pos-button-secondary flex-1"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleConfirm}
            className="pos-button flex-1"
            style={{
              backgroundColor: "var(--color-error)",
              color: "var(--color-panel)",
              fontWeight: 600,
            }}
          >
            {isSubmitting ? t("common.loading") : t("user_management.delete_user")}
          </button>
        </div>
      </div>
    </div>
  );
};
