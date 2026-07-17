/**
 * Avatar grid — Netflix-style user selection with staggered animations.
 *
 * Shows a centered grid of user profile cards. Each card contains a
 * circular avatar (with initials fallback), display name, and role badge.
 * On hover the card lifts; on click it selects the user and triggers the
 * credential-entry screen.
 *
 * Below the grid a subtle link opens the manual email/password form.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import type { LocalUserInfo } from "../../../domain/auth/local-users";
import { Avatar } from "./avatar.component";
import { useReducedMotion } from "motion/react";

// ---------------------------------------------------------------------------
// Role → color mapping for the accent dot on each card
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

interface AvatarGridProps {
  users: LocalUserInfo[];
  onSelect: (user: LocalUserInfo) => void;
  onOtherAccount: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AvatarGrid: FC<AvatarGridProps> = ({
  users,
  onSelect,
  onOtherAccount,
}) => {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Prompt */}
      <motion.p
        className="text-body font-medium"
        style={{ color: "var(--color-ink)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: shouldReduceMotion ? 0.01 : 0.3 }}
      >
        {t("auth.select_user")}
      </motion.p>

      {/* User card grid */}
      <div
        className="flex flex-wrap justify-center gap-4"
        role="group"
        aria-label={t("auth.select_user")}
      >
        {users.map((user, index) => (
          <motion.button
            key={user.id}
            type="button"
            onClick={() => onSelect(user)}
            className="flex flex-col items-center gap-2"
            style={{
              padding: "16px 20px",
              minWidth: 120,
              borderRadius: "var(--radius-pos)",
              backgroundColor: "var(--color-panel)",
              border: "1px solid rgba(23, 22, 20, 0.08)",
              cursor: "pointer",
              outline: "none",
            }}
            initial={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: 16 }
            }
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: shouldReduceMotion ? 0.01 : 0.35,
              ease: shouldReduceMotion ? undefined : EASE,
              delay: shouldReduceMotion ? 0 : index * 0.05,
            }}
            whileHover={
              shouldReduceMotion
                ? {}
                : {
                    y: -4,
                    scale: 1.03,
                    borderColor: "var(--color-pharma)",
                    boxShadow: "var(--shadow-pos-elevated)",
                    transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] },
                  }
            }
            whileTap={shouldReduceMotion ? {} : { scale: 0.97 }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--color-pharma)";
              e.currentTarget.style.boxShadow = "0 0 0 2px var(--color-pharma)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor =
                "rgba(23, 22, 20, 0.08)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            {/* Avatar */}
            <Avatar
              displayName={user.displayName}
              avatarUrl={user.avatarUrl}
              avatarColor={user.avatarColor}
              userId={user.id}
              size={64}
            />

            {/* Name */}
            <span
              className="text-body-sm font-semibold text-center"
              style={{ color: "var(--color-ink)", lineHeight: 1.3 }}
            >
              {user.displayName}
            </span>

            {/* Role badge */}
            <span
              className="text-caption font-medium"
              style={{
                color: getRoleAccent(user.role),
                backgroundColor: `color-mix(in srgb, ${getRoleAccent(user.role)} 10%, transparent)`,
                padding: "2px 8px",
                borderRadius: "var(--radius-pos)",
              }}
            >
              {t(`roles.${user.role.toLowerCase()}`, user.role)}
            </span>
          </motion.button>
        ))}
      </div>

      {/* Other account link */}
      <motion.button
        type="button"
        onClick={onOtherAccount}
        className="text-body-sm"
        style={{
          color: "var(--color-pharma)",
          background: "none",
          border: "none",
          borderBottom: "1px dashed transparent",
          cursor: "pointer",
          padding: "4px 0",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{
          duration: shouldReduceMotion ? 0.01 : 0.3,
          delay: shouldReduceMotion ? 0 : users.length * 0.05 + 0.15,
        }}
        whileHover={{
          borderBottomColor: "var(--color-pharma)",
          transition: { duration: 0.15 },
        }}
      >
        {t("auth.other_account")}
      </motion.button>
    </div>
  );
};
