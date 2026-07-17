/**
 * Zustand store for user preferences — persisted to localStorage.
 *
 * Fields:
 * - `dismissedSuggestions`: suggestion IDs the user has hidden
 * - `customShortcuts`: user-overridden keybindings (commandId → key combo)
 * - `paletteRecentItems`: last 20 selected palette items (used for "recent" grouping)
 * - `helpViewedPages`: page route → last viewed timestamp
 * - `formMemoryOptOuts`: field IDs where auto-complete is disabled
 * - `paletteUsageCount`: number of times palette was opened
 * - `shortcutUsageCount`: number of times shortcuts were used
 * - `theme`: UI theme preference (LIGHT | DARK | SYSTEM)
 * - `language`: UI language
 * - `dateFormat`: date display format
 * - `timeFormat`: time display format (12H | 24H)
 * - `soundEnabled`: sound effects toggle
 * - `receiptFontSize`: receipt print font size
 * - `keyboardLayout`: keyboard layout preference
 * - `quickButtons`: product IDs for quick-select buttons
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserTheme = 'LIGHT' | 'DARK' | 'SYSTEM';
export type DateFormat = 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY';
export type TimeFormat = '12H' | '24H';
export type Language = 'es' | 'en';
export type KeyboardLayout = 'STANDARD' | 'COMPACT';

export interface UserPreferences {
  /** Suggestion IDs the user has dismissed (persistent across restarts). */
  dismissedSuggestions: string[];

  /** Count of consecutive dismissals per rule. */
  dismissalCounts: Record<string, number>;

  /** User-overridden keybindings: commandId → key combo string. */
  customShortcuts: Record<string, string>;

  /** Last 20 selected palette items, newest first. */
  paletteRecentItems: string[];

  /** Page route → last viewed timestamp (epoch ms). */
  helpViewedPages: Record<string, number>;

  /** Field IDs where auto-complete is disabled. */
  formMemoryOptOuts: string[];

  /** Aggregate counters. */
  paletteUsageCount: number;
  shortcutUsageCount: number;

  // ---- UI Preferences ----

  /** UI theme. */
  theme: UserTheme;

  /** UI language. */
  language: Language;

  /** Date display format. */
  dateFormat: DateFormat;

  /** Time display format. */
  timeFormat: TimeFormat;

  /** Enable sound effects. */
  soundEnabled: boolean;

  /** Receipt print font size in points. */
  receiptFontSize: number;

  /** Keyboard layout preference. */
  keyboardLayout: KeyboardLayout;

  /** Product IDs for quick-select buttons on the sales screen. */
  quickButtons: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECENT_ITEMS = 20;
const AUTO_DISMISS_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface UserPreferencesStore extends UserPreferences {
  /** Dismiss a suggestion rule (hides it and increments dismissal count). */
  dismissSuggestion: (suggestionId: string) => void;

  /** Check if a suggestion should be shown (not dismissed, not auto-hidden). */
  shouldShowSuggestion: (suggestionId: string) => boolean;

  /** Set a custom shortcut override for a command. */
  setCustomShortcut: (commandId: string, shortcut: string) => void;

  /** Remove a custom shortcut override (revert to default). */
  removeCustomShortcut: (commandId: string) => void;

  /** Get effective shortcut for a command (custom or null if not overridden). */
  getCustomShortcut: (commandId: string) => string | undefined;

  /** Add an item to the palette recent list. */
  addPaletteRecentItem: (itemId: string) => void;

  /** Get the list of recent palette items. */
  getPaletteRecentItems: () => string[];

  /** Record that a help page was viewed. */
  recordHelpPageView: (route: string) => void;

  /** Check if a help page has been viewed recently. */
  wasHelpPageViewedRecently: (route: string, withinMs?: number) => boolean;

  /** Opt out of form memory for a specific field. */
  optOutFormField: (fieldId: string) => void;

  /** Check if a field has auto-complete disabled. */
  isFormFieldOptedOut: (fieldId: string) => boolean;

  /** Increment palette usage counter. */
  incrementPaletteUsage: () => void;

  /** Increment shortcut usage counter. */
  incrementShortcutUsage: () => void;

  // ---- UI preference actions ----

  /** Set the UI theme. */
  setTheme: (theme: UserTheme) => void;

  /** Set the UI language. */
  setLanguage: (language: Language) => void;

  /** Set the date format. */
  setDateFormat: (format: DateFormat) => void;

  /** Set the time format. */
  setTimeFormat: (format: TimeFormat) => void;

  /** Toggle sound effects. */
  setSoundEnabled: (enabled: boolean) => void;

  /** Set the receipt font size. */
  setReceiptFontSize: (size: number) => void;

  /** Set the keyboard layout. */
  setKeyboardLayout: (layout: KeyboardLayout) => void;

  /** Add a product to quick buttons. */
  addQuickButton: (productId: string) => void;

  /** Remove a product from quick buttons. */
  removeQuickButton: (productId: string) => void;

  /** Replace all quick buttons. */
  setQuickButtons: (productIds: string[]) => void;
}

