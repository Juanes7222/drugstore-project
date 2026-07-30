/**
 * Reusable SVG icon components.
 *
 * Provides a base `<Icon>` component that renders Lucide icons by name,
 * plus convenience components for common use.
 * All icons are from the Lucide icon set (via Iconify).
 *
 * ## Usage
 *
 * ```tsx
 * // Convenience (recommended for existing uses):
 * <StarIcon size={14} color="var(--color-pharma)" />
 * <SparklesIcon size={12} />
 * <HomeIcon size={20} />
 *
 * // Base component (for new icons or dynamic names):
 * <Icon name="home" size={20} />
 * <Icon name="activity" color="#D32F2F" />
 * ```
 */

import { type FC, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

// ---------------------------------------------------------------------------
// Icon name registry
// ---------------------------------------------------------------------------

export type IconName =
  | "activity"
  | "alert-circle"
  | "alert-triangle"
  | "archive"
  | "arrow-left"
  | "bar-chart"
  | "check"
  | "check-circle"
  | "chevron-down"
  | "clock"
  | "cloud"
  | "credit-card"
  | "dollar-sign"
  | "eye"
  | "folder"
  | "help-circle"
  | "home"
  | "info"
  | "minus"
  | "monitor"
  | "package"
  | "plus"
  | "printer"
  | "receipt"
  | "refresh-cw"
  | "rotate-ccw"
  | "scroll-text"
  | "search"
  | "settings"
  | "sparkles"
  | "star"
  | "user"
  | "users"
  | "wifi"
  | "x"
  | "x-circle";

/** Maps each icon name to its JSX path(s). */
const ICON_PATHS: Record<IconName, ReactNode> = {
  // ── Existing icons ────────────────────────────────────────────────────
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
  minus: <path d="M5 12h14" />,
  plus: <path d="M5 12h14m-7-7v14" />,
  "arrow-left": <path d="m12 19-7-7 7-7m7 7H5" />,
  "scroll-text": (
    <>
      <path d="M15 12h-5m5-4h-5m9 9V5a2 2 0 0 0-2-2H4" />
      <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.34-4.34" />
    </>
  ),

  // ── Navigation icons ─────────────────────────────────────────────────
  home: (
    <>
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </>
  ),
  receipt: (
    <>
      <path d="M12 17V7m4 1h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8" />
      <path d="M4 3a1 1 0 0 1 1-1a1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1a1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2a1 1 0 0 1-1-1z" />
    </>
  ),
  "refresh-cw": (
    <>
      <path d="M3 12a9 9 0 0 1 9-9a9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9a9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  "rotate-ccw": (
    <>
      <path d="M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  package: (
    <>
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73zm1 .27V12" />
      <path d="M3.29 7L12 12l8.71-5M7.5 4.27l9 5.15" />
    </>
  ),
  activity: (
    <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.744" />
    </>
  ),
  wifi: <path d="M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.859a10 10 0 0 1 14 0m-10.5 3.57a5 5 0 0 1 7 0" />,
  archive: (
    <>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4" />
    </>
  ),
  "dollar-sign": (
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  "credit-card": (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </>
  ),
  printer: (
    <>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </>
  ),
  "bar-chart": (
    <path d="M5 21v-6m7 6V9m7 12V3" />
  ),
  settings: (
    <>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0a2.34 2.34 0 0 0 3.319 1.915a2.34 2.34 0 0 1 2.33 4.033a2.34 2.34 0 0 0 0 3.831a2.34 2.34 0 0 1-2.33 4.033a2.34 2.34 0 0 0-3.319 1.915a2.34 2.34 0 0 1-4.659 0a2.34 2.34 0 0 0-3.32-1.915a2.34 2.34 0 0 1-2.33-4.033a2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  "alert-circle": (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  "alert-triangle": (
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01" />
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  "check-circle": (
    <>
      <path d="M21.801 10A10 10 0 1 1 17 3.335" />
      <path d="m9 11l3 3L22 4" />
    </>
  ),
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9" />,
  "chevron-down": <path d="m6 9l6 6l6-6" />,
  "help-circle": (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4m0-4h.01" />
    </>
  ),
  eye: (
    <>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 19.876 0a1 1 0 0 1 0 .696a10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  folder: (
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />
  ),
  x: (
    <path d="M18 6L6 18M6 6l12 12" />
  ),
  "x-circle": (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6m0-6l6 6" />
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
  /** Optional inline styles. */
  style?: React.CSSProperties;
  /** Stroke color. Default "currentColor". */
  color?: string;
  /** Stroke width. Default 2. */
  strokeWidth?: number;
}

// ---------------------------------------------------------------------------
// Base Icon component
// ---------------------------------------------------------------------------

export const Icon: FC<IconProps> = ({
  name,
  size = 14,
  className,
  style,
  color,
  strokeWidth = 2,
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
      aria-hidden="true"
      className={className}
      style={style}
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

/** Activity / pulse icon. */
export const ActivityIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="activity" {...props} />
);

/** Alert circle / warning icon. */
export const AlertCircleIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="alert-circle" {...props} />
);

/** Alert triangle / warning icon. */
export const AlertTriangleIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="alert-triangle" {...props} />
);

/** Archive / box icon. */
export const ArchiveIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="archive" {...props} />
);

/** Arrow left / back icon. */
export const ArrowLeftIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="arrow-left" {...props} />
);

/** Check circle / confirmed icon. */
export const CheckCircleIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="check-circle" {...props} />
);

/** Bar chart / reports icon. */
export const BarChartIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="bar-chart" {...props} />
);

/** Check / confirm icon. */
export const CheckIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="check" {...props} />
);

/** Cloud / sync icon. */
export const CloudIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="cloud" {...props} />
);

