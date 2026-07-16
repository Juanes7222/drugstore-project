/**
 * Error banner — animated error message for the login page.
 *
 * Enters with a subtle horizontal shake to draw attention.
 */
import { type FC } from "react";
import { motion } from "motion/react";

interface ErrorBannerProps {
  message: string;
}

export const ErrorBanner: FC<ErrorBannerProps> = ({ message }) => (
  <motion.p
    className="text-body-sm text-center"
    style={{ color: "#D32F2F" }}
    initial={{ opacity: 0, x: -8 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
  >
    {message}
  </motion.p>
);
