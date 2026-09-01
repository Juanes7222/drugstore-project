import type { FC } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/** Thin progress track — signature is subtle, never animated loop outside detail context. */
export const ProgressBar: FC<{ percent: number; size?: 'sm' | 'md'; label?: string }> = ({ percent, size = 'md', label }) => {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  const h = size === 'sm' ? 'h-1.5' : 'h-2';
  const reduce = useReducedMotion();
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? `${clamped}% completado`}
      className={`w-full rounded-full overflow-hidden ${h}`}
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)' }}
    >
      <motion.div
        className={`${h} rounded-full`}
        style={{ backgroundColor: 'var(--color-pharma)' }}
        initial={{ width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={reduce ? { duration: 0 } : { duration: 0.5, ease: 'easeOut' }}
      />
    </div>
  );
};
