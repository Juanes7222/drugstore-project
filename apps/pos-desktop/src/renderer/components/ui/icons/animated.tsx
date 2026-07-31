/**
 * Animated icon components.
 *
 * Home for icons that animate on their own (spinners, live indicators).
 * All components respect `prefers-reduced-motion` and render a static
 * fallback when motion is disabled.
 *
 * ## Usage
 *
 * ```tsx
 * <LoaderIcon size={20} className="text-ink-muted" />
 * <HubStatusIcon status="connected" />
 * ```
 */

import { type FC } from "react";
import { motion, useReducedMotion } from "motion/react";

// ---------------------------------------------------------------------------
// LoaderIcon — spinning progress arc
// ---------------------------------------------------------------------------

export interface LoaderIconProps {
  /** Icon width/height in pixels. Default 16. */
  size?: number;
  /** Optional className for the SVG element. */
  className?: string;
  /** Optional inline styles. */
  style?: React.CSSProperties;
  /** Stroke color. Default "currentColor". */
  color?: string;
  /** Stroke width. Default 2. */
  strokeWidth?: number;
  /** Accessibility: hide from screen readers. Default true (decorative). */
  'aria-hidden'?: boolean | 'true' | 'false';
  /** Optional test id for assertions. */
  'data-testid'?: string;
}

/** Spinning loader arc. Falls back to a static arc under reduced motion. */
export const LoaderIcon: FC<LoaderIconProps> = ({
  size = 16,
  className,
  style,
  color,
  strokeWidth = 2,
  'aria-hidden': ariaHidden = true,
  'data-testid': dataTestId,
}) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={ariaHidden}
      data-icon="loader-circle"
      data-testid={dataTestId}
      className={`${prefersReducedMotion ? "" : "animate-spin"} ${className ?? ""}`}
      style={style}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </motion.svg>
  );
};

// ---------------------------------------------------------------------------
// HubStatusIcon — local hub connectivity indicator
// ---------------------------------------------------------------------------

export type HubStatus = "connected" | "disconnected" | "electing";

export interface HubStatusIconProps {
  /** Current hub connectivity state. */
  status: HubStatus;
  /** Accessible label (defaults to automatic per status). */
  ariaLabel?: string;
  /** Diameter in px. Default 24. */
  size?: number;
}

// Color tokens — must match design-system.md palette
const COLORS = {
  connected:    '#0B6E6B', // Pharma Teal — trust
  disconnected: '#B0AD9E', // Slate Muted — inactive
  electing:     '#E8A600', // Urgency Amber — transitional
} as const;

const RING_COLORS = {
  connected:    'rgba(11, 110, 107, 0.25)',
  disconnected: 'rgba(176, 173, 158, 0.20)',
  electing:     'rgba(232, 166, 0, 0.30)',
} as const;

// SVG constants
const DOT_CX = 12;
const DOT_CY = 12;
const DOT_R = 4;
const RING_R = 10;
const RING_W = 1.5;

/** Connected — solid ring + dot, no animation. */
const StaticConnected: FC<{ color: string; ringColor: string }> = ({
  color,
  ringColor,
}) => (
  <>
    <circle cx={DOT_CX} cy={DOT_CY} r={RING_R} stroke={ringColor} strokeWidth={RING_W} fill="none" />
    <circle cx={DOT_CX} cy={DOT_CY} r={DOT_R} fill={color} />
  </>
);

/** Electing — solid ring with one gap, no spin. */
const StaticElecting: FC<{ color: string; ringColor: string }> = ({
  color,
  ringColor,
}) => (
  <>
    <circle
      cx={DOT_CX}
      cy={DOT_CY}
      r={RING_R}
      stroke={ringColor}
      strokeWidth={RING_W}
      strokeDasharray="12 6.8"
      fill="none"
    />
    <circle cx={DOT_CX} cy={DOT_CY} r={DOT_R} fill={color} />
  </>
);

