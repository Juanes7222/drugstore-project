/**
 * Manual login form — email/username + password with animated entry.
 *
 * Shown when the user clicks "Other account" on the avatar grid.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";

interface ManualLoginFormProps {
  identifier: string;
  password: string;
  isLoading: boolean;
  onIdentifierChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export const ManualLoginForm: FC<ManualLoginFormProps> = ({
  identifier,
  password,
  isLoading,
  onIdentifierChange,
  onPasswordChange,
  onSubmit,
  onBack,
}) => {
  const { t } = useTranslation();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") onSubmit();
  };

  return (
    <motion.div
      className="w-full flex flex-col gap-4 max-w-xs mx-auto"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
    >
      {/* Identifier */}
      <div>
        <label
          className="block text-body-sm font-medium mb-1.5"
          style={{ color: "var(--color-ink)" }}
        >
          {t("auth.email_or_username")}
        </label>
        <input
          type="text"
          value={identifier}
          onChange={(e) => onIdentifierChange(e.target.value)}
          className="pos-input w-full"
          placeholder="usuario@ejemplo.com"
          autoFocus
          style={{ textAlign: "center" }}
        />
      </div>

      {/* Password */}
      <div>
        <label
          className="block text-body-sm font-medium mb-1.5"
          style={{ color: "var(--color-ink)" }}
        >
          {t("auth.password")}
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          className="pos-input w-full"
          placeholder="********"
          style={{ textAlign: "center", fontSize: "1.125rem" }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Submit */}
      <motion.button
        type="button"
        disabled={!identifier || !password || isLoading}
        onClick={onSubmit}
        className="pos-button w-full"
        style={{
          backgroundColor: "var(--color-pharma)",
          color: "var(--color-panel)",
          fontWeight: 600,
          opacity: !identifier || !password || isLoading ? 0.5 : 1,
        }}
        whileTap={!isLoading ? { scale: 0.97 } : undefined}
      >
        {isLoading ? t("auth.signing_in") : t("auth.sign_in")}
      </motion.button>

      {/* Back to user selection */}
      <button
        type="button"
        onClick={onBack}
        className="text-body-sm"
        style={{
          color: "var(--color-pharma)",
          background: "none",
          border: "none",
          cursor: "pointer",
        }}
      >
        {t("auth.select_user")}
      </button>
    </motion.div>
  );
};
