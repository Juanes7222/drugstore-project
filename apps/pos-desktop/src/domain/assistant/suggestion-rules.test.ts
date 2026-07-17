/**
 * Tests for the suggestion rule definitions and the evaluateRules function.
 */
import { describe, expect, it } from "vitest";
import { SUGGESTION_RULES, evaluateRules } from "./suggestion-rules";
import type { AppState } from "./assistant-types";

describe("SUGGESTION_RULES", () => {
  it("defines at least 8 rules", () => {
    expect(SUGGESTION_RULES.length).toBeGreaterThanOrEqual(8);
  });

  it("every rule has an id starting with 'suggestion.'", () => {
    for (const rule of SUGGESTION_RULES) {
      expect(rule.id).toMatch(/^suggestion\./);
    }
  });

  it("has at least one CRITICAL severity rule", () => {
    const critical = SUGGESTION_RULES.filter((r) => r.severity === "CRITICAL");
    expect(critical.length).toBeGreaterThan(0);
  });

  it("has at least one WARN severity rule", () => {
    const warn = SUGGESTION_RULES.filter((r) => r.severity === "WARN");
    expect(warn.length).toBeGreaterThan(0);
  });

  it("has at least one INFO severity rule", () => {
    const info = SUGGESTION_RULES.filter((r) => r.severity === "INFO");
    expect(info.length).toBeGreaterThan(0);
  });

  it("every rule has a condition function and an action with label", () => {
    for (const rule of SUGGESTION_RULES) {
      expect(typeof rule.condition).toBe("function");
      expect(rule.action.label).toBeTruthy();
      expect(typeof rule.action.execute).toBe("function");
    }
  });
});

describe("evaluateRules", () => {
  const baseState: AppState = {
    activeScreen: "sales",
    currentUserRole: "CASHIER",
    cartItemCount: 0,
    cartHasItems: false,
    cartTotalCents: 0,
    currentClientId: null,
    currentClientName: null,
    syncQueuePending: 0,
    syncQueuePermanentFailure: 0,
    oldestPendingAgeMs: 0,
    invoicesExpiringWithin24h: 0,
    currentShiftDurationHours: 0,
    isSyncing: false,
    isOnline: true,
    pendingOfflineSessions: 0,
    rejectedOfflineSessions: 0,
    isOfflineBlessingInProgress: false,
    lastConfirmedSaleId: null,
    lastConfirmedSaleNumber: null,
  };

  it("returns empty array when no rules match", () => {
    const results = evaluateRules(baseState, []);

    expect(results).toEqual([]);
  });

  it("returns CRITICAL rule when permanent failures exist", () => {
    const state = { ...baseState, syncQueuePermanentFailure: 3 };
    const results = evaluateRules(state, []);

    const criticalRule = results.find(
      (r) => r.rule.id === "suggestion.critical.permanent-failures",
    );
    expect(criticalRule).toBeDefined();
    expect(criticalRule!.severity).toBe("CRITICAL");
  });

  it("returns CRITICAL rule when invoices are expiring", () => {
    const state = { ...baseState, invoicesExpiringWithin24h: 2 };
    const results = evaluateRules(state, []);

    expect(
      results.find((r) => r.rule.id === "suggestion.critical.invoices-expiring"),
    ).toBeDefined();
  });

  it("returns WARN rule when sync is stale", () => {
    const state = {
      ...baseState,
      syncQueuePending: 5,
      oldestPendingAgeMs: 7_200_000, // 2 hours
    };
    const results = evaluateRules(state, []);

    expect(
      results.find((r) => r.rule.id === "suggestion.warn.sync-stale"),
    ).toBeDefined();
  });

  it("returns WARN rule when shift is open for too long", () => {
    const state = { ...baseState, currentShiftDurationHours: 10 };
    const results = evaluateRules(state, []);

    expect(
      results.find((r) => r.rule.id === "suggestion.warn.shift-long-open"),
    ).toBeDefined();
  });

  it("returns INFO rule when syncing is in progress", () => {
    const state = { ...baseState, isSyncing: true };
    const results = evaluateRules(state, []);

    expect(
      results.find((r) => r.rule.id === "suggestion.info.sync-pending"),
    ).toBeDefined();
  });

  it("returns INFO rule when there is a last confirmed sale", () => {
    const state = { ...baseState, lastConfirmedSaleId: "sale-123" };
    const results = evaluateRules(state, []);

    expect(
      results.find((r) => r.rule.id === "suggestion.info.reprint-receipt"),
    ).toBeDefined();
  });

  it("returns INFO rule when connection is restored and queue not empty", () => {
    const state = {
      ...baseState,
      isOnline: true,
      syncQueuePending: 3,
      oldestPendingAgeMs: 0,
    };
    const results = evaluateRules(state, []);

    expect(
      results.find((r) => r.rule.id === "suggestion.info.connection-restored"),
    ).toBeDefined();
  });

  it("does not return dismissed rules", () => {
    const state = { ...baseState, syncQueuePermanentFailure: 3 };
    const results = evaluateRules(state, [
      "suggestion.critical.permanent-failures",
    ]);

    expect(
      results.find((r) => r.rule.id === "suggestion.critical.permanent-failures"),
    ).toBeUndefined();
  });

  it("sorts results with CRITICAL first, then WARN, then INFO", () => {
    const state = {
      ...baseState,
      syncQueuePermanentFailure: 1,
      invoicesExpiringWithin24h: 1,
      syncQueuePending: 5,
      oldestPendingAgeMs: 7_200_000,
      currentShiftDurationHours: 10,
      isSyncing: true,
      lastConfirmedSaleId: "sale-1",
      isOnline: true,
    };

    const results = evaluateRules(state, []);

    const severities = results.map((r) => r.severity);
    const firstCritical = severities.indexOf("CRITICAL");
    const firstWarn = severities.indexOf("WARN");
    const firstInfo = severities.indexOf("INFO");

    expect(firstCritical).toBeGreaterThanOrEqual(0);
    expect(firstWarn).toBeGreaterThan(firstCritical);
    expect(firstInfo).toBeGreaterThan(firstWarn);
  });
});
