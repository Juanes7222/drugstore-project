/**
 * Tests for shortcut cheatsheet helper functions and constants.
 *
 * These are pure functions extracted from the monolithic shortcut cheatsheet.
 */
import { describe, expect, it } from 'vitest';
import {
  GROUP_LABEL_KEYS,
  CONTEXT_ORDER,
  formatCombo,
  isModifierOnly,
} from './shortcut-helpers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('GROUP_LABEL_KEYS', () => {
  it('defines an i18n key for every ShortcutContext', () => {
    expect(GROUP_LABEL_KEYS.GLOBAL).toBe('assistant.shortcuts.group_GLOBAL');
    expect(GROUP_LABEL_KEYS.SALE_FLOW).toBe('assistant.shortcuts.group_SALE_FLOW');
    expect(GROUP_LABEL_KEYS.SHIFT_OPEN).toBe('assistant.shortcuts.group_SHIFT_OPEN');
    expect(GROUP_LABEL_KEYS.MANAGER_ONLY).toBe('assistant.shortcuts.group_MANAGER_ONLY');
    expect(GROUP_LABEL_KEYS.TEXT_INPUT).toBe('assistant.shortcuts.group_TEXT_INPUT');
    expect(GROUP_LABEL_KEYS.MODAL_OPEN).toBe('assistant.shortcuts.group_MODAL_OPEN');
  });
});

describe('CONTEXT_ORDER', () => {
  it('contains all six ShortcutContext values', () => {
    expect(CONTEXT_ORDER).toHaveLength(6);
  });

  it('follows the expected display priority order', () => {
    expect(CONTEXT_ORDER).toEqual([
      'GLOBAL',
      'SALE_FLOW',
      'SHIFT_OPEN',
      'MANAGER_ONLY',
      'TEXT_INPUT',
      'MODAL_OPEN',
    ]);
  });
});

// ---------------------------------------------------------------------------
// formatCombo
// ---------------------------------------------------------------------------

describe('formatCombo', () => {
  it('replaces "Cmd" with the ⌘ symbol', () => {
    expect(formatCombo('Cmd+K')).toBe('\u2318+K');
  });

  it('replaces "Cmd" in the middle of a combo', () => {
    expect(formatCombo('Cmd+Shift+P')).toBe('\u2318+Shift+P');
  });

  it('returns keys without "Cmd" unchanged', () => {
    expect(formatCombo('F1')).toBe('F1');
    expect(formatCombo('Escape')).toBe('Escape');
    expect(formatCombo('Shift+?')).toBe('Shift+?');
  });

  it('replaces multiple occurrences of "Cmd"', () => {
    expect(formatCombo('Cmd+Alt+Cmd')).toBe('\u2318+Alt+\u2318');
  });

  it('does not replace "Cmd" when it is part of a larger word', () => {
    expect(formatCombo('Cmd+K')).toBe('\u2318+K');
  });

  it('handles an empty string', () => {
    expect(formatCombo('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// isModifierOnly
// ---------------------------------------------------------------------------

describe('isModifierOnly', () => {
  function createKeyEvent(key: string): KeyboardEvent {
    return { key } as KeyboardEvent;
  }

  it('returns true for Meta', () => {
    expect(isModifierOnly(createKeyEvent('Meta'))).toBe(true);
  });

  it('returns true for Control', () => {
    expect(isModifierOnly(createKeyEvent('Control'))).toBe(true);
  });

  it('returns true for Alt', () => {
    expect(isModifierOnly(createKeyEvent('Alt'))).toBe(true);
  });

  it('returns true for Shift', () => {
    expect(isModifierOnly(createKeyEvent('Shift'))).toBe(true);
  });

  it('returns false for a letter key', () => {
    expect(isModifierOnly(createKeyEvent('k'))).toBe(false);
  });

  it('returns false for a function key', () => {
    expect(isModifierOnly(createKeyEvent('F1'))).toBe(false);
  });

  it('returns false for Enter', () => {
    expect(isModifierOnly(createKeyEvent('Enter'))).toBe(false);
  });

  it('returns false for Escape', () => {
    expect(isModifierOnly(createKeyEvent('Escape'))).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isModifierOnly(createKeyEvent(''))).toBe(false);
  });

  it('returns false for Space', () => {
    expect(isModifierOnly(createKeyEvent(' '))).toBe(false);
  });
});
