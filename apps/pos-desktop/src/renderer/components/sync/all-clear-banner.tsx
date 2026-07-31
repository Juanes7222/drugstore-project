/**
 * Success banner indicating no sync failures detected.
 *
 * Uses design-system success tokens and a lucide CheckCircle2 icon.
 * Animated entrance via motion. Reassures the user that the sync
 * engine is operating normally.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { CheckCircleIcon } from "@/components/ui/icons";

export const AllClearBanner: FC = () => {
  const { t } = useTranslation();

  return (
    <motion.div
      className="mb-6 flex items-center gap-3 rounded-lg border border-success bg-success-container px-4 py-3 shadow-pos-panel"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <CheckCircleIcon className="h-5 w-5 flex-shrink-0 text-success" aria-hidden="true" />
      <p className="text-body-sm font-medium text-success">
        {t("sync.all_clear")}
      </p>
    </motion.div>
  );
};