/** Connected — two radiating rings + pulsing center. */
const AnimatedConnected: FC<{ color: string; ringColor: string }> = ({
  color,
  ringColor,
}) => (
  <>
    <motion.circle
      cx={DOT_CX}
      cy={DOT_CY}
      r={RING_R}
      stroke={ringColor}
      strokeWidth={RING_W}
      fill="none"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: [0, 1, 0], scale: [0.8, 1.2, 0.8] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
    />
    <motion.circle
      cx={DOT_CX}
      cy={DOT_CY}
      r={RING_R}
      stroke={ringColor}
      strokeWidth={RING_W}
      fill="none"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: [0, 1, 0], scale: [0.8, 1.2, 0.8] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
    />
    <motion.circle
      cx={DOT_CX}
      cy={DOT_CY}
      r={DOT_R}
      fill={color}
      initial={{ opacity: 0.6 }}
      animate={{ opacity: [0.6, 1, 0.6] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
    />
  </>
);

/** Electing — spinning arc along orbit. */
const AnimatedElecting: FC<{ color: string; ringColor: string }> = ({
  color,
  ringColor,
}) => (
  <>
    <circle
      cx={DOT_CX}
      cy={DOT_CY}
      r={RING_R}
      stroke={ringColor}
      strokeWidth={RING_W}
      strokeDasharray="2 4"
      fill="none"
    />
    <motion.path
      d="M 12 2 A 10 10 0 1 1 11.99 2"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      fill="none"
      initial={{ rotate: 0 }}
      animate={{ rotate: 360 }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
      style={{ transformOrigin: '12px 12px' }}
    />
    <circle cx={DOT_CX} cy={DOT_CY} r={DOT_R} fill={color} />
  </>
);

// ---------------------------------------------------------------------------
// SuccessCheckIcon — draw-in success checkmark
// ---------------------------------------------------------------------------

export interface SuccessCheckIconProps {
  /** Icon width/height in pixels. Default 20. */
  size?: number;
  /** Optional className for the SVG element. */
  className?: string;
  /** Optional inline styles. */
  style?: React.CSSProperties;
  /** Stroke color. Default "currentColor". */
  color?: string;
  /** Stroke width. Default 2.5. */
  strokeWidth?: number;
  /** Accessibility: hide from screen readers. Default true (decorative). */
  'aria-hidden'?: boolean | 'true' | 'false';
  /** Optional test id for assertions. */
  'data-testid'?: string;
}

/**
 * SuccessCheckIcon — checkmark whose stroke draws itself in over ~450ms.
 * Used for sale-completion moments (payment confirmed, receipt ready).
 * Respects prefers-reduced-motion: renders a fully-drawn static check.
 */
export const SuccessCheckIcon: FC<SuccessCheckIconProps> = ({
  size = 20,
  className,
  style,
  color,
  strokeWidth = 2.5,
  'aria-hidden': ariaHidden = true,
  'data-testid': dataTestId,
}) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={ariaHidden}
      data-icon="success-check"
      data-testid={dataTestId}
      className={className}
      style={style}
    >
      <motion.path
        d="M20 6L9 17l-5-5"
        initial={prefersReducedMotion ? undefined : { pathLength: 0 }}
        animate={prefersReducedMotion ? undefined : { pathLength: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// SyncPulseIcon — rotating sync arrows
// ---------------------------------------------------------------------------

export interface SyncPulseIconProps {
  /** Icon width/height in pixels. Default 16. */
  size?: number;
  /** Optional className for the SVG element. */
  className?: string;
  /** Optional inline styles. */
  style?: React.CSSProperties;
  /** Stroke color. Default "currentColor". */
  color?: string;
  /** Stroke width. Default 2. */
  strokeWidth?: number;
  /** Accessibility: hide from screen readers. Default true (decorative). */
  'aria-hidden'?: boolean | 'true' | 'false';
  /** Optional test id for assertions. */
  'data-testid'?: string;
}

/**
 * SyncPulseIcon — circular refresh arrows that rotate continuously while
 * the sync queue drains. Static under prefers-reduced-motion.
 */
export const SyncPulseIcon: FC<SyncPulseIconProps> = ({
  size = 16,
  className,
  style,
  color,
  strokeWidth = 2,
  'aria-hidden': ariaHidden = true,
  'data-testid': dataTestId,
}) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={ariaHidden}
      data-icon="sync-pulse"
      data-testid={dataTestId}
      className={className}
      style={style}
    >
      <motion.g
        initial={prefersReducedMotion ? undefined : { rotate: 0 }}
        animate={prefersReducedMotion ? undefined : { rotate: 360 }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
        style={{ transformOrigin: "12px 12px" }}
      >
        <path d="M3 12a9 9 0 0 1 9-9a9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9a9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M8 16H3v5" />
      </motion.g>
    </svg>
  );
};

// ---------------------------------------------------------------------------
// WifiPulseIcon — wifi signal with staggered pulsing arcs
// ---------------------------------------------------------------------------

export interface WifiPulseIconProps {
  /** Icon width/height in pixels. Default 16. */
  size?: number;
  /** Optional className for the SVG element. */
  className?: string;
  /** Optional inline styles. */
  style?: React.CSSProperties;
  /** Stroke color. Default "currentColor". */
  color?: string;
  /** Stroke width. Default 2. */
  strokeWidth?: number;
  /** Accessibility: hide from screen readers. Default true (decorative). */
  'aria-hidden'?: boolean | 'true' | 'false';
  /** Optional test id for assertions. */
  'data-testid'?: string;
}

/**
 * WifiPulseIcon — wifi arcs that pulse outward from the base dot.
 * Designed for the offline banner / reconnecting states: calm, rhythmic,
 * never alarming. Static under prefers-reduced-motion.
 */
export const WifiPulseIcon: FC<WifiPulseIconProps> = ({
  size = 16,
  className,
  style,
  color,
  strokeWidth = 2,
  'aria-hidden': ariaHidden = true,
  'data-testid': dataTestId,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const pulseTransition = {
    duration: 2,
    repeat: Infinity,
    ease: "easeInOut" as const,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={ariaHidden}
      data-icon="wifi-pulse"
      data-testid={dataTestId}
      className={className}
      style={style}
    >
      <path d="M12 20h.01" />
      <motion.path
        d="M2 8.82a15 15 0 0 1 20 0"
        initial={prefersReducedMotion ? undefined : { opacity: 0.3 }}
        animate={prefersReducedMotion ? undefined : { opacity: [0.3, 1, 0.3] }}
        transition={pulseTransition}
      />
      <motion.path
        d="M5 12.859a10 10 0 0 1 14 0"
        initial={prefersReducedMotion ? undefined : { opacity: 0.3 }}
        animate={prefersReducedMotion ? undefined : { opacity: [0.3, 1, 0.3] }}
        transition={{ ...pulseTransition, delay: 0.25 }}
      />
      <motion.path
        d="M8.5 16.429a5 5 0 0 1 7 0"
        initial={prefersReducedMotion ? undefined : { opacity: 0.3 }}
        animate={prefersReducedMotion ? undefined : { opacity: [0.3, 1, 0.3] }}
        transition={{ ...pulseTransition, delay: 0.5 }}
      />
    </svg>
  );
};

/**
 * HubStatusIcon — animated SVG indicator for local hub connectivity.
 *
 * Three states with distinct visual language:
 * - connected:    pulsing green dot + radiating rings (hub present)
 * - disconnected: static gray dot with dashed ring (no hub)
 * - electing:     spinning arc with dashed orbit (election in progress)
 *
 * Respects prefers-reduced-motion: static fallback for each state.
 */
export const HubStatusIcon: FC<HubStatusIconProps> = ({
  status,
  ariaLabel,
  size = 24,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const color = COLORS[status];
  const ringColor = RING_COLORS[status];

  const label =
    ariaLabel ?? {
      connected: 'Hub local conectado',
      disconnected: 'Hub local no disponible',
      electing: 'Elección de hub en curso',
    }[status];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={label}
    >
      {/* Connected */}
      {status === 'connected' &&
        (prefersReducedMotion
          ? <StaticConnected color={color} ringColor={ringColor} />
          : <AnimatedConnected color={color} ringColor={ringColor} />
        )}

      {/* Disconnected — always static */}
      {status === 'disconnected' && (
        <>
          <circle
            cx={DOT_CX}
            cy={DOT_CY}
            r={RING_R}
            stroke={ringColor}
            strokeWidth={RING_W}
            strokeDasharray="3 3"
            fill="none"
          />
          <circle cx={DOT_CX} cy={DOT_CY} r={DOT_R} fill={color} />
        </>
      )}

      {/* Electing */}
      {status === 'electing' &&
        (prefersReducedMotion
          ? <StaticElecting color={color} ringColor={ringColor} />
          : <AnimatedElecting color={color} ringColor={ringColor} />
        )}
    </svg>
  );
};
