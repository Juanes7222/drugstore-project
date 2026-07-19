/**
 * Animated wrapper for wizard steps.
 *
 * Provides:
 * - Slide+fade transitions via AnimatePresence mode="wait"
 * - Direction-aware animation (forward = slide left, backward = slide right)
 * - Step number pill indicator
 *
 * @category Component
 */
import { type FC, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const slideVariants = {
  enter: (dir: number) => ({
    x: dir > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (dir: number) => ({
    x: dir > 0 ? -300 : 300,
    opacity: 0,
  }),
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface WizardStepLayoutProps {
  /** Unique key per step — drives AnimatePresence detection. */
  stepKey: string;
  /** +1 for forward, -1 for backward. */
  direction: number;
  /** 1-based current step number for the pill. 0 = hide. */
  stepNumber?: number;
  /** Total steps for the pill label. */
  totalSteps?: number;
  children: ReactNode;
}

export const WizardStepLayout: FC<WizardStepLayoutProps> = ({
  stepKey,
  direction,
  stepNumber = 0,
  totalSteps = 0,
  children,
}) => {
  const { t } = useTranslation();

  return (
    <div className="relative min-h-[240px]">
      {/* Step indicator pill */}
      {stepNumber > 0 && totalSteps > 0 && (
        <div className="flex justify-center mb-pos-lg">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-medium tracking-wide"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)',
              color: 'var(--color-ink-muted)',
            }}
          >
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-pharma) 20%, transparent)',
                color: 'var(--color-pharma)',
              }}
            >
              {stepNumber}
            </span>
            <span>
              {t('cash_shift.wizard_step_of', { current: stepNumber, total: totalSteps })}
            </span>
          </span>
        </div>
      )}

      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={stepKey}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.8 }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
