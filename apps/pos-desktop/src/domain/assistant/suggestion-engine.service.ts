/**
 * Contextual suggestion engine — evaluates rule-based conditions against
 * the current application state and surfaces actionable suggestions.
 *
 * ## Design
 * - Rules are pure functions (defined in suggestion-rules.ts)
 * - Evaluation is triggered by state changes and a periodic timer
 * - Debounced to prevent flooding during rapid state changes
 *
 * ## Usage
 * ```ts
 * const engine = createSuggestionEngine();
 * engine.onSuggestionsChange((suggestions) => { ... });
 * engine.evaluate(currentAppState);  // manual trigger
 * engine.startPeriodicEvaluation(60_000);  // every minute
 * engine.dispose();
 * ```
 */

import type { AppState, ActiveSuggestion } from "./assistant-types";
import { evaluateRules } from "./suggestion-rules";
import { useUserPreferencesStore } from "../../stores/user-preferences.store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Debounce delay for state-change triggered evaluations. */
export const EVALUATION_DEBOUNCE_MS = 300;

/** Default periodic evaluation interval (ms). */
export const PERIODIC_EVALUATION_INTERVAL_MS = 60_000;

/** Maximum number of suggestions visible at once. */
export const MAX_VISIBLE_SUGGESTIONS = 3;

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface SuggestionEngine {
  /** Evaluate current state and emit suggestions. */
  evaluate(state: AppState): ActiveSuggestion[];

  /** Register a callback for suggestion changes. */
  onSuggestionsChange(
    cb: (suggestions: ActiveSuggestion[]) => void,
  ): () => void;

  /** Start a periodic evaluation timer. */
  startPeriodicEvaluation(intervalMs?: number): void;

  /** Stop the periodic evaluation timer. */
  stopPeriodicEvaluation(): void;

  /** Dismiss a suggestion by rule ID. */
  dismiss(ruleId: string): void;

  /** Check if a suggestion is currently visible (not dismissed). */
  isSuggestionActive(ruleId: string): boolean;

  /** Clean up all listeners and timers. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSuggestionEngine = (): SuggestionEngine => {
  return new SuggestionEngineImpl();
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SuggestionEngineImpl implements SuggestionEngine {
  private listeners: Array<(suggestions: ActiveSuggestion[]) => void> = [];
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private lastDismissals: Record<string, number> = {};
  private currentState: AppState | null = null;

  /**
   * Evaluate the current app state against all rules.
   * Returns an array of active suggestions.
   */
  evaluate(state: AppState): ActiveSuggestion[] {
    this.currentState = state;

    const dismissedIds = useUserPreferencesStore.getState().dismissedSuggestions;

    const ruleResults = evaluateRules(state, dismissedIds);

    const active: ActiveSuggestion[] = [];

    for (const { rule } of ruleResults) {
      // Apply cooldown check
      if (rule.cooldownMs) {
        const lastDismiss = this.lastDismissals[rule.id];
        if (lastDismiss && Date.now() - lastDismiss < rule.cooldownMs) {
          continue;
        }
      }

      active.push({
        ruleId: rule.id,
        title: rule.title,
        description: rule.description,
        severity: rule.severity,
        dismissable: rule.dismissable,
        action: rule.action,
      });
    }

    // Notify listeners
    this.notifyListeners(active);

    return active;
  }

  onSuggestionsChange(
    cb: (suggestions: ActiveSuggestion[]) => void,
  ): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  startPeriodicEvaluation(intervalMs = PERIODIC_EVALUATION_INTERVAL_MS): void {
    this.stopPeriodicEvaluation();
    this.periodicTimer = setInterval(() => {
      if (this.currentState) {
        this.evaluate(this.currentState);
      }
    }, intervalMs);
  }

  stopPeriodicEvaluation(): void {
    if (this.periodicTimer !== null) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  dismiss(ruleId: string): void {
    this.lastDismissals[ruleId] = Date.now();
    useUserPreferencesStore.getState().dismissSuggestion(ruleId);

    // Re-evaluate with current state
    if (this.currentState) {
      this.evaluate(this.currentState);
    }
  }

  isSuggestionActive(ruleId: string): boolean {
    return !useUserPreferencesStore
      .getState()
      .dismissedSuggestions.includes(ruleId);
  }

  dispose(): void {
    this.stopPeriodicEvaluation();
    this.listeners = [];
    this.currentState = null;
  }

  private notifyListeners(suggestions: ActiveSuggestion[]): void {
    for (const cb of this.listeners) {
      try {
        cb(suggestions);
      } catch (err) {
        console.error("[SuggestionEngine] Listener threw:", err);
      }
    }
  }
}
