/**
 * Notification utility — typed wrappers around sileo toast notifications.
 *
 * Provides convenient domain‑specific methods that pre‑configure sileo
 * with the app's design‑system defaults (duration, styling) while exposing
 * the full sileo API for advanced use.
 *
 * Usage (from any context — thunks, hooks, event handlers):
 *   import { notify } from "@/utils/notify";
 *
 *   notify.success({ title: "Venta completada", description: "POS-00427" });
 *   notify.error({ title: "Error de sincronización" });
 *   notify.warning({ title: "Stock bajo", description: "Ibuprofeno 400mg (Stock: 3)" });
 *   notify.info({ title: "Sin conexión — operando offline" });
 *   notify.action({
 *     title: "Venta restringida",
 *     description: "Clonazepam 2mg — requiere verificación",
 *     action: { title: "Verificar", onClick: () => openDialog() },
 *   });
 *
 * To persist a toast:
 *   const id = notify.info({ title: "Sincronizando...", duration: null });
 *   // ... later ...
 *   notify.dismiss(id);
 */
import { sileo } from "sileo";
import type { SileoState } from "sileo";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotifyOptions {
  /** Headline — always required. */
  title: string;
  /** Supporting detail shown below the title. */
  description?: string;
  /**
   * Duration in milliseconds.
   *   default: 4000 (success/info), 6000 (warning), 8000 (error)
   *   Pass `null` to make the toast persistent (user must dismiss via swipe).
   */
  duration?: number | null;
  /**
   * Custom SVG icon to replace the default type icon.
   * Pass `null` to hide the icon entirely.
   */
  icon?: React.ReactNode | null;
}

export interface NotifyActionOptions extends NotifyOptions {
  action: {
    title: string;
    onClick: () => void;
  };
}

// ---------------------------------------------------------------------------
// Defaults (ms per type — null means persistent)
// ---------------------------------------------------------------------------

const DURATION: Record<SileoState, number | null> = {
  success: 4000,
  error: 8000,
  warning: 6000,
  info: 4000,
  loading: null,
  action: null,
};

// ---------------------------------------------------------------------------
// Notify object
// ---------------------------------------------------------------------------

function resolveDuration(
  explicit: number | null | undefined,
  type: SileoState,
): number | null {
  if (explicit !== undefined) return explicit;
  return DURATION[type];
}

export const notify = {
  /**
   * Sale confirmed, sync completed, shift closed successfully.
   * Maps to Pharma Teal (#0B6E6B).
   */
  success(options: NotifyOptions): string {
    return sileo.success({
      title: options.title,
      description: options.description,
      icon: options.icon,
      duration: resolveDuration(options.duration, "success"),
    });
  },

  /**
   * Shift discrepancy, print failure, sync conflict, critical error.
   * Maps to #D32F2F (error red — reserved accent).
   */
  error(options: NotifyOptions): string {
    return sileo.error({
      title: options.title,
      description: options.description,
      icon: options.icon,
      duration: resolveDuration(options.duration, "error"),
    });
  },

  /**
   * Low stock, near‑expiry lot, action required soon.
   * Maps to Urgency Amber (#E8780A).
   */
  warning(options: NotifyOptions): string {
    return sileo.warning({
      title: options.title,
      description: options.description,
      icon: options.icon,
      duration: resolveDuration(options.duration, "warning"),
    });
  },

  /**
   * Sync queue draining, offline mode active, informational status.
   * Maps to Sync Slate (#4A6572).
   */
  info(options: NotifyOptions): string {
    return sileo.info({
      title: options.title,
      description: options.description,
      icon: options.icon,
      duration: resolveDuration(options.duration, "info"),
    });
  },

  /**
   * Restricted‑sale confirmation, regulatory step needed.
   * Maps to Restrict Violet (#5B3E96).
   */
  action(options: NotifyActionOptions): string {
    return sileo.action({
      title: options.title,
      description: options.description,
      icon: options.icon,
      duration: resolveDuration(options.duration, "action"),
      button: {
        title: options.action.title,
        onClick: options.action.onClick,
      },
    });
  },

  /**
   * Low‑level sileo.show() for custom use cases.
   * Supports all sileo options including button and icon.
   */
  show(options: {
    title: string;
    description?: string;
    type?: SileoState;
    duration?: number | null;
    icon?: React.ReactNode;
    button?: {
      title: string;
      onClick: () => void;
    };
    fill?: string;
    roundness?: number;
  }): string {
    return sileo.show({
      title: options.title,
      description: options.description,
      type: options.type ?? "info",
      duration: resolveDuration(options.duration, options.type ?? "info"),
      icon: options.icon,
      button: options.button,
      fill: options.fill,
      roundness: options.roundness,
    });
  },

  /** Dismiss a toast by ID (useful for persistent toasts). */
  dismiss(id: string): void {
    sileo.dismiss(id);
  },
};
