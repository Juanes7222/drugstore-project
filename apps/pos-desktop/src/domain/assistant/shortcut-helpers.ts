/**
 * Pure helper functions and constants for the shortcut cheatsheet.
 *
 * Extracted from the monolithic shortcut-cheatsheet.tsx so they can be
 * unit-tested without rendering the full dialog tree.
 */

import type { ShortcutContext } from './assistant-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Human-readable group labels mapped to i18n keys. */
export const GROUP_LABEL_KEYS: Record<ShortcutContext, string> = {
  GLOBAL: 'assistant.shortcuts.group_GLOBAL',
  SALE_FLOW: 'assistant.shortcuts.group_SALE_FLOW',
  SHIFT_OPEN: 'assistant.shortcuts.group_SHIFT_OPEN',
  MANAGER_ONLY: 'assistant.shortcuts.group_MANAGER_ONLY',
  TEXT_INPUT: 'assistant.shortcuts.group_TEXT_INPUT',
  MODAL_OPEN: 'assistant.shortcuts.group_MODAL_OPEN',
};

/** Fixed context order for rendering (in display priority). */
export const CONTEXT_ORDER: ShortcutContext[] = [
  'GLOBAL',
  'SALE_FLOW',
  'SHIFT_OPEN',
  'MANAGER_ONLY',
  'TEXT_INPUT',
  'MODAL_OPEN',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a key combo string for display in a kbd element.
 * Replaces "Cmd" with the ⌘ symbol.
 */
export function formatCombo(key: string): string {
  return key.replace(/\bCmd\b/g, '\u2318');
}

/**
 * Check whether a keydown event should be ignored during capture mode.
 * Returns true for modifier-only presses (no accompanying non-modifier key).
 */
export function isModifierOnly(event: KeyboardEvent): boolean {
  return ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key);
}
