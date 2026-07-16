/**
 * Command registry — static list of all palette commands.
 *
 * Each command defines its id, label, group, audience, and an execute
 * function that wraps the existing service method. Commands are filtered
 * by the current user's role before being surfaced in the palette.
 */

import type { CommandDefinition } from "./assistant-types";

/**
 * All available palette commands.
 *
 * These are loaded once at module-init time. The `execute` functions
 * use dynamic imports so the services are not loaded until the command
 * is actually invoked (tree-shaking friendly).
 */
export const COMMANDS: CommandDefinition[] = [
  // ---- Sales ----
  {
    id: "cmd.new-sale",
    label: "Nueva venta",
    group: "Ventas",
    shortcut: "Cmd+N",
    audience: "both",
    action: "NAVIGATE",
    actionPayload: "sales",
    execute: async () => {
      const [{ store }, { resetSaleFlow, navigateBackToSales }] = await Promise.all([
        import("../../renderer/store/store"),
        import("../../renderer/store/slices/ui-slice"),
      ]);
      store.dispatch(resetSaleFlow());
      store.dispatch(navigateBackToSales());
    },
  },
  {
    id: "cmd.start-return-last-sale",
    label: "Devolver última venta",
    group: "Ventas",
    audience: "manager",
    action: "START_RETURN",
    execute: async () => {
      const [{ store }, { navigateToReturns }] = await Promise.all([
        import("../../renderer/store/store"),
        import("../../renderer/store/slices/ui-slice"),
      ]);
      store.dispatch(navigateToReturns());
    },
  },
  {
    id: "cmd.reprint-last-receipt",
    label: "Reimprimir última factura",
    group: "Ventas",
    shortcut: "Cmd+Shift+P",
    audience: "cashier",
    action: "REPRINT_RECEIPT",
    execute: async () => {
      // Dispatched to print router; actual impl in printing module
      console.log("[Assistant] Reprint last receipt requested");
    },
  },

  // ---- Turno / Shift ----
  {
    id: "cmd.close-shift",
    label: "Cerrar turno",
    group: "Turno",
    audience: "manager",
    action: "RUN_COMMAND",
    execute: async () => {
      const { store } = await import("../../renderer/store/store");
      store.dispatch({ type: "ui/setActiveScreen", payload: "cash-shift-close" });
    },
  },

  // ---- Sync ----
  {
    id: "cmd.sync-now",
    label: "Sincronizar ahora",
    group: "Sincronización",
    shortcut: "Cmd+Shift+S",
    audience: "both",
    action: "SYNC_NOW",
    execute: async () => {
      console.log("[Assistant] Sync now triggered — requires service context");
    },
  },
  {
    id: "cmd.open-sync-health",
    label: "Ir a salud de sincronización",
    group: "Sincronización",
    audience: "manager",
    action: "NAVIGATE",
    actionPayload: "sync-health",
    execute: async () => {
      const [{ store }, { navigateToSyncHealth }] = await Promise.all([
        import("../../renderer/store/store"),
        import("../../renderer/store/slices/ui-slice"),
      ]);
      store.dispatch(navigateToSyncHealth());
    },
  },
  {
    id: "cmd.test-connection",
    label: "Probar conexión con servidor",
    group: "Sincronización",
    audience: "manager",
    action: "RUN_COMMAND",
    execute: async () => {
      const { isOnline } = await import("../../common/is-online");
      const online = isOnline();
      if (online) {
        const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
        try {
          const res = await fetch(`${baseUrl}/health`);
          const data = await res.json();
          console.log("[Assistant] Server connection OK:", data);
        } catch {
          console.warn("[Assistant] Server unreachable despite online status");
        }
      } else {
        console.warn("[Assistant] No network connection");
      }
    },
  },

  // ---- Navigation ----
  {
    id: "cmd.open-returns",
    label: "Ir a devoluciones",
    group: "Navegación",
    audience: "both",
    action: "NAVIGATE",
    actionPayload: "returns",
    execute: async () => {
      const [{ store }, { navigateToReturns }] = await Promise.all([
        import("../../renderer/store/store"),
        import("../../renderer/store/slices/ui-slice"),
      ]);
      store.dispatch(navigateToReturns());
    },
  },
  {
    id: "cmd.open-adjustments",
    label: "Ir a ajustes de inventario",
    group: "Navegación",
    audience: "manager",
    action: "NAVIGATE",
    actionPayload: "inventory-adjustments",
    execute: async () => {
      const [{ store }, { navigateToInventoryAdjustments }] = await Promise.all([
        import("../../renderer/store/store"),
        import("../../renderer/store/slices/ui-slice"),
      ]);
      store.dispatch(navigateToInventoryAdjustments());
    },
  },
  {
    id: "cmd.open-fiscal",
    label: "Ir a panel fiscal",
    group: "Navegación",
    audience: "manager",
    action: "NAVIGATE",
    actionPayload: "fiscal",
    execute: async () => {
      const { store } = await import("../../renderer/store/store");
      store.dispatch({ type: "ui/setActiveScreen", payload: "fiscal" });
    },
  },
  {
    id: "cmd.open-admin-menu",
    label: "Ir a menú de administración",
    group: "Navegación",
    audience: "manager",
    action: "NAVIGATE",
    actionPayload: "admin-menu",
    execute: async () => {
      const [{ store }, { navigateToAdminMenu }] = await Promise.all([
        import("../../renderer/store/store"),
        import("../../renderer/store/slices/ui-slice"),
      ]);
      store.dispatch(navigateToAdminMenu());
    },
  },
  {
    id: "cmd.open-recovery",
    label: "Ir a recuperación",
    group: "Navegación",
    audience: "manager",
    action: "NAVIGATE",
    actionPayload: "recovery",
    execute: async () => {
      const [{ store }, { navigateToRecovery }] = await Promise.all([
        import("../../renderer/store/store"),
        import("../../renderer/store/slices/ui-slice"),
      ]);
      store.dispatch(navigateToRecovery());
    },
  },

  // ---- Help & Shortcuts ----
  {
    id: "cmd.show-shortcuts",
    label: "Ver atajos de teclado",
    group: "Ayuda",
    shortcut: "?",
    audience: "both",
    action: "SHOW_SHORTCUTS",
    execute: async () => {
      // Handled by the shortcut manager overlay
    },
  },
  {
    id: "cmd.show-help",
    label: "Abrir ayuda",
    group: "Ayuda",
    shortcut: "F1",
    audience: "both",
    action: "SHOW_HELP_INDEX",
    execute: async () => {
      // Handled by the help viewer overlay
    },
  },
  {
    id: "cmd.open-preferences",
    label: "Abrir preferencias",
    group: "Ayuda",
    audience: "manager",
    action: "OPEN_PREFERENCES",
    execute: async () => {
      // Palette handled via overlay
    },
  },

  // ---- Offline / Auth ----
  {
    id: "cmd.view-offline-sessions",
    label: "Ver sesiones offline",
    group: "Sesiones",
    audience: "manager",
    action: "NAVIGATE",
    actionPayload: "offline-sessions",
    execute: async () => {
      const { store } = await import("../../renderer/store/store");
      store.dispatch({
        type: "ui/setActiveScreen",
        payload: "offline-sessions",
      });
    },
  },
  {
    id: "cmd.revalidate-sessions",
    label: "Revalidar sesiones pendientes",
    group: "Sesiones",
    audience: "manager",
    action: "RUN_COMMAND",
    execute: async () => {
      // The re-evaluation is handled by the useOfflineAuth hook.
      // Dispatched via the suggestion engine or manual trigger.
      console.log("[Assistant] Revalidate offline sessions requested");
    },
  },
  {
    id: "cmd.clear-offline-cache",
    label: "Limpiar cache offline",
    group: "Sesiones",
    audience: "manager",
    action: "RUN_COMMAND",
    execute: async () => {
      const { store } = await import("../../renderer/store/store");
      // Dispatch an action to clear credential cache
      store.dispatch({
        type: "ui/setActiveScreen",
        payload: "offline-sessions",
      });
      console.log("[Assistant] Clear offline cache requested");
    },
  },

  // ---- Backup / Recovery ----
  {
    id: "cmd.create-backup",
    label: "Crear backup ahora",
    group: "Respaldo",
    audience: "manager",
    action: "CREATE_BACKUP",
    execute: async () => {
      console.log("[Assistant] Create backup triggered — requires service context");
    },
  },
  {
    id: "cmd.restore-backup",
    label: "Restaurar desde backup",
    group: "Respaldo",
    audience: "manager",
    action: "RESTORE_BACKUP",
    execute: async () => {
      console.log("[Assistant] Restore backup triggered — requires service context");
    },
  },

  // ---- Fiscal ----
  {
    id: "cmd.export-invoice-csv",
    label: "Exportar CSV de facturas",
    group: "Fiscal",
    audience: "manager",
    action: "EXPORT_CSV",
    execute: async () => {
      console.log("[Assistant] Export invoice CSV requested");
    },
  },
  {
    id: "cmd.view-expiring-invoices",
    label: "Ver facturas por expirar",
    group: "Fiscal",
    audience: "manager",
    action: "NAVIGATE",
    actionPayload: "fiscal",
    execute: async () => {
      const { store } = await import("../../renderer/store/store");
      store.dispatch({ type: "ui/setActiveScreen", payload: "fiscal" });
    },
  },
];

/**
 * Get commands filtered by the user's role.
 * CASHIER role sees commands with audience "cashier" or "both".
 * MANAGER role sees all commands.
 */
export function getCommandsForRole(role: string | null): CommandDefinition[] {
  if (!role) {
    return COMMANDS.filter((c) => c.audience !== "manager");
  }

  const roleUpper = role.toUpperCase();

  // Managers see everything
  if (
    roleUpper === "MANAGER" ||
    roleUpper === "ADMIN" ||
    roleUpper === "OWNER" ||
    roleUpper === "SAAS_ADMIN"
  ) {
    return COMMANDS;
  }

  // Cashiers see cashier + both commands
  return COMMANDS.filter(
    (c) => c.audience === "cashier" || c.audience === "both",
  );
}
