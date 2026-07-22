/**
 * Create user modal — form for adding a new user.
 *
 * Self-contained form state. Calls onSubmit with displayName, username,
 * email, role, and initialPin on confirm.
 *
 * @category Component
 */

import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NewUserForm } from "./user-management.types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: NewUserForm) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CreateUserModal: FC<CreateUserModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation();

  const [form, setForm] = useState<NewUserForm>({
    displayName: "",
    username: "",
    email: "",
    role: "CASHIER",
    initialPin: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleChange = (field: keyof NewUserForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onSubmit(form);
      setForm({ displayName: "", username: "", email: "", role: "CASHIER", initialPin: "" });
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
        className="pos-panel w-full max-w-md p-pos-xl"
        style={{ backgroundColor: "var(--color-surface)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          className="text-heading font-bold mb-4"
          style={{ color: "var(--color-ink)" }}
        >
          {t("user_management.add_user")}
        </h2>

        <div className="flex flex-col gap-3">
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

          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("user_management.username")}
            </label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => handleChange("username", e.target.value)}
              className="pos-input w-full"
              placeholder={t("user_management.username_placeholder")}
              disabled={isSubmitting}
            />
          </div>

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

          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("user_management.role")}
            </label>
            <select
              value={form.role}
              onChange={(e) =>
                handleChange("role", e.target.value as "CASHIER" | "MANAGER")
              }
              className="pos-input w-full"
              disabled={isSubmitting}
            >
              <option value="CASHIER">{t("roles.cashier")}</option>
              <option value="MANAGER">{t("roles.manager")}</option>
            </select>
          </div>

          {form.role === "CASHIER" && (
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("user_management.initial_pin")}
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={form.initialPin}
                onChange={(e) =>
                  handleChange(
                    "initialPin",
                    e.target.value.replace(/\D/g, "").slice(0, 6),
                  )
                }
                className="pos-input w-full"
                placeholder={t("user_management.pin_placeholder")}
                disabled={isSubmitting}
              />
            </div>
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
            disabled={!form.displayName || isSubmitting}
            onClick={handleSubmit}
            className="pos-button pos-button--primary flex-1"
          >
            {isSubmitting ? t("common.loading") : t("user_management.create_user")}
          </button>
        </div>
      </div>
    </div>
  );
};
