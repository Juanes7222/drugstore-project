/**
 * Edit user modal — update display name, email, and role.
 *
 * Pre-fills form from the existing user row. Only fields the manager
 * changes are sent to the API.
 *
 * @category Component
 */

import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UserRow } from "./user-management.types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EditUserModalProps {
  isOpen: boolean;
  user: UserRow;
  onClose: () => void;
  onSubmit: (userId: string, data: EditUserFormData) => Promise<void>;
}

export interface EditUserFormData {
  displayName: string;
  email: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Role options for editing
// ---------------------------------------------------------------------------

const ROLE_OPTIONS = [
  { value: "CASHIER", key: "roles.cashier" },
  { value: "MANAGER", key: "roles.manager" },
  { value: "ACCOUNTANT", key: "roles.accountant" },
  { value: "INVENTORY_ASSISTANT", key: "roles.inventory_assistant" },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const EditUserModal: FC<EditUserModalProps> = ({
  isOpen,
  user,
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation();

  const [form, setForm] = useState<EditUserFormData>({
    displayName: user.displayName ?? user.fullName ?? "",
    email: user.email ?? "",
    role: user.role,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleChange = (field: keyof EditUserFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onSubmit(user.id, form);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOverlayClick = () => {
    if (!isSubmitting) onClose();
  };

  const hasChanges =
    form.displayName !== (user.displayName ?? user.fullName ?? "") ||
    form.email !== (user.email ?? "") ||
    form.role !== user.role;

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
        <h2 className="text-heading mb-4 font-bold" style={{ color: "var(--color-ink)" }}>
          {t("user_management.edit_title")}
        </h2>

        <div className="flex flex-col gap-3">
          {/* Display name */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("user_management.display_name")}
            </label>
            <input
              type="text"
              value={form.displayName}
              onChange={(e) => handleChange("displayName", e.target.value)}
              className="pos-input w-full"
              placeholder={t("user_management.display_name_placeholder")}
              disabled={isSubmitting}
            />
          </div>

          {/* Email */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("user_management.email")}
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => handleChange("email", e.target.value)}
              className="pos-input w-full"
              placeholder={t("user_management.email_placeholder")}
              disabled={isSubmitting}
            />
          </div>

          {/* Role */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("user_management.role")}
            </label>
            <select
              value={form.role}
              onChange={(e) => handleChange("role", e.target.value)}
              className="pos-input w-full"
              disabled={isSubmitting}
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.key)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex gap-3">
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
            disabled={!form.displayName || !hasChanges || isSubmitting}
            onClick={handleSubmit}
            className="pos-button pos-button-primary flex-1"
          >
            {isSubmitting
              ? t("user_management.saving_changes")
              : t("user_management.save_changes")}
          </button>
        </div>
      </div>
    </div>
  );
};
