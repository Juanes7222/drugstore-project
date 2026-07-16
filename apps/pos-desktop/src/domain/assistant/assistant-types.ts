/**
 * Shared types for the in-app productivity assistant.
 *
 * Discriminated union types for the search index, command palette,
 * suggestion engine, and help system.
 */

// ---------------------------------------------------------------------------
// Search index — IndexableItem discriminated union
// ---------------------------------------------------------------------------

export interface IndexablePage {
  category: "PAGE";
  id: string;
  label: string;
  route: string;
  icon?: string;
  keywords?: string[];
}

export interface IndexableProduct {
  category: "PRODUCT";
  id: string;
  name: string;
  barcode?: string;
  genericName?: string;
  categoryName?: string;
  laboratory?: string;
}

export interface IndexableClient {
  category: "CLIENT";
  id: string;
  name: string;
  document?: string;
  phone?: string;
}

export interface IndexableSale {
  category: "SALE";
  id: string;
  localNumber: number;
  total: number;
  status: string;
  confirmedAt?: string;
}

export interface IndexableCommand {
  category: "COMMAND";
  id: string;
  label: string;
  shortcut?: string;
  group: string;
  audience: Audience;
}

export interface IndexableHelpTopic {
  category: "HELP_TOPIC";
  id: string;
  title: string;
  excerpt: string;
  keywords?: string[];
  route?: string;
}

export interface IndexableRecent {
  category: "RECENT";
  id: string;
  label: string;
  lastUsed: number; // epoch ms
  originalCategory: IndexableItem["category"];
  originalId: string;
}

export type IndexableItem =
  | IndexablePage
  | IndexableProduct
  | IndexableClient
  | IndexableSale
  | IndexableCommand
  | IndexableHelpTopic
  | IndexableRecent;

// ---------------------------------------------------------------------------
// App state shape (for suggestion engine conditions)
// ---------------------------------------------------------------------------

export interface AppState {
  activeScreen: string;
  currentUserRole: string | null;
  cartItemCount: number;
  cartHasItems: boolean;
  cartTotalCents: number;
  currentClientId: string | null;
  currentClientName: string | null;
  syncQueuePending: number;
  syncQueuePermanentFailure: number;
  oldestPendingAgeMs: number;
  invoicesExpiringWithin24h: number;
  currentShiftDurationHours: number;
  isSyncing: boolean;
  isOnline: boolean;
  pendingOfflineSessions: number;
  rejectedOfflineSessions: number;
  isOfflineBlessingInProgress: boolean;
  lastConfirmedSaleId: string | null;
  lastConfirmedSaleNumber: number | null;
}

// ---------------------------------------------------------------------------
// Suggestion engine types
// ---------------------------------------------------------------------------

export type Severity = "INFO" | "WARN" | "CRITICAL";
export type Audience = "cashier" | "manager" | "both";

export interface SuggestionRule {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  audience: Audience;
  dismissable: boolean;
  cooldownMs?: number;
  condition: (state: AppState) => boolean;
  action: {
    label: string;
    execute: () => void | Promise<void>;
  };
}

export interface ActiveSuggestion {
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  dismissable: boolean;
  action: {
    label: string;
    execute: () => void | Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// Command palette types
// ---------------------------------------------------------------------------

export type PaletteActionType =
  | "NAVIGATE"
  | "OPEN_SALE"
  | "START_RETURN"
  | "OPEN_HELP"
  | "RUN_COMMAND"
  | "OPEN_PREFERENCES"
  | "REPRINT_RECEIPT"
  | "SYNC_NOW"
  | "CREATE_BACKUP"
  | "RESTORE_BACKUP"
  | "EXPORT_CSV"
  | "SHOW_SHORTCUTS"
  | "SHOW_HELP_INDEX";

export interface CommandDefinition {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  icon?: string;
  audience: Audience;
  action: PaletteActionType;
  actionPayload?: string;
  execute: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Shortcut manager types
// ---------------------------------------------------------------------------

export type ShortcutContext =
  | "GLOBAL"
  | "SALE_FLOW"
  | "SHIFT_OPEN"
  | "MANAGER_ONLY"
  | "TEXT_INPUT"
  | "MODAL_OPEN";

export interface ShortcutBinding {
  id: string;
  key: string; // e.g. "Cmd+K", "Cmd+N"
  commandId: string;
  context: ShortcutContext;
  description: string;
}

// ---------------------------------------------------------------------------
// Help content frontmatter
// ---------------------------------------------------------------------------

export interface HelpFrontmatter {
  id: string;
  title: string;
  keywords: string[];
  audience: Audience;
  lastUpdated: string; // ISO date string
  route?: string;
}

// ---------------------------------------------------------------------------
// Form memory types
// ---------------------------------------------------------------------------

export interface FormMemoryEntry {
  value: string;
  lastUsed: number;
}

// ---------------------------------------------------------------------------
// Assistant metrics types
// ---------------------------------------------------------------------------

export interface PaletteOpenEvent {
  timestamp: number;
  userId: string;
}

export interface PaletteQueryEvent {
  timestamp: number;
  query: string; // full query text, for 7-day retention only
  resultCount: number;
  selectedCategory: IndexableItem["category"] | null;
}

export interface SuggestionEvent {
  timestamp: number;
  ruleId: string;
  action: "shown" | "dismissed" | "clicked";
}

export interface HelpViewEvent {
  timestamp: number;
  topicId: string;
}

export interface DailyMetrics {
  date: string; // YYYY-MM-DD
  paletteOpens: number;
  queriesEntered: number;
  resultsByCategory: Record<string, number>;
  suggestionsShown: Record<string, number>;
  suggestionsDismissed: Record<string, number>;
  suggestionsClicked: Record<string, number>;
  helpTopicsViewed: Record<string, number>;
  shortcutsUsed: number;
  paletteUsage: number;
}

// ---------------------------------------------------------------------------
// Palette state (for the Zustand store)
// ---------------------------------------------------------------------------

export interface PaletteState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  results: IndexableItem[];
  isBuildingIndex: boolean;
}
