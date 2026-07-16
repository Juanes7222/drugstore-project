/**
 * Login header — pharma-branded app title and tagline.
 *
 * Renders the app name in Pharma Teal with a subtitle below.
 * Animated entrance via the parent AnimatePresence.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";

export const LoginHeader: FC = () => {
  const { t } = useTranslation();

  return (
    <motion.div
      className="flex flex-col items-center gap-1"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
    >
      {/* Brand mark — pharmacy cross + app name */}
      <div
        className="flex items-center justify-center"
        style={{ color: "var(--color-pharma)" }}
      >
        <svg
          width="36"
          height="36"
          viewBox="0 0 36 36"
          fill="none"
          aria-hidden="true"
        >
          <rect x="14" y="4" width="8" height="28" rx="2" fill="currentColor" />
          <rect x="4" y="14" width="28" height="8" rx="2" fill="currentColor" />
        </svg>
      </div>

      <h1
        className="text-heading font-bold mt-2"
        style={{ color: "var(--color-ink)" }}
      >
        {t("common.app_name")}
      </h1>

      <p
        className="text-body-sm"
        style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}
      >
        {t("auth.login_title")}
      </p>
    </motion.div>
  );
};
