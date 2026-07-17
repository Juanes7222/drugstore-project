/**
 * Reusable SVG icon components.
 *
 * Provides a base `<Icon>` component that renders Lucide icons by name,
 * plus convenience components (`StarIcon`, `SparklesIcon`) for common use.
 * All icons are from the Lucide icon set (via Iconify).
 *
 * ## Usage
 *
 * ```tsx
 * // Convenience (recommended for existing uses):
 * <StarIcon size={14} color="var(--color-pharma)" />
 * <SparklesIcon size={12} />
 *
 * // Base component (for new icons or dynamic names):
 * <Icon name="star" size={14} />
 * <Icon name="sparkles" color="#D32F2F" />
 * ```
 */

import { type FC, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

// ---------------------------------------------------------------------------
// Icon name registry
// ---------------------------------------------------------------------------

export type IconName = "star" | "sparkles";

/** Maps each icon name to its JSX path(s). */
const ICON_PATHS: Record<IconName, ReactNode> = {
  star: (
    <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.12 2.12 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16z" />
  ),
  sparkles: (
    <>
      <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
      <path d="M20 2v4m2-2h-4" />
      <circle cx="4" cy="20" r="2" />
    </>
  ),
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface IconProps {
  /** Icon name (must be registered in ICON_PATHS). */
  name: IconName;
  /** Icon width/height in pixels. Default 14. */
  size?: number;
  /** Optional className for the SVG element. */
  className?: string;
  /** Stroke color. Default "currentColor". */
  color?: string;
}

// ---------------------------------------------------------------------------
// Base Icon component
// ---------------------------------------------------------------------------

export const Icon: FC<IconProps> = ({
  name,
  size = 14,
  className,
  color,
}) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      initial={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.5 }}
      animate={prefersReducedMotion ? undefined : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      {ICON_PATHS[name]}
    </motion.svg>
  );
};

// ---------------------------------------------------------------------------
// Convenience components
// ---------------------------------------------------------------------------

/** Indicates a field with a system-configured default value. */
export const StarIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="star" {...props} />
);

/** Indicates a field where the system suggests a value. */
export const SparklesIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="sparkles" {...props} />
);
