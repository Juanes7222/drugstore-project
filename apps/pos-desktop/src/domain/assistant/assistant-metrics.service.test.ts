/**
 * Tests for the assistant metrics service.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createAssistantMetricsService,
  type AssistantMetricsService,
} from "./assistant-metrics.service";
import { useUserPreferencesStore } from "../../stores/user-preferences.store";

describe("AssistantMetricsService", () => {
  let metrics: AssistantMetricsService;

  beforeEach(() => {
    window.localStorage.clear();
    useUserPreferencesStore.setState({
      dismissedSuggestions: [],
      dismissalCounts: {},
      customShortcuts: {},
      paletteRecentItems: [],
      helpViewedPages: {},
      formMemoryOptOuts: [],
      paletteUsageCount: 0,
      shortcutUsageCount: 0,
    });
    metrics = createAssistantMetricsService();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("recordPaletteOpen", () => {
    it("records a palette open event", async () => {
      metrics.recordPaletteOpen("user-123");

      const daily = await metrics.getDailyMetrics(1);
      expect(daily[0].paletteOpens).toBe(1);
    });

    it("records multiple opens on the same day", async () => {
      metrics.recordPaletteOpen("user-1");
      metrics.recordPaletteOpen("user-1");
      metrics.recordPaletteOpen("user-1");

      const daily = await metrics.getDailyMetrics(1);
      expect(daily[0].paletteOpens).toBe(3);
    });
  });

  describe("recordQuery", () => {
    it("records a query with result count", async () => {
      metrics.recordQuery("acetaminofén", 5, "PRODUCT");

      const daily = await metrics.getDailyMetrics(1);
      expect(daily[0].queriesEntered).toBe(1);
      expect(daily[0].resultsByCategory["PRODUCT"]).toBe(1);
    });

    it("records queries with no selected category", async () => {
      metrics.recordQuery("test", 0, null);

      const daily = await metrics.getDailyMetrics(1);
      expect(daily[0].queriesEntered).toBe(1);
    });

    it("aggregates multiple queries by category", async () => {
      metrics.recordQuery("producto", 3, "PRODUCT");
      metrics.recordQuery("cliente", 2, "CLIENT");
      metrics.recordQuery("otro", 1, "PRODUCT");

      const daily = await metrics.getDailyMetrics(1);
      expect(daily[0].resultsByCategory["PRODUCT"]).toBe(2);
      expect(daily[0].resultsByCategory["CLIENT"]).toBe(1);
    });
  });

  describe("recordSuggestionEvent", () => {
    it("records a suggestion shown event", async () => {
      metrics.recordSuggestionEvent("suggestion.warn.sync-stale", "shown");

      const daily = await metrics.getDailyMetrics(1);
      expect(daily[0].suggestionsShown["suggestion.warn.sync-stale"]).toBe(1);
    });

    it("records suggestion dismissed and clicked", async () => {
      metrics.recordSuggestionEvent("rule-1", "dismissed");
      metrics.recordSuggestionEvent("rule-1", "clicked");

      const daily = await metrics.getDailyMetrics(1);
      expect(daily[0].suggestionsDismissed["rule-1"]).toBe(1);
      expect(daily[0].suggestionsClicked["rule-1"]).toBe(1);
    });
  });

  describe("recordHelpView", () => {
    it("records a help topic view", async () => {
      metrics.recordHelpView("topic-how-to-sell");

      const daily = await metrics.getDailyMetrics(1);
      expect(daily[0].helpTopicsViewed["topic-how-to-sell"]).toBe(1);
    });
  });

  describe("recordShortcutUsage", () => {
    it("increments shortcut usage in the preferences store", () => {
      metrics.recordShortcutUsage();

      expect(useUserPreferencesStore.getState().shortcutUsageCount).toBe(1);
    });

    it("increments multiple times", () => {
      metrics.recordShortcutUsage();
      metrics.recordShortcutUsage();
      metrics.recordShortcutUsage();

      expect(useUserPreferencesStore.getState().shortcutUsageCount).toBe(3);
    });
  });

  describe("getAssistantUsageSummary", () => {
    it("returns zeros for a fresh metrics service", async () => {
      const summary = await metrics.getAssistantUsageSummary();

      expect(summary.totalPaletteOpens).toBe(0);
      expect(summary.totalQueries).toBe(0);
      expect(summary.totalHelpViews).toBe(0);
      expect(summary.topCategories).toEqual([]);
      expect(summary.topSuggestionsShown).toEqual([]);
      expect(summary.paletteVsShortcuts).toEqual({ palette: 0, shortcuts: 0 });
    });

    it("aggregates event counts over the last 30 days", async () => {
      metrics.recordPaletteOpen("user-1");
      metrics.recordQuery("test", 1, "PAGE");
      metrics.recordSuggestionEvent("rule-1", "shown");
      metrics.recordHelpView("topic-1");

      const summary = await metrics.getAssistantUsageSummary();
      expect(summary.totalPaletteOpens).toBe(1);
      expect(summary.totalQueries).toBe(1);
      expect(summary.totalHelpViews).toBe(1);
      expect(summary.topSuggestionsShown).toHaveLength(1);
    });
  });

  describe("runCleanup", () => {
    it("removes old events beyond the retention period", async () => {
      // Record an event far in the past
      metrics.recordPaletteOpen("user-1");

      // Manually set timestamp to 40 days ago
      const oldEvents = JSON.stringify({
        paletteOpens: [{ timestamp: Date.now() - 40 * 24 * 60 * 60 * 1000, userId: "old" }],
        queries: [],
        suggestions: [],
        helpViews: [],
        lastCleanup: Date.now(),
      });
      window.localStorage.setItem("pos-assistant-metrics-events", oldEvents);

      // Create a new service to load the old events
      const metrics2 = createAssistantMetricsService();
      metrics2.runCleanup();

      const summary = await metrics2.getAssistantUsageSummary();
      expect(summary.totalPaletteOpens).toBe(0);
    });

    it("strips query text older than 7 days", () => {
      const now = Date.now();
      const oldEvents = JSON.stringify({
        paletteOpens: [],
        queries: [
          { timestamp: now - 10 * 24 * 60 * 60 * 1000, query: "sensitive-data", resultCount: 3, selectedCategory: null },
        ],
        suggestions: [],
        helpViews: [],
        lastCleanup: now,
      });
      window.localStorage.setItem("pos-assistant-metrics-events", oldEvents);

      const metrics2 = createAssistantMetricsService();
      metrics2.runCleanup();

      // Reload from storage
      const raw = window.localStorage.getItem("pos-assistant-metrics-events");
      const parsed = JSON.parse(raw!);
      expect(parsed.queries[0].query).toBe("");
    });
  });
});
