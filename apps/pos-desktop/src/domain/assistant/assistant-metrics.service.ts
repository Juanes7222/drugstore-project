/**
 * Assistant metrics — local-only analytics tracking for the productivity layer.
 *
 * Tracks palette opens, queries, suggestion interactions, help views, and
 * shortcut usage. All data stays local (not synced to server). PII is
 * stripped before storage; query text is kept for 7 days then dropped.
 *
 * ## Data retention
 * - Raw query text: 7 days
 * - Daily aggregates: kept permanently (no PII)
 * - Individual events (opens, suggestions, help views): kept for 30 days
 */

import type {
  DailyMetrics,
  PaletteOpenEvent,
  PaletteQueryEvent,
  SuggestionEvent,
  HelpViewEvent,
} from "./assistant-types";
import { useUserPreferencesStore } from "../../stores/user-preferences.store";
import { MetricsPersistenceException } from "./exceptions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY_EVENTS = "pos-assistant-metrics-events";
const STORAGE_KEY_DAILY = "pos-assistant-metrics-daily";
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const QUERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoredEvents {
  paletteOpens: PaletteOpenEvent[];
  queries: PaletteQueryEvent[];
  suggestions: SuggestionEvent[];
  helpViews: HelpViewEvent[];
  lastCleanup: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface AssistantMetricsService {
  /** Record a palette open event. */
  recordPaletteOpen(userId: string): void;

  /** Record a palette query. */
  recordQuery(
    query: string,
    resultCount: number,
    selectedCategory: string | null,
  ): void;

  /** Record a suggestion event (shown, dismissed, clicked). */
  recordSuggestionEvent(
    ruleId: string,
    action: "shown" | "dismissed" | "clicked",
  ): void;

  /** Record a help topic view. */
  recordHelpView(topicId: string): void;

  /** Record a shortcut usage. */
  recordShortcutUsage(): void;

  /** Get daily aggregated metrics for the last N days. */
  getDailyMetrics(days?: number): Promise<DailyMetrics[]>;

  /**
   * Get assistant usage summary (for manager dashboard).
   * All values are counts and percentages — no PII.
   */
  getAssistantUsageSummary(): Promise<{
    totalPaletteOpens: number;
    totalQueries: number;
    topCategories: Array<{ category: string; count: number }>;
    topSuggestionsShown: Array<{ ruleId: string; count: number }>;
    totalHelpViews: number;
    paletteVsShortcuts: { palette: number; shortcuts: number };
  }>;

  /** Run cleanup: remove old query text and expired events. */
  runCleanup(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createAssistantMetricsService = (): AssistantMetricsService => {
  return new AssistantMetricsServiceImpl();
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class AssistantMetricsServiceImpl implements AssistantMetricsService {
  private events: StoredEvents;

  constructor() {
    this.events = this.loadEvents();
  }

  recordPaletteOpen(userId: string): void {
    const openEvent: PaletteOpenEvent = {
      timestamp: Date.now(),
      userId,
    };
    this.events.paletteOpens.push(openEvent);
    this.saveEvents();
  }

  recordQuery(
    query: string,
    resultCount: number,
    selectedCategory: string | null,
  ): void {
    const queryEvent: PaletteQueryEvent = {
      timestamp: Date.now(),
      query,
      resultCount,
      selectedCategory: selectedCategory as PaletteQueryEvent["selectedCategory"],
    };
    this.events.queries.push(queryEvent);
    this.saveEvents();
  }

  recordSuggestionEvent(
    ruleId: string,
    action: "shown" | "dismissed" | "clicked",
  ): void {
    const event: SuggestionEvent = {
      timestamp: Date.now(),
      ruleId,
      action,
    };
    this.events.suggestions.push(event);
    this.saveEvents();
  }

  recordHelpView(topicId: string): void {
    const event: HelpViewEvent = {
      timestamp: Date.now(),
      topicId,
    };
    this.events.helpViews.push(event);
    this.saveEvents();
  }

  recordShortcutUsage(): void {
    // Incremented via user preferences store
    useUserPreferencesStore.getState().incrementShortcutUsage();
  }

  async getDailyMetrics(days = 30): Promise<DailyMetrics[]> {
    const now = Date.now();
    const startDate = new Date(now - days * 24 * 60 * 60 * 1000);

    const dailyMap = new Map<string, DailyMetrics>();

    // Initialize all days in range
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const dateKey = d.toISOString().slice(0, 10);
      dailyMap.set(dateKey, this.createEmptyDaily(dateKey));
    }

    // Process palette opens
    for (const event of this.events.paletteOpens) {
      const dateKey = new Date(event.timestamp).toISOString().slice(0, 10);
      const daily = dailyMap.get(dateKey);
      if (daily) daily.paletteOpens++;
    }

    // Process queries (strip PII for aggregation)
    for (const event of this.events.queries) {
      const dateKey = new Date(event.timestamp).toISOString().slice(0, 10);
      const daily = dailyMap.get(dateKey);
      if (daily) {
        daily.queriesEntered++;
        if (event.selectedCategory) {
          daily.resultsByCategory[event.selectedCategory] =
            (daily.resultsByCategory[event.selectedCategory] ?? 0) + 1;
        }
      }
    }

    // Process suggestion events
    for (const event of this.events.suggestions) {
      const dateKey = new Date(event.timestamp).toISOString().slice(0, 10);
      const daily = dailyMap.get(dateKey);
      if (daily) {
        if (event.action === "shown") {
          daily.suggestionsShown[event.ruleId] =
            (daily.suggestionsShown[event.ruleId] ?? 0) + 1;
        } else if (event.action === "dismissed") {
          daily.suggestionsDismissed[event.ruleId] =
            (daily.suggestionsDismissed[event.ruleId] ?? 0) + 1;
        } else if (event.action === "clicked") {
          daily.suggestionsClicked[event.ruleId] =
            (daily.suggestionsClicked[event.ruleId] ?? 0) + 1;
        }
      }
    }

    // Process help views
    for (const event of this.events.helpViews) {
      const dateKey = new Date(event.timestamp).toISOString().slice(0, 10);
      const daily = dailyMap.get(dateKey);
      if (daily) {
        daily.helpTopicsViewed[event.topicId] =
          (daily.helpTopicsViewed[event.topicId] ?? 0) + 1;
      }
    }

    const result = Array.from(dailyMap.values()).sort(
      (a, b) => a.date.localeCompare(b.date),
    );

    // Merge with any persisted daily aggregates
    try {
      const storedDaily = localStorage.getItem(STORAGE_KEY_DAILY);
      if (storedDaily) {
        const persisted: DailyMetrics[] = JSON.parse(storedDaily);
        for (const persistedDay of persisted) {
          const existing = result.find((r) => r.date === persistedDay.date);
          if (existing) {
            // Merge counts
            existing.paletteOpens += persistedDay.paletteOpens;
            existing.queriesEntered += persistedDay.queriesEntered;
            // Merge category counts
            for (const [cat, count] of Object.entries(
              persistedDay.resultsByCategory,
            )) {
              existing.resultsByCategory[cat] =
                (existing.resultsByCategory[cat] ?? 0) + count;
            }
          }
        }
      }
    } catch {
      // Ignore — persisted data may be corrupt
    }

    return result;
  }

  async getAssistantUsageSummary(): Promise<{
    totalPaletteOpens: number;
    totalQueries: number;
    topCategories: Array<{ category: string; count: number }>;
    topSuggestionsShown: Array<{ ruleId: string; count: number }>;
    totalHelpViews: number;
    paletteVsShortcuts: { palette: number; shortcuts: number };
  }> {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const recentQueries = this.events.queries.filter(
      (q) => q.timestamp >= thirtyDaysAgo,
    );
    const recentSuggestions = this.events.suggestions.filter(
      (s) => s.timestamp >= thirtyDaysAgo,
    );

    // Top categories
    const categoryCount: Record<string, number> = {};
    for (const q of recentQueries) {
      if (q.selectedCategory) {
        categoryCount[q.selectedCategory] =
          (categoryCount[q.selectedCategory] ?? 0) + 1;
      }
    }
    const topCategories = Object.entries(categoryCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    // Top suggestions shown
    const suggestionCount: Record<string, number> = {};
    for (const s of recentSuggestions) {
      if (s.action === "shown") {
        suggestionCount[s.ruleId] = (suggestionCount[s.ruleId] ?? 0) + 1;
      }
    }
    const topSuggestionsShown = Object.entries(suggestionCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([ruleId, count]) => ({ ruleId, count }));

    // Read palette vs shortcut counts from preferences store
    const prefs = useUserPreferencesStore.getState();

    return {
      totalPaletteOpens: this.events.paletteOpens.length,
      totalQueries: this.events.queries.length,
      topCategories,
      topSuggestionsShown,
      totalHelpViews: this.events.helpViews.length,
      paletteVsShortcuts: {
        palette: prefs.paletteUsageCount,
        shortcuts: prefs.shortcutUsageCount,
      },
    };
  }

  runCleanup(): void {
    const now = Date.now();
    const queryCutoff = now - QUERY_RETENTION_MS;
    const eventCutoff = now - EVENT_RETENTION_MS;

    // Remove old query text (keep the events, just strip query)
    this.events.queries = this.events.queries.map((q) => ({
      ...q,
      query: q.timestamp < queryCutoff ? "" : q.query,
    }));

    // Remove old events entirely
    this.events.paletteOpens = this.events.paletteOpens.filter(
      (e) => e.timestamp >= eventCutoff,
    );
    this.events.helpViews = this.events.helpViews.filter(
      (e) => e.timestamp >= eventCutoff,
    );
    this.events.suggestions = this.events.suggestions.filter(
      (e) => e.timestamp >= eventCutoff,
    );

    this.saveEvents();
  }

  private createEmptyDaily(date: string): DailyMetrics {
    return {
      date,
      paletteOpens: 0,
      queriesEntered: 0,
      resultsByCategory: {},
      suggestionsShown: {},
      suggestionsDismissed: {},
      suggestionsClicked: {},
      helpTopicsViewed: {},
      shortcutsUsed: 0,
      paletteUsage: 0,
    };
  }

  private loadEvents(): StoredEvents {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EVENTS);
      if (raw) {
        return JSON.parse(raw) as StoredEvents;
      }
    } catch {
      // Corrupt data — start fresh
    }

    return {
      paletteOpens: [],
      queries: [],
      suggestions: [],
      helpViews: [],
      lastCleanup: Date.now(),
    };
  }

  private saveEvents(): void {
    try {
      localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(this.events));
    } catch (err) {
      throw new MetricsPersistenceException(
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
