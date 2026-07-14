/**
 * Tests for assistant-specific domain exceptions.
 *
 * Every exception class extends DomainError with a fixed errorCode.
 */
import { describe, expect, it } from "vitest";
import { DomainError } from "../../common/domain-error";
import {
  IndexBuildException,
  SearchExecutionException,
  SuggestionRuleException,
  ShortcutConflictException,
  FormMemoryPersistenceException,
  MetricsPersistenceException,
} from "./exceptions";

describe("IndexBuildException", () => {
  it("sets errorCode to INDEX_BUILD_ERROR and includes cause in message", () => {
    const error = new IndexBuildException("Database unavailable");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("INDEX_BUILD_ERROR");
    expect(error.message).toContain("Database unavailable");
  });
});

describe("SearchExecutionException", () => {
  it("sets errorCode to SEARCH_ERROR and includes cause", () => {
    const error = new SearchExecutionException("Fuse.js crashed");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("SEARCH_ERROR");
    expect(error.message).toContain("Fuse.js crashed");
  });
});

describe("SuggestionRuleException", () => {
  it("sets errorCode to SUGGESTION_RULE_ERROR and includes ruleId and cause", () => {
    const error = new SuggestionRuleException("suggestion.warn.sync-stale", "Condition threw");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("SUGGESTION_RULE_ERROR");
    expect(error.message).toContain("suggestion.warn.sync-stale");
    expect(error.message).toContain("Condition threw");
  });
});

describe("ShortcutConflictException", () => {
  it("sets errorCode to SHORTCUT_CONFLICT and includes shortcut and existing command", () => {
    const error = new ShortcutConflictException("Cmd+N", "cmd.new-sale");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("SHORTCUT_CONFLICT");
    expect(error.message).toContain("Cmd+N");
    expect(error.message).toContain("cmd.new-sale");
  });
});

describe("FormMemoryPersistenceException", () => {
  it("sets errorCode to FORM_MEMORY_ERROR and includes cause", () => {
    const error = new FormMemoryPersistenceException("localStorage full");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("FORM_MEMORY_ERROR");
    expect(error.message).toContain("localStorage full");
  });
});

describe("MetricsPersistenceException", () => {
  it("sets errorCode to METRICS_ERROR and includes cause", () => {
    const error = new MetricsPersistenceException("Quota exceeded");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("METRICS_ERROR");
    expect(error.message).toContain("Quota exceeded");
  });
});
