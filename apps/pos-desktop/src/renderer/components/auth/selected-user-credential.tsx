/**
 * Selected user credential entry — animated PIN/password form.
 *
 * After selecting a user from the avatar grid, this component slides in
 * with the selected user's avatar prominently displayed, followed by
 * the appropriate credential entry:
 * - Cashier / Manager → PinKeypad (numeric PIN entry)
 * - Owner / Admin     → password text input with lockout handling
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { RoleType } from "@pharmacy/shared-types";
import type { LocalUserInfo } from "../../../domain/auth/local-users";
import { Avatar } from "./avatar.component";
import { PinKeypad } from "./pin-keypad.component";

// ---------------------------------------------------------------------------
// Role → accent color
// ---------------------------------------------------------------------------

const ROLE_ACCENT: Record<string, string> = {
  OWNER: "#5B3E96",
  MANAGER: "#0B6E6B",
  CASHIER: "#E8780A",
  ADMIN: "#4A6572",
  INVENTORY: "#0B6E6B",
};

function getRoleAccent(role: string): string {
  return ROLE_ACCENT[role] ?? "#4A6572";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SelectedUserCredentialProps {
  user: LocalUserInfo;
  password: string;
  error: string | null;
  isLoading: boolean;
  countdown: number;
  onPasswordChange: (value: string) => void;
  onPinComplete: (pin: string) => void;
  onPasswordSubmit: () => void;
  onChangeUser: () => void;
  onForgotPassword: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SelectedUserCredential: FC<SelectedUserCredentialProps> = ({
  user,
  password,
  error,
  isLoading,
  countdown,
  onPasswordChange,
  onPinComplete,
  onPasswordSubmit,
  onChangeUser,
  onForgotPassword,
}) => {
  const { t } = useTranslation();

  const isPinUser =
    user.role === RoleType.CASHIER || user.role === RoleType.MANAGER;

  const accentColor = getRoleAccent(user.role);

  // -------------------------------------------------------------------
  // Shared motion config — snappy ease-out per Emil's philosophy
  // -------------------------------------------------------------------

  return (
    <motion.div
      className="w-full flex flex-col items-center gap-5"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      key={user.id}
    >
      {/* ── User card ── */}
      <motion.div
        className="flex flex-col items-center gap-3"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", duration: 0.5, bounce: 0.15 }}
      >
        {/* Avatar ring */}
        <div
          style={{
            borderRadius: "50%",
            padding: 3,
            background: `conic-gradient(${accentColor}, color-mix(in srgb, ${accentColor} 40%, transparent), ${accentColor})`,
          }}
        >
          <Avatar
            displayName={user.displayName}
            avatarUrl={user.avatarUrl}
            avatarColor={user.avatarColor}
            userId={user.id}
            size={72}
          />
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <p
            className="text-ui font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {user.displayName}
          </p>
          <p
            className="text-caption font-medium"
            style={{ color: accentColor }}
          >
            {t(`roles.${user.role.toLowerCase()}`, user.role)}
          </p>
        </div>

        {/* Change user button */}
        <button
          type="button"
          onClick={onChangeUser}
          className="text-caption"
          style={{
            color: "var(--color-pharma)",
            background: "none",
            border: "none",
            borderBottom: "1px dashed transparent",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderBottomColor = "var(--color-pharma)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderBottomColor = "transparent";
          }}
        >
          {t("auth.change_user")}
        </button>
      </motion.div>

      {/* ── Credential input ── */}
      <motion.div
        className="w-full max-w-xs"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      >
        {isPinUser ? (
          <PinKeypad
            length={6}
            onComplete={onPinComplete}
            onCancel={onChangeUser}
            error={error}
            isLoading={isLoading}
            label={
              user.role === RoleType.CASHIER
                ? t("auth.pin_label")
                : t("auth.manager_pin_label")
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/* Password input */}
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
                placeholder="••••••••"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onPasswordSubmit();
                }}
                autoFocus
                style={{ textAlign: "center", fontSize: "1.125rem" }}
              />
            </div>

            {/* Error */}
            {error && (
              <motion.p
                className="text-body-sm text-center"
                style={{ color: "#D32F2F" }}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
              >
                {error}
              </motion.p>
            )}

            {/* Lockout countdown */}
            {countdown > 0 && (
              <p
                className="text-caption text-center"
                style={{ color: "var(--color-urgency)" }}
              >
                {t("auth.lockout_countdown", {
                  minutes: Math.floor(countdown / 60),
                  seconds: (countdown % 60).toString().padStart(2, "0"),
                })}
              </p>
            )}

            {/* Submit */}
            <motion.button
              type="button"
              disabled={!password || isLoading}
              onClick={onPasswordSubmit}
              className="pos-button w-full"
              style={{
                backgroundColor: "var(--color-pharma)",
                color: "var(--color-panel)",
                fontWeight: 600,
                opacity: !password || isLoading ? 0.5 : 1,
              }}
              whileTap={!isLoading ? { scale: 0.97 } : undefined}
            >
              {isLoading ? t("auth.signing_in") : t("auth.sign_in")}
            </motion.button>

            {/* Forgot password */}
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-caption"
              style={{
                color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                background: "none",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              {t("auth.forgot_password")}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};
