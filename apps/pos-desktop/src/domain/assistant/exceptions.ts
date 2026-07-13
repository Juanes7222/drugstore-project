/**
 * Assistant-specific domain errors.
 */
import { DomainError } from "../../common/domain-error";

export class IndexBuildException extends DomainError {
  constructor(cause: string) {
    super("INDEX_BUILD_ERROR", `Failed to build search index: ${cause}`);
  }
}

export class SearchExecutionException extends DomainError {
  constructor(cause: string) {
    super("SEARCH_ERROR", `Search execution failed: ${cause}`);
  }
}

export class SuggestionRuleException extends DomainError {
  constructor(ruleId: string, cause: string) {
    super(
      "SUGGESTION_RULE_ERROR",
      `Suggestion rule "${ruleId}" threw: ${cause}`,
    );
  }
}

export class ShortcutConflictException extends DomainError {
  constructor(shortcut: string, existingCommandId: string) {
    super(
      "SHORTCUT_CONFLICT",
      `Shortcut "${shortcut}" already registered for command "${existingCommandId}"`,
    );
  }
}

export class FormMemoryPersistenceException extends DomainError {
  constructor(cause: string) {
    super("FORM_MEMORY_ERROR", `Form memory persistence failed: ${cause}`);
  }
}

export class MetricsPersistenceException extends DomainError {
  constructor(cause: string) {
    super("METRICS_ERROR", `Metrics persistence failed: ${cause}`);
  }
}
