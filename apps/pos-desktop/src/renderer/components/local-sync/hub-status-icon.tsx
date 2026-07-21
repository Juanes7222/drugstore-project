/**
 * HubStatusIcon — animated SVG indicator for local hub connectivity.
 *
 * Three states with distinct visual language:
 * - connected:    pulsing green dot + radiating rings (hub present)
 * - disconnected: static gray dot with dashed ring (no hub)
 * - electing:     spinning arc with dashed orbit (election in progress)
 *
 * Respects prefers-reduced-motion: static fallback for each state.
 *
 * @category Local Sync
 */

import { type FC } from 'react';
import { motion, useReducedMotion } from 'motion/react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HubStatus = 'connected' | 'disconnected' | 'electing';

export interface HubStatusIconProps {
  /** Current hub connectivity state. */
  status: HubStatus;
  /** Accessible label (defaults to automatic per status). */
  ariaLabel?: string;
  /** Diameter in px. Default 24. */
  size?: number;
}

// ---------------------------------------------------------------------------
// Color tokens — must match design-system.md palette
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SVG constants
// ---------------------------------------------------------------------------

const DOT_CX = 12;
const DOT_CY = 12;
const DOT_R = 4;
const RING_R = 10;
const RING_W = 1.5;

// ---------------------------------------------------------------------------
// Static state renderers (used when reduced-motion is preferred)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Animated state renderers
// ---------------------------------------------------------------------------

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
// Main component
// ---------------------------------------------------------------------------

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