/** Chevron down / expand icon. */
export const ChevronDownIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="chevron-down" {...props} />
);

/** Clock / history icon. */
export const ClockIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="clock" {...props} />
);

/** Credit card / payment icon. */
export const CreditCardIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="credit-card" {...props} />
);

/** Dollar sign / cash icon. */
export const DollarSignIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="dollar-sign" {...props} />
);

/** Eye / visibility icon. */
export const EyeIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="eye" {...props} />
);

/** Folder / directory icon. */
export const FolderIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="folder" {...props} />
);

/** Help circle / question icon. */
export const HelpCircleIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="help-circle" {...props} />
);

/** Info circle icon. */
export const InfoIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="info" {...props} />
);

/** Home icon. */
export const HomeIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="home" {...props} />
);

/** Minus / decrease icon. */
export const MinusIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="minus" {...props} />
);

/** Monitor / screen icon. */
export const MonitorIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="monitor" {...props} />
);

/** Package / inventory icon. */
export const PackageIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="package" {...props} />
);

/** Plus / increase icon. */
export const PlusIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="plus" {...props} />
);

/** Printer icon. */
export const PrinterIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="printer" {...props} />
);

/** Receipt / fiscal invoice icon. */
export const ReceiptIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="receipt" {...props} />
);

/** Refresh / returns icon. */
export const RefreshCwIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="refresh-cw" {...props} />
);

/** Rotate CCW / undo / recovery icon. */
export const RotateCcwIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="rotate-ccw" {...props} />
);

/** Scroll text / audit log icon. */
export const ScrollTextIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="scroll-text" {...props} />
);

/** Search / magnifier icon. */
export const SearchIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="search" {...props} />
);

/** Settings / gear icon. */
export const SettingsIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="settings" {...props} />
);

/** Sparkles / suggestion icon. */
export const SparklesIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="sparkles" {...props} />
);

/** Star / featured icon. */
export const StarIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="star" {...props} />
);

/** User / single person icon. */
export const UserIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="user" {...props} />
);

/** Wifi / network icon. */
export const WifiIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="wifi" {...props} />
);

/** Users / multiple people icon. */
export const UsersIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="users" {...props} />
);

/** X / close icon. */
export const XIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="x" {...props} />
);

/** X circle / error icon. */
export const XCircleIcon: FC<Omit<IconProps, "name">> = (props) => (
  <Icon name="x-circle" {...props} />
);