export const useUserPreferencesStore = create<UserPreferencesStore>()(
  persist(
    (set, get) => ({
      // ---- State ----
      dismissedSuggestions: [],
      dismissalCounts: {},
      customShortcuts: {},
      paletteRecentItems: [],
      helpViewedPages: {},
      formMemoryOptOuts: [],
      paletteUsageCount: 0,
      shortcutUsageCount: 0,
      theme: 'LIGHT' as UserTheme,
      language: 'es' as Language,
      dateFormat: 'DD/MM/YYYY' as DateFormat,
      timeFormat: '24H' as TimeFormat,
      soundEnabled: true,
      receiptFontSize: 10,
      keyboardLayout: 'STANDARD' as KeyboardLayout,
      quickButtons: [],

      // ---- Actions ----

      dismissSuggestion: (suggestionId: string) => {
        set((state) => {
          const newCount = (state.dismissalCounts[suggestionId] ?? 0) + 1;
          const newDismissals = [...state.dismissedSuggestions, suggestionId];

          // Auto-hide if dismissed 5+ times
          if (newCount >= AUTO_DISMISS_THRESHOLD) {
            return {
              dismissedSuggestions: newDismissals,
              dismissalCounts: {
                ...state.dismissalCounts,
                [suggestionId]: newCount,
              },
            };
          }

          return {
            dismissedSuggestions: newDismissals,
            dismissalCounts: {
              ...state.dismissalCounts,
              [suggestionId]: newCount,
            },
          };
        });
      },

      shouldShowSuggestion: (suggestionId: string) => {
        const state = get();
        return !state.dismissedSuggestions.includes(suggestionId);
      },

      setCustomShortcut: (commandId: string, shortcut: string) => {
        set((state) => ({
          customShortcuts: { ...state.customShortcuts, [commandId]: shortcut },
        }));
      },

      removeCustomShortcut: (commandId: string) => {
        set((state) => {
          const { [commandId]: _, ...rest } = state.customShortcuts;
          return { customShortcuts: rest };
        });
      },

      getCustomShortcut: (commandId: string) => {
        return get().customShortcuts[commandId];
      },

      addPaletteRecentItem: (itemId: string) => {
        set((state) => {
          const filtered = state.paletteRecentItems.filter(
            (id) => id !== itemId,
          );
          const updated = [itemId, ...filtered].slice(0, MAX_RECENT_ITEMS);
          return { paletteRecentItems: updated };
        });
      },

      getPaletteRecentItems: () => {
        return get().paletteRecentItems;
      },

      recordHelpPageView: (route: string) => {
        set((state) => ({
          helpViewedPages: {
            ...state.helpViewedPages,
            [route]: Date.now(),
          },
        }));
      },

      wasHelpPageViewedRecently: (route: string, withinMs = 86_400_000) => {
        const timestamp = get().helpViewedPages[route];
        if (!timestamp) return false;
        return Date.now() - timestamp <= withinMs;
      },

      optOutFormField: (fieldId: string) => {
        set((state) => {
          if (state.formMemoryOptOuts.includes(fieldId)) return state;
          return {
            formMemoryOptOuts: [...state.formMemoryOptOuts, fieldId],
          };
        });
      },

      isFormFieldOptedOut: (fieldId: string) => {
        return get().formMemoryOptOuts.includes(fieldId);
      },

      incrementPaletteUsage: () => {
        set((state) => ({
          paletteUsageCount: state.paletteUsageCount + 1,
        }));
      },

      incrementShortcutUsage: () => {
        set((state) => ({
          shortcutUsageCount: state.shortcutUsageCount + 1,
        }));
      },

      // ---- UI preference actions ----

      setTheme: (theme: UserTheme) => {
        set({ theme });
      },

      setLanguage: (language: Language) => {
        set({ language });
      },

      setDateFormat: (format: DateFormat) => {
        set({ dateFormat: format });
      },

      setTimeFormat: (format: TimeFormat) => {
        set({ timeFormat: format });
      },

      setSoundEnabled: (enabled: boolean) => {
        set({ soundEnabled: enabled });
      },

      setReceiptFontSize: (size: number) => {
        const clamped = Math.max(8, Math.min(20, size));
        set({ receiptFontSize: clamped });
      },

      setKeyboardLayout: (layout: KeyboardLayout) => {
        set({ keyboardLayout: layout });
      },

      addQuickButton: (productId: string) => {
        set((state) => {
          if (state.quickButtons.includes(productId)) return state;
          return { quickButtons: [...state.quickButtons, productId] };
        });
      },

      removeQuickButton: (productId: string) => {
        set((state) => ({
          quickButtons: state.quickButtons.filter((id) => id !== productId),
        }));
      },

      setQuickButtons: (productIds: string[]) => {
        set({ quickButtons: productIds });
      },
    }),
    {
      name: "pos-user-preferences",
      // Only persist the data fields, not the action functions
      partialize: (state) => ({
        dismissedSuggestions: state.dismissedSuggestions,
        dismissalCounts: state.dismissalCounts,
        customShortcuts: state.customShortcuts,
        paletteRecentItems: state.paletteRecentItems,
        helpViewedPages: state.helpViewedPages,
        formMemoryOptOuts: state.formMemoryOptOuts,
        paletteUsageCount: state.paletteUsageCount,
        shortcutUsageCount: state.shortcutUsageCount,
        theme: state.theme,
        language: state.language,
        dateFormat: state.dateFormat,
        timeFormat: state.timeFormat,
        soundEnabled: state.soundEnabled,
        receiptFontSize: state.receiptFontSize,
        keyboardLayout: state.keyboardLayout,
        quickButtons: state.quickButtons,
      }),
    },
  ),
);
