import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useTheme, alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import {
  CancelIcon,
  CheckCircleIcon,
  InfoIcon,
  WarningAmberIcon,
  XIcon,
} from "../icons/app-icons";
import type { AppIconComponent } from "../icons/app-icon-component";

/**
 * Sonner-style toast system: one <AppToaster /> mounted at the app root,
 * imperative `toast.success(...)` / `toast.error(...)` calls from anywhere.
 *
 * Motion follows the project tokens: enter 260ms ease-out-expo, exit faster
 * (160ms) so dismissal feels snappy. CSS transitions (not keyframes) keep
 * rapid-fire toasts interruptible mid-flight.
 */

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastOptions {
  /** Optional bold lead line above the message. */
  title?: string;
  /** Override the per-tone auto-dismiss window (ms). */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  tone: ToastTone;
  message: string;
}

const MAX_STACK = 4;

/** Per-tone auto-dismiss windows; problems stay visible longer. */
const TONE_DURATION: Record<ToastTone, number> = {
  success: 4500,
  info: 4500,
  warning: 6000,
  error: 8000,
};

const TONE_ICON: Record<ToastTone, AppIconComponent> = {
  success: CheckCircleIcon,
  error: CancelIcon,
  warning: WarningAmberIcon,
  info: InfoIcon,
};

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emitChange() {
  for (const listener of listeners) listener();
}

function push(tone: ToastTone, message: string, options?: ToastOptions): number {
  const id = nextId++;
  items = [...items.slice(-(MAX_STACK - 1)), { id, tone, message, ...options }];
  emitChange();
  return id;
}

function remove(id: number) {
  items = items.filter((item) => item.id !== id);
  emitChange();
}

/** Imperative toast API; safe to call outside React (mutations, services). */
export const toast = {
  success: (message: string, options?: ToastOptions) =>
    push("success", message, options),
  error: (message: string, options?: ToastOptions) =>
    push("error", message, options),
  warning: (message: string, options?: ToastOptions) =>
    push("warning", message, options),
  info: (message: string, options?: ToastOptions) =>
    push("info", message, options),
  dismiss: (id: number) => remove(id),
};

const EXIT_MS = 160;

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const isDark = theme.palette.mode === "dark";
  const [mounted, setMounted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Hover/focus pauses the countdown; hidden tabs do too.
  const [paused, setPaused] = useState(false);
  const [tabVisible, setTabVisible] = useState(() => !document.hidden);
  const duration = item.duration ?? TONE_DURATION[item.tone];
  const [remaining, setRemaining] = useState(duration);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const Icon = TONE_ICON[item.tone];
  // Problem states tint the icon chip and the card border; healthy states
  // stay quiet so risk pops out (same rule as KPI cards).
  const toneColor =
    item.tone === "success"
      ? theme.palette.success.main
      : item.tone === "error"
        ? theme.palette.error.main
        : item.tone === "warning"
          ? theme.palette.warning.main
          : theme.palette.info.main;

  const dismiss = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => onDismiss(item.id), EXIT_MS);
  }, [item.id, leaving, onDismiss]);

  useEffect(() => {
    // Flip after first paint so the CSS enter transition runs.
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onVisibility = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (leaving || paused || !tabVisible) return;
    const start = Date.now();
    const timer = window.setTimeout(dismiss, remaining);
    return () => {
      window.clearTimeout(timer);
      // Freeze what's left so hover/tab switches never shorten the window.
      setRemaining(Math.max(0, remaining - (Date.now() - start)));
    };
  }, [dismiss, leaving, paused, tabVisible, remaining]);

  // Swipe-to-dismiss: pointer capture keeps the drag alive when the cursor
  // leaves the card; a quick flick wins regardless of distance.
  const dragState = useRef({ startX: 0, startTime: 0, dragging: false });
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragState.current = {
      startX: event.clientX,
      startTime: Date.now(),
      dragging: true,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el || !dragState.current.dragging) return;
    const dx = event.clientX - dragState.current.startX;
    if (Math.abs(dx) <= 4) return;
    // Direct transform writes avoid re-rendering siblings during the drag.
    el.style.transform = `translateX(${dx}px)`;
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    dragState.current.dragging = false;
    if (!el) return;
    const dx = event.clientX - dragState.current.startX;
    const velocity =
      Math.abs(dx) / Math.max(1, Date.now() - dragState.current.startTime);
    if (Math.abs(dx) > 80 || velocity > 0.5) {
      dismiss();
    } else if (dx !== 0) {
      // Snap back; the CSS transition retargets from the current offset.
      el.style.transform = "";
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") dismiss();
  };

  return (
    <Paper
      ref={cardRef}
      className="toast-card"
      data-mounted={mounted}
      data-leaving={leaving}
      role={item.tone === "error" ? "alert" : "status"}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      sx={{
        width: "100%",
        maxWidth: 380,
        px: 1.5,
        py: 1.25,
        display: "flex",
        alignItems: "flex-start",
        gap: 1.25,
        borderRadius: 3,
        borderColor:
          item.tone === "success" || item.tone === "info"
            ? "divider"
            : alpha(toneColor, isDark ? 0.45 : 0.35),
        boxShadow: isDark
          ? "0 12px 32px rgba(2, 6, 23, 0.55)"
          : "0 12px 32px rgba(15, 23, 42, 0.16)",
        touchAction: "pan-y",
      }}
    >
      <Box
        aria-hidden
        display="flex"
        alignItems="center"
        justifyContent="center"
        sx={{
          width: 30,
          height: 30,
          borderRadius: 999,
          flexShrink: 0,
          mt: 0.25,
          color: toneColor,
          bgcolor: alpha(toneColor, isDark ? 0.18 : 0.11),
        }}
      >
        <Icon size={17} />
      </Box>
      <Box minWidth={0} flex={1}>
        {item.title ? (
          <Typography variant="body2" fontWeight={700} component="p" m={0}>
            {item.title}
          </Typography>
        ) : null}
        <Typography
          variant="body2"
          color={item.title ? "text.secondary" : "text.primary"}
          component="p"
          m={0}
          sx={{ overflowWrap: "anywhere" }}
        >
          {item.message}
        </Typography>
      </Box>
      <IconButton
        size="small"
        onClick={dismiss}
        aria-label={t("common.close")}
        sx={{
          mt: 0.125,
          ml: -0.5,
          color: "text.disabled",
          "&:hover": { color: "text.secondary" },
        }}
      >
        <XIcon size={14} />
      </IconButton>
    </Paper>
  );
}

/** Global toast viewport; mount once inside the ThemeProvider. */
export function AppToaster() {
  const { t } = useTranslation();
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <Box
      role="region"
      aria-label={t("common.notifications")}
      sx={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 1450,
        display: "flex",
        // Newest sits closest to the corner it enters from.
        flexDirection: "column-reverse",
        gap: 1,
        width: "calc(100vw - 32px)",
        maxWidth: 396,
        pointerEvents: "none",
        "& .toast-card": { pointerEvents: "auto" },
      }}
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={remove} />
      ))}
    </Box>
  );
}
