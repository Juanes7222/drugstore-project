/**
 * Update-check strategy for the POS desktop.
 *
 * Determines *when* the POS should check for updates. Returns a config object
 * describing the appropriate trigger conditions. The actual check invocation
 * is handled by UpdateService; this module only answers the scheduling question.
 *
 * Triggers:
 * - On app start (after auth check completes)
 * - Every 6 hours (piggyback on sync scheduler)
 * - Manual (via command palette or "About" page)
 * - On network restore (after offline period)
 * - On wake from sleep
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckTrigger =
  | 'APP_START'
  | 'PERIODIC'
  | 'MANUAL'
  | 'NETWORK_RESTORE'
  | 'WAKE';

export interface CheckStrategyConfig {
  /** The trigger that caused this check. */
  trigger: CheckTrigger;

  /**
   * Minimum interval in milliseconds since the last check before another
   * automatic check is allowed. Set to 0 for MANUAL triggers (always allowed).
   */
  minIntervalMs: number;

  /**
   * Whether to show a user-facing notification if NO_UPDATE is returned.
   * Typically false for automatic checks, true for MANUAL.
   */
  notifyOnNoUpdate: boolean;

  /**
   * Whether to proceed with download automatically if an update is found.
   * true for APP_START and PERIODIC; configurable for MANUAL.
   */
  autoDownload: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Configuration per trigger type.
 * MANUAL always passes through; automatic triggers have a 6-hour cooldown.
 */
const TRIGGER_CONFIGS: Record<CheckTrigger, Omit<CheckStrategyConfig, 'trigger'>> = {
  APP_START: {
    minIntervalMs: SIX_HOURS_MS,
    notifyOnNoUpdate: false,
    autoDownload: true,
  },
  PERIODIC: {
    minIntervalMs: SIX_HOURS_MS,
    notifyOnNoUpdate: false,
    autoDownload: true,
  },
  MANUAL: {
    minIntervalMs: 0,
    notifyOnNoUpdate: true,
    autoDownload: false,
  },
  NETWORK_RESTORE: {
    minIntervalMs: SIX_HOURS_MS,
    notifyOnNoUpdate: false,
    autoDownload: true,
  },
  WAKE: {
    minIntervalMs: SIX_HOURS_MS,
    notifyOnNoUpdate: false,
    autoDownload: true,
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the check-strategy configuration for the given trigger.
 *
 * @param trigger - What prompted this check.
 * @returns A fully resolved CheckStrategyConfig for the trigger.
 */
export function getCheckStrategy(trigger: CheckTrigger): CheckStrategyConfig {
  const base = TRIGGER_CONFIGS[trigger];
  return { ...base, trigger };
}

/**
 * Return the minimum interval between automatic checks (6 hours).
 * Used by the UpdateService to decide whether to skip a scheduled check.
 */
export function getDefaultMinIntervalMs(): number {
  return SIX_HOURS_MS;
}
