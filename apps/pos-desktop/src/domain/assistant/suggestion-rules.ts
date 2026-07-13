/**
 * Suggestion rule definitions — pure, deterministic rules that evaluate
 * the current AppState and return suggestions when conditions are met.
 *
 * Each rule has a stable `id` used for dismiss persistence.
 * Rules are pure functions with no side effects.
 */

import type { SuggestionRule, AppState } from "./assistant-types";

/**
 * All suggestion rules, ordered by priority (CRITICAL first, then WARN, then INFO).
 * Within the same severity, rules are ordered logically.
 */
export const SUGGESTION_RULES: SuggestionRule[] = [
  // ======================================================================
  // CRITICAL severity
  // ======================================================================

  {
    id: "suggestion.critical.permanent-failures",
    title: "Errores permanentes de sincronización",
    description:
      "Hay entradas en estado PERMANENT_FAILURE. Contacta al manager para resolverlas.",
    severity: "CRITICAL",
    audience: "both",
    dismissable: false,
    condition: (state: AppState) => state.syncQueuePermanentFailure > 0,
    action: {
      label: "Ir a salud de sync",
      execute: async () => {
        const [{ store }, { navigateToSyncHealth }] = await Promise.all([
          import("../../renderer/store/store"),
          import("../../renderer/store/slices/ui-slice"),
        ]);
        store.dispatch(navigateToSyncHealth());
      },
    },
  },

  {
    id: "suggestion.critical.invoices-expiring",
    title: "Facturas de contingencia por expirar",
    description:
      "Tienes facturas de contingencia que expiran en menos de 24h. Revisa el panel fiscal.",
    severity: "CRITICAL",
    audience: "manager",
    dismissable: false,
    condition: (state: AppState) => state.invoicesExpiringWithin24h > 0,
    action: {
      label: "Ir a panel fiscal",
      execute: async () => {
        const { store } = await import("../../renderer/store/store");
        store.dispatch({
          type: "ui/setActiveScreen",
          payload: "fiscal",
        });
      },
    },
  },

  // ======================================================================
  // WARN severity
  // ======================================================================

  {
    id: "suggestion.warn.sync-stale",
    title: "Ventas pendientes de sincronizar",
    description:
      "Tienes ventas pendientes de sincronizar hace más de 1 hora. Revisa la conexión.",
    severity: "WARN",
    audience: "both",
    dismissable: true,
    cooldownMs: 300_000, // 5 minutes
    condition: (state: AppState) =>
      state.syncQueuePending > 0 && state.oldestPendingAgeMs > 3_600_000,
    action: {
      label: "Sincronizar ahora",
      execute: async () => {
        console.log("[Assistant] Sync now — requires service context");
      },
    },
  },

  {
    id: "suggestion.warn.shift-long-open",
    title: "Turno abierto por largo tiempo",
    description:
      "El turno actual lleva más de 8 horas abierto. Considera cerrarlo.",
    severity: "WARN",
    audience: "both",
    dismissable: true,
    cooldownMs: 600_000, // 10 minutes
    condition: (state: AppState) => state.currentShiftDurationHours > 8,
    action: {
      label: "Cerrar turno",
      execute: async () => {
        const { store } = await import("../../renderer/store/store");
        store.dispatch({
          type: "ui/setActiveScreen",
          payload: "cash-shift-close",
        });
      },
    },
  },

  // ======================================================================
  // INFO severity
  // ======================================================================

  {
    id: "suggestion.info.sync-pending",
    title: "Sincronización en curso",
    description:
      "Hay operaciones pendientes de sincronizar. Los datos se enviarán automáticamente.",
    severity: "INFO",
    audience: "both",
    dismissable: true,
    cooldownMs: 120_000, // 2 minutes
    condition: (state: AppState) => state.isSyncing,
    action: {
      label: "Ver progreso",
      execute: async () => {
        const [{ store }, { navigateToSyncHealth }] = await Promise.all([
          import("../../renderer/store/store"),
          import("../../renderer/store/slices/ui-slice"),
        ]);
        store.dispatch(navigateToSyncHealth());
      },
    },
  },

  {
    id: "suggestion.info.reprint-receipt",
    title: "Reimprimir factura",
    description:
      "La última venta se confirmó correctamente. Puedes reimprimir la factura si es necesario.",
    severity: "INFO",
    audience: "cashier",
    dismissable: true,
    condition: (state: AppState) => state.lastConfirmedSaleId !== null,
    action: {
      label: "Reimprimir factura",
      execute: () => {
        console.log("[Assistant] Reprint last receipt");
      },
    },
  },

  {
    id: "suggestion.info.expiring-lot",
    title: "Lote próximo a vencer",
    description:
      "El producto en la venta actual tiene un lote que vence pronto. Verifica la fecha.",
    severity: "INFO",
    audience: "cashier",
    dismissable: true,
    condition: (_state: AppState) => {
      // Placeholder — real logic checks FEFO lots of current sale items
      return false; // Disabled until FEFO integration is added
    },
    action: {
      label: "Ver lotes",
      execute: () => {
        // Navigate to lot view
      },
    },
  },

  {
    id: "suggestion.info.client-prescriptions",
    title: "Cliente con prescripciones",
    description:
      "El cliente seleccionado tiene prescripciones registradas. Revísalas antes de la venta.",
    severity: "INFO",
    audience: "cashier",
    dismissable: true,
    condition: (state: AppState) => state.currentClientId !== null,
    action: {
      label: "Ver prescripciones",
      execute: async () => {
        const [{ store }, { navigateToPrescriptions }] = await Promise.all([
          import("../../renderer/store/store"),
          import("../../renderer/store/slices/ui-slice"),
        ]);
        store.dispatch(navigateToPrescriptions());
      },
    },
  },

  {
    id: "suggestion.info.connection-restored",
    title: "Conexión restaurada",
    description:
      "La conexión con el servidor se ha restablecido. Los datos pendientes se sincronizarán.",
    severity: "INFO",
    audience: "both",
    dismissable: true,
    condition: (state: AppState) =>
      state.isOnline && state.syncQueuePending > 0,
    action: {
      label: "Sincronizar ahora",
      execute: async () => {
        console.log("[Assistant] Sync now — requires service context");
      },
    },
  },
];

/**
 * Evaluate all rules against the current app state.
 * Returns active suggestions sorted by severity (CRITICAL first).
 * Catches and logs individual rule errors so a single bad rule
 * doesn't break the entire suggestion system.
 */
export function evaluateRules(
  state: AppState,
  dismissedIds: string[],
): Array<{
  rule: SuggestionRule;
  severity: "CRITICAL" | "WARN" | "INFO";
}> {
  const results: Array<{
    rule: SuggestionRule;
    severity: "CRITICAL" | "WARN" | "INFO";
  }> = [];

  for (const rule of SUGGESTION_RULES) {
    try {
      // Skip if dismissed
      if (dismissedIds.includes(rule.id)) continue;

      // Check audience match (simplified — actual check in suggestion engine)
      if (rule.condition(state)) {
        results.push({ rule, severity: rule.severity });
      }
    } catch (err) {
      console.error(`[SuggestionRules] Rule "${rule.id}" threw:`, err);
      // Continue evaluating other rules
    }
  }

  // Sort: CRITICAL first, then WARN, then INFO
  const severityOrder: Record<string, number> = {
    CRITICAL: 0,
    WARN: 1,
    INFO: 2,
  };

  results.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );

  return results;
}
