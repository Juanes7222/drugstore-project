/**
 * Assistant module — barrel exports.
 *
 * The in-app productivity assistant provides:
 * - Command palette (keyboard-first, fuzzy-searchable)
 * - Contextual suggestion engine (rule-based)
 * - Keyboard shortcut manager (configurable)
 * - Form memory (auto-complete for form fields)
 * - Integrated help system (Markdown content)
 * - Local analytics (no PII, no server sync)
 */

// Types
export type {
  IndexableItem,
  IndexablePage,
  IndexableProduct,
  IndexableClient,
  IndexableSale,
  IndexableCommand,
  IndexableHelpTopic,
  IndexableRecent,
  AppState,
  SuggestionRule,
  ActiveSuggestion,
  CommandDefinition,
  ShortcutBinding,
  ShortcutContext,
  PaletteActionType,
  Severity,
  Audience,
  FormMemoryEntry,
  PaletteState,
  HelpFrontmatter,
  DailyMetrics,
  PaletteOpenEvent,
  PaletteQueryEvent,
  SuggestionEvent,
  HelpViewEvent,
} from "./assistant-types";

// Commands
export { COMMANDS, getCommandsForRole } from "./commands";

// Search index
export {
  createSearchIndexService,
  INDEX_WORKER_THRESHOLD,
  INDEX_UPDATE_DEBOUNCE_MS,
  MAX_RECENT_ITEMS,
} from "./search-index.service";
export type { SearchIndexService } from "./search-index.service";

// Suggestion engine
export {
  createSuggestionEngine,
  EVALUATION_DEBOUNCE_MS,
  PERIODIC_EVALUATION_INTERVAL_MS,
  MAX_VISIBLE_SUGGESTIONS,
} from "./suggestion-engine.service";
export type { SuggestionEngine } from "./suggestion-engine.service";

// Suggestion rules
export { SUGGESTION_RULES, evaluateRules } from "./suggestion-rules";

// Shortcut manager
export {
  createShortcutManager,
} from "./shortcut-manager";
export type { ShortcutManager } from "./shortcut-manager";

// Form memory
export {
  createFormMemoryService,
} from "./form-memory.service";
export type { FormMemoryService } from "./form-memory.service";

// Metrics
export {
  createAssistantMetricsService,
} from "./assistant-metrics.service";
export type { AssistantMetricsService } from "./assistant-metrics.service";

// Exceptions
export {
  IndexBuildException,
  SearchExecutionException,
  SuggestionRuleException,
  ShortcutConflictException,
  FormMemoryPersistenceException,
  MetricsPersistenceException,
} from "./exceptions";
