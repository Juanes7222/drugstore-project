/**
 * Receipt screen skeleton — Phase 4 will own the full content.
 *
 * For Phase 3, this component consumes the sale-completing motion handoff:
 * it mounts when the active screen becomes "receipt" with phase "completing",
 * plays the completing entry choreography, and then dispatches
 * `completeSaleCompletion` so the rest of the app knows the handoff finished.
 */
import { type FC, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  completeSaleCompletion,
  resetSaleFlow,
  selectSaleCompletionPhase,
} from "@/store/slices/ui-slice";

const COMPLETING_ENTRY_DURATION_S = 0.35;

export const Receipt: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const phase = useAppSelector(selectSaleCompletionPhase);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (phase === "idle") {
      // If Receipt mounts outside the handoff (e.g. deep link), mark complete
      // immediately so the UI does not stay stuck.
      dispatch(completeSaleCompletion());
    }
  }, [dispatch, phase]);

  const handleNewSale = useCallback(() => {
    dispatch(resetSaleFlow());
  }, [dispatch]);

  const handleAnimationComplete = useCallback(() => {
    dispatch(completeSaleCompletion());
  }, [dispatch]);

  return (
    <motion.section
      aria-label={t("receipt.title")}
      className="flex h-full flex-col items-center justify-center p-pos-md"
      style={{ backgroundColor: "var(--color-surface)" }}
      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 40 }}
      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0.01 : COMPLETING_ENTRY_DURATION_S,
        ease: "easeOut",
      }}
      onAnimationComplete={handleAnimationComplete}
    >
      <div className="pos-panel max-w-md p-pos-xl text-center">
        <div
          className="mx-auto mb-pos-md flex h-12 w-12 items-center justify-center rounded-full"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-pharma) 12%, white)",
          }}
        >
          <CheckIcon />
        </div>
        <h2
          className="text-heading font-bold"
          style={{ color: "var(--color-ink)" }}
        >
          {t("receipt.title")}
        </h2>
        <p
          className="mt-pos-sm text-body"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("receipt.placeholder_message")}
        </p>
        <button
          type="button"
          onClick={handleNewSale}
          className="pos-button pos-button-primary mt-pos-lg w-full"
        >
          {t("receipt.new_sale")}
        </button>
      </div>
    </motion.section>
  );
};

const CheckIcon: FC = () => (
  <svg
    className="h-6 w-6"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke="var(--color-pharma)"
    strokeWidth={2.5}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);
