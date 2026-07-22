/**
 * Delete confirmation dialog — overlay modal with animated entrance.
 *
 * Uses Radix Dialog for focus-trapping, Esc-to-close, and ARIA compliance.
 * Animated with motion (fade + scale) and respects prefers-reduced-motion.
 * Shows a destructive-action warning with Cancel / Delete buttons.
 */
import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, Loader2, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DeleteConfirmDialogProps {
  isOpen: boolean;
  isDeleting: boolean;
  clientName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const contentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DeleteConfirmDialog: FC<DeleteConfirmDialogProps> = ({
  isOpen,
  isDeleting,
  clientName,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();

  const handleConfirm = useCallback(() => {
    if (!isDeleting) onConfirm();
  }, [isDeleting, onConfirm]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open && !isDeleting) onCancel(); }}>
      {/* Overlay */}
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{ duration: shouldReduceMotion ? 0.01 : 0.2 }}
          />
        </Dialog.Overlay>

        {/* Content */}
        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2"
            variants={contentVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{ duration: shouldReduceMotion ? 0.01 : 0.2, ease: "easeOut" }}
          >
            <div
              className="rounded-md bg-white p-6 shadow-lg"
              style={{
                border: "1px solid color-mix(in srgb, var(--color-urgency) 20%, transparent)",
              }}
            >
              {/* Close (X) button */}
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-sm text-sm opacity-50 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
                  aria-label={t("common.close")}
                  disabled={isDeleting}
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>

              {/* Icon + heading */}
              <div className="mb-4 flex items-start gap-3">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: "var(--color-urgency-surface)" }}
                >
                  <AlertTriangle className="size-5" style={{ color: "var(--color-urgency)" }} />
                </div>
                <div className="min-w-0 pt-0.5">
                  <Dialog.Title className="m-0 text-body font-semibold" style={{ color: "var(--color-ink)" }}>
                    {t("clients.delete")}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-body-sm" style={{ color: "var(--color-ink-muted)" }}>
                    {clientName
                      ? t("clients.delete_confirm_named", { name: clientName })
                      : t("clients.delete_confirm")}
                  </Dialog.Description>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end gap-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    disabled={isDeleting}
                    className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-body-sm font-semibold transition-colors"
                    style={{
                      backgroundColor: "var(--color-panel)",
                      color: "var(--color-ink)",
                      borderColor: "color-mix(in srgb, var(--color-ink) 15%, transparent)",
                    }}
                  >
                    {t("common.cancel")}
                  </button>
                </Dialog.Close>

                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={isDeleting}
                  className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-body-sm font-semibold text-white transition-colors hover:brightness-110"
                  style={{ backgroundColor: "var(--color-urgency)" }}
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {t("common.loading")}
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="size-4" />
                      {t("clients.delete")}
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
