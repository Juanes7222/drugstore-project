/**
 * Zustand store for the assistant overlay state.
 *
 * Manages the visibility and state of:
 * - Command palette
 * - Suggestion banner
 * - Shortcut cheatsheet overlay
 * - Help viewer overlay
 * - Preferences panel
 */

import { create } from "zustand";
import type { ActiveSuggestion } from "../domain/assistant/assistant-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssistantState {
  /** Whether the command palette is open. */
  paletteOpen: boolean;

  /** Current palette query text. */
  paletteQuery: string;

  /** Whether the shortcut cheatsheet overlay is open. */
  cheatsheetOpen: boolean;

  /** Whether the help viewer is open. */
  helpOpen: boolean;

  /** Currently open help topic ID. */
  helpTopicId: string | null;

  /** Whether the preferences panel is open. */
  preferencesOpen: boolean;

  /** Active suggestions from the suggestion engine. */
  suggestions: ActiveSuggestion[];

  /** Whether the suggestion banner is expanded (showing all). */
  suggestionsExpanded: boolean;

  /** Whether the search index is currently being built. */
  isIndexBuilding: boolean;

  /** Actions */
  openPalette: () => void;
  closePalette: () => void;
  setPaletteQuery: (query: string) => void;
  openCheatsheet: () => void;
  closeCheatsheet: () => void;
  openHelp: (topicId?: string) => void;
  closeHelp: () => void;
  openPreferences: () => void;
  closePreferences: () => void;
  setSuggestions: (suggestions: ActiveSuggestion[]) => void;
  setSuggestionsExpanded: (expanded: boolean) => void;
  setIsIndexBuilding: (building: boolean) => void;

  /** Close all overlays (e.g., on Esc). */
  closeAll: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAssistantStore = create<AssistantState>((set) => ({
  paletteOpen: false,
  paletteQuery: "",
  cheatsheetOpen: false,
  helpOpen: false,
  helpTopicId: null,
  preferencesOpen: false,
  suggestions: [],
  suggestionsExpanded: false,
  isIndexBuilding: false,

  openPalette: () =>
    set({
      paletteOpen: true,
      paletteQuery: "",
      cheatsheetOpen: false,
      helpOpen: false,
      preferencesOpen: false,
    }),

  closePalette: () => set({ paletteOpen: false, paletteQuery: "" }),

  setPaletteQuery: (query: string) => set({ paletteQuery: query }),

  openCheatsheet: () =>
    set({
      cheatsheetOpen: true,
      paletteOpen: false,
      helpOpen: false,
      preferencesOpen: false,
    }),

  closeCheatsheet: () => set({ cheatsheetOpen: false }),

  openHelp: (topicId?: string) =>
    set({
      helpOpen: true,
      helpTopicId: topicId ?? null,
      paletteOpen: false,
      cheatsheetOpen: false,
      preferencesOpen: false,
    }),

  closeHelp: () => set({ helpOpen: false, helpTopicId: null }),

  openPreferences: () =>
    set({
      preferencesOpen: true,
      paletteOpen: false,
      helpOpen: false,
      cheatsheetOpen: false,
    }),

  closePreferences: () => set({ preferencesOpen: false }),

  setSuggestions: (suggestions: ActiveSuggestion[]) => set({ suggestions }),

  setSuggestionsExpanded: (expanded: boolean) =>
    set({ suggestionsExpanded: expanded }),

  setIsIndexBuilding: (building: boolean) =>
    set({ isIndexBuilding: building }),

  closeAll: () =>
    set({
      paletteOpen: false,
      paletteQuery: "",
      cheatsheetOpen: false,
      helpOpen: false,
      helpTopicId: null,
      preferencesOpen: false,
    }),
}));
