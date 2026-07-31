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
 *
 * ## Naming
 *
 * Each icon exposes a PascalCase convenience component suffixed with `Icon`
 * (e.g. `CheckIcon`, `Trash2Icon`). The `IconName` union lists every
 * registered kebab-case name. Components are typed as `IconComponent`
 * (`FC<Omit<IconProps, "name">>`) so they can be stored/passed as values.
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
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "arrow-up-down"
  | "arrow-up-from-line"
  | "ban"
  | "bar-chart"
  | "barcode"
  | "book"
  | "book-open"
  | "bookmark"
  | "building"
  | "building-2"
  | "calendar"
  | "calendar-clock"
  | "calendar-days"
  | "check"
  | "check-check"
  | "check-circle"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "chevron-up"
  | "circle-plus"
  | "clipboard-list"
  | "clock"
  | "cloud"
  | "command"
  | "credit-card"
  | "cross"
  | "dollar-sign"
  | "download"
  | "edit-3"
  | "enter"
  | "eye"
  | "file-down"
  | "file-json"
  | "file-search"
  | "file-spreadsheet"
  | "file-text"
  | "filter"
  | "folder"
  | "globe"
  | "hard-drive"
  | "help-circle"
  | "history"
  | "home"
  | "inbox"
  | "info"
  | "keyboard"
  | "key-round"
  | "lock"
  | "log-in"
  | "logo"
  | "log-out"
  | "mail"
  | "map-pin"
  | "mic"
  | "minus"
  | "monitor"
  | "network"
  | "package"
  | "package-check"
  | "pencil"
  | "percent"
  | "phone"
  | "pin"
  | "plug"
  | "plus"
  | "printer"
  | "radio"
  | "receipt"
  | "refresh-cw"
  | "repeat"
  | "rotate-ccw"
  | "rotate-cw"
  | "ruler"
  | "save"
  | "scale"
  | "scroll-text"
  | "search"
  | "search-x"
  | "server"
  | "settings"
  | "settings-2"
  | "shield"
  | "shield-alert"
  | "shield-off"
  | "shopping-bag"
  | "shopping-cart"
  | "sparkles"
  | "star"
  | "sticky-note"
  | "store"
  | "sun"
  | "tag"
  | "toggle-left"
  | "trash-2"
  | "trending-down"
  | "usb"
  | "trending-up"
  | "truck"
  | "undo-2"
  | "unlock"
  | "user"
  | "user-circle"
  | "user-plus"
  | "user-x"
  | "users"
  | "volume-2"
  | "wifi"
  | "wifi-off"
  | "x"
  | "x-circle";

