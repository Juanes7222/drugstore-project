/**
 * StatsCard — a single KPI card for the Home dashboard.
 *
 * Shows a label, a value (optionally in the data/mono face for numbers),
 * an optional icon, and a subtle description. Designed for the
 * "Resumen del día" section.
 *
 * When a numeric `countUp` target is provided the value animates from 0
 * with an ease-out curve on mount. The animation is decorative only: it
 * respects prefers-reduced-motion and headless environments, which jump
 * straight to the final value.
 */
import { type FC, useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { IconComponent } from "@/components/ui/icons";

interface StatsCardProps {
  /** Translation key or direct label text */
  label: string;
  /** The primary value to display (e.g. "$45.200", "12") */
  value: string;
  /** Optional lucide icon rendered above the value */
  icon?: IconComponent;
  /** Optional description / secondary text */
  description?: string;
  /** Use the JetBrains Mono data face for the value (prices, counts) */
  numeric?: boolean;
  /**
   * Optional numeric target for a one-shot count-up on mount.
   * When provided, the displayed value counts from 0 to this number
   * over ~800ms with an ease-out curve, then renders the formatted
   * result. Ignored when undefined (the `value` string is shown as-is).
   */
  countUp?: number;
  /** Optional extra className */
  className?: string;
}

const COUNT_UP_DURATION_MS = 800;
const COUNT_UP_STEPS = 30;

/** Count-up formatter — Spanish grouping separators (es-CO locale). */
const countUpFormatter = new Intl.NumberFormat("es-CO");

/**
 * Animate `target` from 0 using a fixed-step interval. A fixed step count
 * (instead of requestAnimationFrame) keeps the animation deterministic and
 * testable with fake timers. Under reduced motion or without interval
 * support the target is rendered immediately.
 */
function useCountUp(target: number | undefined): number {
  const shouldReduceMotion = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (target === undefined) return;
    // Zero is already the initial state — nothing to animate.
    if (target === 0) return;

    // Decorative flourish only — reduced motion and environments without
    // interval support (jsdom without fake timers) show the final value.
    if (shouldReduceMotion) {
      setValue(target);
      return;
    }

    let step = 0;
    const intervalId = setInterval(() => {
      step += 1;
      const progress = Math.min(step / COUNT_UP_STEPS, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(Math.round(target * eased));
      if (progress >= 1) clearInterval(intervalId);
    }, COUNT_UP_DURATION_MS / COUNT_UP_STEPS);

    return () => clearInterval(intervalId);
  }, [target, shouldReduceMotion]);

  return value;
}

export const StatsCard: FC<StatsCardProps> = ({
  label,
  value,
  icon: Icon,
  description,
  numeric = false,
  countUp,
  className = "",
}) => {
  const animatedCount = useCountUp(countUp);
  const displayValue =
    countUp === undefined ? value : countUpFormatter.format(animatedCount);

  return (
    <div
      className={`pos-panel flex flex-col gap-pos-xs p-pos-lg ${className}`}
    >
      <div className="flex items-center gap-pos-sm">
        {Icon && (
          <Icon
            size={16}
            strokeWidth={1.5}
            className="shrink-0"
            style={{ color: "var(--color-ink-muted)" }}
            aria-hidden="true"
          />
        )}
        <span
          className="text-caption font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {label}
        </span>
      </div>

      <span
        className={`${numeric ? "font-data" : ""} text-price font-bold tabular-nums`}
        style={{ color: "var(--color-ink)" }}
      >
        {displayValue}
      </span>

      {description && (
        <span
          className="text-caption"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {description}
        </span>
      )}
    </div>
  );
};
