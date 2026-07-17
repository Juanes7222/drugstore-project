/**
 * React hook for user preferences.
 *
 * Subscribes to the existing UserPreferencesStore with the new
 * UI preference fields (theme, language, dateFormat, etc.).
 */

import { useCallback } from 'react';
import { useSyncExternalStore } from 'react';
import { useUserPreferencesStore } from '../../stores/user-preferences.store';
import type {
  UserPreferences,
  UserTheme,
  DateFormat,
  TimeFormat,
  Language,
  KeyboardLayout,
} from './types';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseUserPreferencesResult {
  /** All user preferences. */
  preferences: UserPreferences;

  /** Current UI theme. */
  theme: UserTheme;

  /** Current language. */
  language: Language;

  /** Current date format. */
  dateFormat: DateFormat;

  /** Current time format. */
  timeFormat: TimeFormat;

  /** Sound effects enabled. */
  soundEnabled: boolean;

  /** Receipt font size. */
  receiptFontSize: number;

  /** Keyboard layout. */
  keyboardLayout: KeyboardLayout;

  /** Quick-select product IDs. */
  quickButtons: string[];

  // ---- Actions ----

  /** Set UI theme. */
  setTheme: (theme: UserTheme) => void;

  /** Set UI language. */
  setLanguage: (language: Language) => void;

  /** Set date format. */
  setDateFormat: (format: DateFormat) => void;

  /** Set time format. */
  setTimeFormat: (format: TimeFormat) => void;

  /** Toggle sound. */
  setSoundEnabled: (enabled: boolean) => void;

  /** Set receipt font size. */
  setReceiptFontSize: (size: number) => void;

  /** Set keyboard layout. */
  setKeyboardLayout: (layout: KeyboardLayout) => void;

  /** Add quick button product. */
  addQuickButton: (productId: string) => void;

  /** Remove quick button product. */
  removeQuickButton: (productId: string) => void;

  /** Replace all quick buttons. */
  setQuickButtons: (productIds: string[]) => void;
}

export function useUserPreferences(): UseUserPreferencesResult {
  const store = useUserPreferencesStore;

  const state = useSyncExternalStore(
    useCallback((onStoreChange: () => void) => {
      const unsub = store.subscribe(onStoreChange);
      return unsub;
    }, [store]),
    useCallback(() => store.getState(), [store]),
  );

  return {
    preferences: {
      userId: '',
      workstationId: '',
      theme: state.theme,
      language: state.language,
      dateFormat: state.dateFormat,
      timeFormat: state.timeFormat,
      soundEnabled: state.soundEnabled,
      receiptFontSize: state.receiptFontSize,
      keyboardLayout: state.keyboardLayout,
      quickButtons: state.quickButtons,
      lastActiveScreen: null,
    },
    theme: state.theme,
    language: state.language,
    dateFormat: state.dateFormat,
    timeFormat: state.timeFormat,
    soundEnabled: state.soundEnabled,
    receiptFontSize: state.receiptFontSize,
    keyboardLayout: state.keyboardLayout,
    quickButtons: state.quickButtons,
    setTheme: state.setTheme,
    setLanguage: state.setLanguage,
    setDateFormat: state.setDateFormat,
    setTimeFormat: state.setTimeFormat,
    setSoundEnabled: state.setSoundEnabled,
    setReceiptFontSize: state.setReceiptFontSize,
    setKeyboardLayout: state.setKeyboardLayout,
    addQuickButton: state.addQuickButton,
    removeQuickButton: state.removeQuickButton,
    setQuickButtons: state.setQuickButtons,
  };
}