/** Maps each icon name to its JSX path(s). */
export const ICON_PATHS: Record<IconName, ReactNode> = {
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

  // ── New icons (Lucide via Iconify) ────────────────────────────────────
  "arrow-down": <path d="M12 5v14m7-7l-7 7l-7-7" />,
  "arrow-up": <path d="m5 12l7-7l7 7m-7 7V5" />,
  "arrow-right": <path d="M5 12h14m-7-7l7 7l-7 7" />,
  "arrow-up-down": <path d="m21 16l-4 4l-4-4m4 4V4M3 8l4-4l4 4M7 4v16" />,
  "arrow-up-from-line": <path d="m18 9l-6-6l-6 6m6-6v14m-7 4h14" />,
  ban: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M4.929 4.929L19.07 19.071" />
    </>
  ),
  barcode: <path d="M3 5v14M8 5v14m4-14v14m5-14v14m4-14v14" />,
  "book-open": <path d="M12 5v16m8.001-2A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2a5 5 0 0 1 4-2z" />,
  bookmark: <path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z" />,
  building: (
    <>
      <path d="M12 10h.01M12 14h.01M12 6h.01M16 10h.01M16 14h.01M16 6h.01M8 10h.01M8 14h.01M8 6h.01M9 22v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
      <rect width="16" height="20" x="4" y="2" rx="2" />
    </>
  ),
  "building-2": (
    <>
      <path d="M10 12h4m-4-4h4m0 13v-3a2 2 0 0 0-4 0v3" />
      <path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" />
      <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
    </>
  ),
  calendar: (
    <>
      <path d="M8 2v3m8-3v3" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
    </>
  ),
  "calendar-clock": (
    <>
      <path d="M16 14v2.2l1.6 1M16 2v3m5 2.338V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2.338M3 9h5.859M8 2v3" />
      <circle cx="16" cy="16" r="6" />
    </>
  ),
  "calendar-days": (
    <>
      <path d="M8 2v3m8-3v3" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01" />
    </>
  ),
  "check-check": <path d="M18 6L7 17l-5-5m20-2l-7.5 7.5L13 16" />,
  "chevron-left": <path d="m15 18l-6-6l6-6" />,
  "chevron-right": <path d="m9 18l6-6l-6-6" />,
  "chevron-up": <path d="m18 15l-6-6l-6 6" />,
  "circle-plus": (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8m-4-4v8" />
    </>
  ),
  "clipboard-list": (
    <>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2m4 7h4m-4 5h4m-8-5h.01M8 16h.01" />
    </>
  ),
  command: <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />,
  cross: (
    <path
      d="M9 2h6a1 1 0 0 1 1 1v5h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-5v5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-5H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h5V3a1 1 0 0 1 1-1z"
      fill="currentColor"
      stroke="none"
    />
  ),
  download: (
    <>
      <path d="M12 15V3m9 12v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10l5 5l5-5" />
    </>
  ),
  "edit-3": <path d="M13 21h8m.174-14.188a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />,
  "file-down": (
    <>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5m-8 10v-6m-3 3l3 3l3-3" />
    </>
  ),
  "file-json": (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4m-10 4a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1a1 1 0 0 1 1 1v1a1 1 0 0 0 1 1m4 0a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1a1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" />
    </>
  ),
  "file-search": (
    <>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <circle cx="11.5" cy="14.5" r="2.5" />
      <path d="M13.3 16.3L15 18" />
    </>
  ),
  "file-spreadsheet": (
    <>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5M8 13h2m4 0h2m-8 4h2m4 0h2" />
    </>
  ),
  "file-text": (
    <>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5M10 9H8m8 4H8m8 4H8" />
    </>
  ),
  filter: <path d="M22 3H2l8 9.46V19l4 2v-8.54z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20a14.5 14.5 0 0 0 0-20M2 12h20" />
    </>
  ),
  "hard-drive": <path d="M10 16h.01m-7.798-4.423a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zm19.734.436H2.054M6 16h.01" />,
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5m4-1v5l4 2" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11" />
    </>
  ),
  keyboard: (
    <>
      <path d="M10 8h.01M12 12h.01M14 8h.01M16 12h.01M18 8h.01M6 8h.01M7 16h10m-9-4h.01" />
      <rect width="20" height="16" x="2" y="4" rx="2" />
    </>
  ),
  "key-round": (
    <>
      <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
      <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  ),
  lock: (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  "log-in": <path d="m10 17l5-5l-5-5m5 5H3m12-9h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />,
  "log-out": <path d="m16 17l5-5l-5-5m5 5H9m0 9H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />,
  mail: (
    <>
      <path d="m22 7l-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
      <rect width="20" height="16" x="2" y="4" rx="2" />
    </>
  ),
  "map-pin": (
    <>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  mic: (
    <>
      <path d="M12 19v3m7-12v2a7 7 0 0 1-14 0v-2" />
      <rect width="6" height="13" x="9" y="2" rx="3" />
    </>
  ),
  network: (
    <>
      <rect width="6" height="6" x="16" y="16" rx="1" />
      <rect width="6" height="6" x="2" y="16" rx="1" />
      <rect width="6" height="6" x="9" y="2" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3m-7-4V8" />
    </>
  ),
  "package-check": (
    <>
      <path d="M12 22V12m4 5l2 2l4-4" />
      <path d="M21 11.127V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l1.32-.753" />
      <path d="M3.29 7L12 12l8.71-5M7.5 4.27l8.997 5.148" />
    </>
  ),
  pencil: <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4" />,
  percent: (
    <>
      <path d="M19 5L5 19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </>
  ),
  phone: <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233a14 14 0 0 0 6.392 6.384" />,
  pin: (
    <>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
    </>
  ),
  radio: (
    <>
      <path d="M16.247 7.761a6 6 0 0 1 0 8.478m2.828-11.306a10 10 0 0 1 0 14.134m-14.15 0a10 10 0 0 1 0-14.134m2.828 11.306a6 6 0 0 1 0-8.478" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  repeat: (
    <>
      <path d="m17 2l4 4l-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4l4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>
  ),
  "rotate-cw": (
    <>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  ruler: <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Zm-6.8-2.8l2-2m-5-1l2-2m-5-1l2-2m7 11l2-2" />,
  save: (
    <>
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7" />
    </>
  ),
  scale: (
    <>
      <path d="M12 3v18m7-13l3 8a5 5 0 0 1-6 0zV7" />
      <path d="M3 7h1a17 17 0 0 0 8-2a17 17 0 0 0 8 2h1M5 8l3 8a5 5 0 0 1-6 0zV7m2 14h10" />
    </>
  ),
  "search-x": (
    <>
      <path d="m13.5 8.5l-5 5m0-5l5 5" />
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21l-4.3-4.3" />
    </>
  ),
  server: (
    <>
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <path d="M6 6h.01M6 18h.01" />
    </>
  ),
  "settings-2": (
    <>
      <path d="M14 17H5M19 7h-9" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </>
  ),
  shield: <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />,
  "shield-alert": <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zm-8-5v4m0 4h.01" />,
  "shield-off": <path d="m2 2l20 20M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71M9.309 3.652A12.3 12.3 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a10 10 0 0 1-.08 1.264" />,
  "shopping-bag": (
    <>
      <path d="M16 10a4 4 0 0 1-8 0M3.103 6.034h17.794" />
      <path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" />
    </>
  ),
  "shopping-cart": (
    <>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </>
  ),
  "sticky-note": (
    <>
      <path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z" />
      <path d="M15 3v5a1 1 0 0 0 1 1h5" />
    </>
  ),
  store: (
    <>
      <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5m8.774-10.69a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.451 0a1.12 1.12 0 0 0-1.548 0a2.5 2.5 0 0 1-3.452 0a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244" />
      <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ),
  tag: (
    <>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  ),
  "toggle-left": (
    <>
      <circle cx="9" cy="12" r="3" />
      <rect width="20" height="14" x="2" y="5" rx="7" />
    </>
  ),
  "trash-2": <path d="M10 11v6m4-6v6m5-11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
  "trending-down": (
    <>
      <path d="M16 17h6v-6" />
      <path d="m22 17l-8.5-8.5l-5 5L2 7" />
    </>
  ),
  "trending-up": (
    <>
      <path d="M16 7h6v6" />
      <path d="m22 7l-8.5 8.5l-5-5L2 17" />
    </>
  ),
  truck: (
    <>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2m10 0H9m10 0h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </>
  ),
  "undo-2": (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
    </>
  ),
  usb: (
    <>
      <circle cx="10" cy="7" r="1" />
      <circle cx="4" cy="20" r="1" />
      <path d="M4.7 19.3L19 5m2-2l-3 1l2 2ZM9.26 7.68L5 12l2 5m3-3l5 2l3.5-3.5" />
      <path d="m18 12l1-1l1 1l-1 1Z" />
    </>
  ),
  unlock: (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </>
  ),
  "user-circle": (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="10" r="3" />
      <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
    </>
  ),
  "user-plus": (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6m3-3h-6" />
    </>
  ),
  "user-x": (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="m17 8l5 5m0-5l-5 5" />
    </>
  ),
  "volume-2": <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6m3.364 3.364a9 9 0 0 0 0-12.728" />,
  "wifi-off": <path d="M12 20h.01M8.5 16.429a5 5 0 0 1 7 0M5 12.859a10 10 0 0 1 5.17-2.69m8.83 2.69a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764M2 2l20 20" />,

  // ── Inline refactor icons ───────────────────────────────────────────
  book: (
    <>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
      <path d="M4 15h1" />
      <path d="M8 15h1" />
      <path d="M12 15h1" />
    </>
  ),
  enter: (
    <>
      <rect width="20" height="14" x="2" y="4" rx="2" />
      <path d="M8 12h8" />
      <path d="M10 10 8 12l2 2" />
    </>
  ),
  logo: (
    <>
      <rect x="9.33" y="2.67" width="5.33" height="18.67" rx="1.33" fill="currentColor" stroke="none" />
      <rect x="2.67" y="9.33" width="18.67" height="5.33" rx="1.33" fill="currentColor" stroke="none" />
    </>
  ),
  plug: (
    <>
      <rect x="7" y="2" width="10" height="7" rx="1" />
      <path d="M12 9v5" />
      <path d="M5 16a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
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
  /** Fill color for the SVG element (overrides the default "none"). */
  fill?: string;
  /** Accessibility: hide from screen readers. Default true (decorative). */
  'aria-hidden'?: boolean | 'true' | 'false';
  /** Optional test id for assertions. */
  'data-testid'?: string;
  /** Accessible label; when set, disables the default aria-hidden. */
  'aria-label'?: string;
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
  fill,
  'aria-hidden': ariaHidden = true,
  'data-testid': dataTestId,
  'aria-label': ariaLabel,
}) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ?? "none"}
      stroke={color ?? "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={ariaLabel ? false : ariaHidden}
      aria-label={ariaLabel}
      data-icon={name}
      data-testid={dataTestId}
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

/** Component type for convenience icons (everything but `name`). */
export type IconComponent = FC<Omit<IconProps, "name">>;

// ---------------------------------------------------------------------------
// Convenience components
// ---------------------------------------------------------------------------

/** Activity / pulse icon. */
export const ActivityIcon: IconComponent = (props) => (
  <Icon name="activity" {...props} />
);

/** Alert circle / warning icon. */
export const AlertCircleIcon: IconComponent = (props) => (
  <Icon name="alert-circle" {...props} />
);

/** Alert triangle / warning icon. */
export const AlertTriangleIcon: IconComponent = (props) => (
  <Icon name="alert-triangle" {...props} />
);

/** Triangle alert icon (lucide legacy alias of AlertTriangle). */
export const TriangleAlertIcon: IconComponent = (props) => (
  <Icon name="alert-triangle" {...props} />
);

/** Archive / box icon. */
export const ArchiveIcon: IconComponent = (props) => (
  <Icon name="archive" {...props} />
);

/** Arrow down icon. */
export const ArrowDownIcon: IconComponent = (props) => (
  <Icon name="arrow-down" {...props} />
);

/** Arrow left / back icon. */
export const ArrowLeftIcon: IconComponent = (props) => (
  <Icon name="arrow-left" {...props} />
);

/** Arrow right icon. */
export const ArrowRightIcon: IconComponent = (props) => (
  <Icon name="arrow-right" {...props} />
);

/** Arrow up icon. */
export const ArrowUpIcon: IconComponent = (props) => (
  <Icon name="arrow-up" {...props} />
);

/** Arrow up/down sort icon. */
export const ArrowUpDownIcon: IconComponent = (props) => (
  <Icon name="arrow-up-down" {...props} />
);

/** Arrow up from line / upload icon. */
export const ArrowUpFromLineIcon: IconComponent = (props) => (
  <Icon name="arrow-up-from-line" {...props} />
);

/** Ban / forbidden icon. */
export const BanIcon: IconComponent = (props) => (
  <Icon name="ban" {...props} />
);

/** Bar chart / reports icon. */
export const BarChartIcon: IconComponent = (props) => (
  <Icon name="bar-chart" {...props} />
);

/** Barcode icon. */
export const BarcodeIcon: IconComponent = (props) => (
  <Icon name="barcode" {...props} />
);

/** Book / notebook icon. */
export const BookIcon: IconComponent = (props) => (
  <Icon name="book" {...props} />
);

/** Book open / documentation icon. */
export const BookOpenIcon: IconComponent = (props) => (
  <Icon name="book-open" {...props} />
);

/** Bookmark / save view icon. */
export const BookmarkIcon: IconComponent = (props) => (
  <Icon name="bookmark" {...props} />
);

/** Building icon. */
export const BuildingIcon: IconComponent = (props) => (
  <Icon name="building" {...props} />
);

/** Building 2 / company icon. */
export const Building2Icon: IconComponent = (props) => (
  <Icon name="building-2" {...props} />
);

/** Calendar icon. */
export const CalendarIcon: IconComponent = (props) => (
  <Icon name="calendar" {...props} />
);

/** Calendar clock icon. */
export const CalendarClockIcon: IconComponent = (props) => (
  <Icon name="calendar-clock" {...props} />
);

/** Calendar days icon. */
export const CalendarDaysIcon: IconComponent = (props) => (
  <Icon name="calendar-days" {...props} />
);

/** Check / confirm icon. */
export const CheckIcon: IconComponent = (props) => (
  <Icon name="check" {...props} />
);

/** Check check / double confirm icon. */
export const CheckCheckIcon: IconComponent = (props) => (
  <Icon name="check-check" {...props} />
);

/** Check circle / confirmed icon. */
export const CheckCircleIcon: IconComponent = (props) => (
  <Icon name="check-circle" {...props} />
);

/** Check circle 2 icon (lucide legacy alias of CheckCircle). */
export const CheckCircle2Icon: IconComponent = (props) => (
  <Icon name="check-circle" {...props} />
);

/** Chevron down / expand icon. */
export const ChevronDownIcon: IconComponent = (props) => (
  <Icon name="chevron-down" {...props} />
);

/** Chevron left icon. */
export const ChevronLeftIcon: IconComponent = (props) => (
  <Icon name="chevron-left" {...props} />
);

/** Chevron right icon. */
export const ChevronRightIcon: IconComponent = (props) => (
  <Icon name="chevron-right" {...props} />
);

/** Chevron up icon. */
export const ChevronUpIcon: IconComponent = (props) => (
  <Icon name="chevron-up" {...props} />
);

/** Circle plus / add icon. */
export const CirclePlusIcon: IconComponent = (props) => (
  <Icon name="circle-plus" {...props} />
);

/** Clipboard list icon. */
export const ClipboardListIcon: IconComponent = (props) => (
  <Icon name="clipboard-list" {...props} />
);

/** Clock / history icon. */
export const ClockIcon: IconComponent = (props) => (
  <Icon name="clock" {...props} />
);

/** Cloud / sync icon. */
export const CloudIcon: IconComponent = (props) => (
  <Icon name="cloud" {...props} />
);

/** Command / ⌘ icon. */
export const CommandIcon: IconComponent = (props) => (
  <Icon name="command" {...props} />
);

/** Credit card / payment icon. */
export const CreditCardIcon: IconComponent = (props) => (
  <Icon name="credit-card" {...props} />
);

/** Pharmacy cross / brand mark icon. */
export const CrossIcon: IconComponent = (props) => (
  <Icon name="cross" {...props} />
);

/** Dollar sign / cash icon. */
export const DollarSignIcon: IconComponent = (props) => (
  <Icon name="dollar-sign" {...props} />
);

/** Download icon. */
export const DownloadIcon: IconComponent = (props) => (
  <Icon name="download" {...props} />
);

/** Edit 3 / pen-line icon. */
export const Edit3Icon: IconComponent = (props) => (
  <Icon name="edit-3" {...props} />
);

/** Edit icon (lucide legacy alias of Edit3). */
export const EditIcon: IconComponent = (props) => (
  <Icon name="edit-3" {...props} />
);

/** Enter / return key icon. */
export const EnterIcon: IconComponent = (props) => (
  <Icon name="enter" {...props} />
);

/** Eye / visibility icon. */
export const EyeIcon: IconComponent = (props) => (
  <Icon name="eye" {...props} />
);

/** File down / export icon. */
export const FileDownIcon: IconComponent = (props) => (
  <Icon name="file-down" {...props} />
);

/** File JSON icon. */
export const FileJsonIcon: IconComponent = (props) => (
  <Icon name="file-json" {...props} />
);

/** File search icon. */
export const FileSearchIcon: IconComponent = (props) => (
  <Icon name="file-search" {...props} />
);

/** File spreadsheet icon. */
export const FileSpreadsheetIcon: IconComponent = (props) => (
  <Icon name="file-spreadsheet" {...props} />
);

/** File text icon. */
export const FileTextIcon: IconComponent = (props) => (
  <Icon name="file-text" {...props} />
);

/** Filter icon. */
export const FilterIcon: IconComponent = (props) => (
  <Icon name="filter" {...props} />
);

/** Folder / directory icon. */
export const FolderIcon: IconComponent = (props) => (
  <Icon name="folder" {...props} />
);

/** Globe / language icon. */
export const GlobeIcon: IconComponent = (props) => (
  <Icon name="globe" {...props} />
);

/** Hard drive icon. */
export const HardDriveIcon: IconComponent = (props) => (
  <Icon name="hard-drive" {...props} />
);

/** Help circle / question icon. */
export const HelpCircleIcon: IconComponent = (props) => (
  <Icon name="help-circle" {...props} />
);

/** History / audit log icon. */
export const HistoryIcon: IconComponent = (props) => (
  <Icon name="history" {...props} />
);

/** Home icon. */
export const HomeIcon: IconComponent = (props) => (
  <Icon name="home" {...props} />
);

/** Inbox icon. */
export const InboxIcon: IconComponent = (props) => (
  <Icon name="inbox" {...props} />
);

/** Info circle icon. */
export const InfoIcon: IconComponent = (props) => (
  <Icon name="info" {...props} />
);

/** Keyboard icon. */
export const KeyboardIcon: IconComponent = (props) => (
  <Icon name="keyboard" {...props} />
);

/** Key round / password icon. */
export const KeyRoundIcon: IconComponent = (props) => (
  <Icon name="key-round" {...props} />
);

/** Lock / restricted icon. */
export const LockIcon: IconComponent = (props) => (
  <Icon name="lock" {...props} />
);

/** Log in icon. */
export const LogInIcon: IconComponent = (props) => (
  <Icon name="log-in" {...props} />
);

/** Logo / brand mark icon. */
export const LogoIcon: IconComponent = (props) => (
  <Icon name="logo" {...props} />
);

/** Log out icon. */
export const LogOutIcon: IconComponent = (props) => (
  <Icon name="log-out" {...props} />
);

/** Mail icon. */
export const MailIcon: IconComponent = (props) => (
  <Icon name="mail" {...props} />
);

/** Map pin / location icon. */
export const MapPinIcon: IconComponent = (props) => (
  <Icon name="map-pin" {...props} />
);

/** Microphone icon. */
export const MicIcon: IconComponent = (props) => (
  <Icon name="mic" {...props} />
);

/** Minus / decrease icon. */
export const MinusIcon: IconComponent = (props) => (
  <Icon name="minus" {...props} />
);

/** Monitor / screen icon. */
export const MonitorIcon: IconComponent = (props) => (
  <Icon name="monitor" {...props} />
);

/** Network icon. */
export const NetworkIcon: IconComponent = (props) => (
  <Icon name="network" {...props} />
);

/** Package / inventory icon. */
export const PackageIcon: IconComponent = (props) => (
  <Icon name="package" {...props} />
);

/** Package check icon. */
export const PackageCheckIcon: IconComponent = (props) => (
  <Icon name="package-check" {...props} />
);

/** Pencil / edit icon. */
export const PencilIcon: IconComponent = (props) => (
  <Icon name="pencil" {...props} />
);

/** Percent icon. */
export const PercentIcon: IconComponent = (props) => (
  <Icon name="percent" {...props} />
);

/** Phone icon. */
export const PhoneIcon: IconComponent = (props) => (
  <Icon name="phone" {...props} />
);

/** Plug / connection icon. */
export const PlugIcon: IconComponent = (props) => (
  <Icon name="plug" {...props} />
);

/** Pin / fix icon. */
export const PinIcon: IconComponent = (props) => (
  <Icon name="pin" {...props} />
);

/** Plus / increase icon. */
export const PlusIcon: IconComponent = (props) => (
  <Icon name="plus" {...props} />
);

/** Printer icon. */
export const PrinterIcon: IconComponent = (props) => (
  <Icon name="printer" {...props} />
);

/** Radio / transmission icon. */
export const RadioIcon: IconComponent = (props) => (
  <Icon name="radio" {...props} />
);

/** Receipt / fiscal invoice icon. */
export const ReceiptIcon: IconComponent = (props) => (
  <Icon name="receipt" {...props} />
);

/** Refresh / returns icon. */
export const RefreshCwIcon: IconComponent = (props) => (
  <Icon name="refresh-cw" {...props} />
);

/** Repeat icon. */
export const RepeatIcon: IconComponent = (props) => (
  <Icon name="repeat" {...props} />
);

/** Rotate CCW / undo / recovery icon. */
export const RotateCcwIcon: IconComponent = (props) => (
  <Icon name="rotate-ccw" {...props} />
);

/** Rotate CW / retry icon. */
export const RotateCwIcon: IconComponent = (props) => (
  <Icon name="rotate-cw" {...props} />
);

/** Ruler / measurement icon. */
export const RulerIcon: IconComponent = (props) => (
  <Icon name="ruler" {...props} />
);

/** Save icon. */
export const SaveIcon: IconComponent = (props) => (
  <Icon name="save" {...props} />
);

/** Scale / balanced icon. */
export const ScaleIcon: IconComponent = (props) => (
  <Icon name="scale" {...props} />
);

/** Scroll text / audit log icon. */
export const ScrollTextIcon: IconComponent = (props) => (
  <Icon name="scroll-text" {...props} />
);

/** Search / magnifier icon. */
export const SearchIcon: IconComponent = (props) => (
  <Icon name="search" {...props} />
);

/** Search x / no results icon. */
export const SearchXIcon: IconComponent = (props) => (
  <Icon name="search-x" {...props} />
);

/** Server icon. */
export const ServerIcon: IconComponent = (props) => (
  <Icon name="server" {...props} />
);

/** Settings / gear icon. */
export const SettingsIcon: IconComponent = (props) => (
  <Icon name="settings" {...props} />
);

/** Settings 2 icon. */
export const Settings2Icon: IconComponent = (props) => (
  <Icon name="settings-2" {...props} />
);

/** Shield icon. */
export const ShieldIcon: IconComponent = (props) => (
  <Icon name="shield" {...props} />
);

/** Shield alert icon. */
export const ShieldAlertIcon: IconComponent = (props) => (
  <Icon name="shield-alert" {...props} />
);

/** Shield off icon. */
export const ShieldOffIcon: IconComponent = (props) => (
  <Icon name="shield-off" {...props} />
);

/** Shopping bag icon. */
export const ShoppingBagIcon: IconComponent = (props) => (
  <Icon name="shopping-bag" {...props} />
);

/** Shopping cart icon. */
export const ShoppingCartIcon: IconComponent = (props) => (
  <Icon name="shopping-cart" {...props} />
);

/** Sparkles / suggestion icon. */
export const SparklesIcon: IconComponent = (props) => (
  <Icon name="sparkles" {...props} />
);

/** Star / featured icon. */
export const StarIcon: IconComponent = (props) => (
  <Icon name="star" {...props} />
);

/** Sticky note icon. */
export const StickyNoteIcon: IconComponent = (props) => (
  <Icon name="sticky-note" {...props} />
);

/** Store icon. */
export const StoreIcon: IconComponent = (props) => (
  <Icon name="store" {...props} />
);

/** Sun icon. */
export const SunIcon: IconComponent = (props) => (
  <Icon name="sun" {...props} />
);

/** Tag icon. */
export const TagIcon: IconComponent = (props) => (
  <Icon name="tag" {...props} />
);

/** Toggle left icon. */
export const ToggleLeftIcon: IconComponent = (props) => (
  <Icon name="toggle-left" {...props} />
);

/** Trash 2 / delete icon. */
export const Trash2Icon: IconComponent = (props) => (
  <Icon name="trash-2" {...props} />
);

/** Trending down icon. */
export const TrendingDownIcon: IconComponent = (props) => (
  <Icon name="trending-down" {...props} />
);

/** Trending up icon. */
export const TrendingUpIcon: IconComponent = (props) => (
  <Icon name="trending-up" {...props} />
);

/** Truck / delivery icon. */
export const TruckIcon: IconComponent = (props) => (
  <Icon name="truck" {...props} />
);

/** Undo 2 icon. */
export const Undo2Icon: IconComponent = (props) => (
  <Icon name="undo-2" {...props} />
);

/** Unlock icon. */
export const UnlockIcon: IconComponent = (props) => (
  <Icon name="unlock" {...props} />
);

/** USB icon. */
export const UsbIcon: IconComponent = (props) => (
  <Icon name="usb" {...props} />
);

/** User / single person icon. */
export const UserIcon: IconComponent = (props) => (
  <Icon name="user" {...props} />
);

/** User circle icon. */
export const UserCircleIcon: IconComponent = (props) => (
  <Icon name="user-circle" {...props} />
);

/** User plus icon. */
export const UserPlusIcon: IconComponent = (props) => (
  <Icon name="user-plus" {...props} />
);

/** User x icon. */
export const UserXIcon: IconComponent = (props) => (
  <Icon name="user-x" {...props} />
);

/** Users / multiple people icon. */
export const UsersIcon: IconComponent = (props) => (
  <Icon name="users" {...props} />
);

/** Volume 2 / sound icon. */
export const Volume2Icon: IconComponent = (props) => (
  <Icon name="volume-2" {...props} />
);

/** Wifi / network icon. */
export const WifiIcon: IconComponent = (props) => (
  <Icon name="wifi" {...props} />
);

/** Wifi off / offline icon. */
export const WifiOffIcon: IconComponent = (props) => (
  <Icon name="wifi-off" {...props} />
);

/** X / close icon. */
export const XIcon: IconComponent = (props) => (
  <Icon name="x" {...props} />
);

/** X circle / error icon. */
export const XCircleIcon: IconComponent = (props) => (
  <Icon name="x-circle" {...props} />
);
