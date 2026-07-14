/**
 * Tests for help viewer helper functions.
 *
 * These are pure functions extracted from the monolithic help viewer so
 * they can be unit-tested without rendering React.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  getEntrySection,
  formatDate,
  isOlderThanSixMonths,
  groupBySection,
  sectionLabelKey,
  countOrderedListItems,
} from './help-helpers';
import type { HelpContentEntry } from '../../help-content';

// ---------------------------------------------------------------------------
// getEntrySection
// ---------------------------------------------------------------------------

describe('getEntrySection', () => {
  it('returns "screens" for paths containing /screens/', () => {
    const entry = { path: '/src/help-content/screens/sales.md' } as HelpContentEntry;
    expect(getEntrySection(entry)).toBe('screens');
  });

  it('returns "procedures" for paths containing /procedures/', () => {
    const entry = { path: '/src/help-content/procedures/returns.md' } as HelpContentEntry;
    expect(getEntrySection(entry)).toBe('procedures');
  });

  it('returns "general" for paths without /screens/ or /procedures/', () => {
    const entry = { path: '/src/help-content/index.md' } as HelpContentEntry;
    expect(getEntrySection(entry)).toBe('general');
  });

  it('returns "general" for paths in an unknown subdirectory', () => {
    const entry = { path: '/src/help-content/backup/overview.md' } as HelpContentEntry;
    expect(getEntrySection(entry)).toBe('general');
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('formats a valid ISO date string into a non-empty locale string', () => {
    const result = formatDate('2026-07-01');
    expect(result).not.toBe('2026-07-01');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns "Invalid Date" for an unparseable string (jsdom behaviour)', () => {
    const result = formatDate('not-a-date');
    expect(result).toBe('Invalid Date');
  });

  it('returns "Invalid Date" for empty string (jsdom behaviour)', () => {
    const result = formatDate('');
    expect(result).toBe('Invalid Date');
  });
});

// ---------------------------------------------------------------------------
// isOlderThanSixMonths
// ---------------------------------------------------------------------------

describe('isOlderThanSixMonths', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a date older than six months', () => {
    const result = isOlderThanSixMonths('2025-12-01');
    expect(result).toBe(true);
  });

  it('returns false for a recent date', () => {
    const result = isOlderThanSixMonths('2026-07-01');
    expect(result).toBe(false);
  });

  it('returns false for an invalid date string', () => {
    const result = isOlderThanSixMonths('not-a-date');
    expect(result).toBe(false);
  });

  it('returns false for the current date', () => {
    const result = isOlderThanSixMonths('2026-07-14');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// groupBySection
// ---------------------------------------------------------------------------

describe('groupBySection', () => {
  it('groups entries into screens, procedures, and general sections', () => {
    const screenEntry = { path: '/screens/sales.md' } as HelpContentEntry;
    const procEntry = { path: '/procedures/returns.md' } as HelpContentEntry;
    const generalEntry = { path: '/general/backup.md' } as HelpContentEntry;

    const grouped = groupBySection([screenEntry, procEntry, generalEntry]);

    expect(grouped).toHaveLength(3);
    expect(grouped[0].section).toBe('screens');
    expect(grouped[0].entries).toEqual([screenEntry]);
    expect(grouped[1].section).toBe('procedures');
    expect(grouped[1].entries).toEqual([procEntry]);
    expect(grouped[2].section).toBe('general');
    expect(grouped[2].entries).toEqual([generalEntry]);
  });

  it('preserves the order: screens, procedures, general', () => {
    const general = { path: '/general/x.md' } as HelpContentEntry;
    const screens = { path: '/screens/x.md' } as HelpContentEntry;
    const procedures = { path: '/procedures/x.md' } as HelpContentEntry;

    const grouped = groupBySection([general, screens, procedures]);

    expect(grouped.map((g) => g.section)).toEqual(['screens', 'procedures', 'general']);
  });

  it('omits sections that have no entries', () => {
    const screenEntry = { path: '/screens/sales.md' } as HelpContentEntry;

    const grouped = groupBySection([screenEntry]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].section).toBe('screens');
  });

  it('returns an empty array for empty input', () => {
    expect(groupBySection([])).toEqual([]);
  });

  it('groups multiple entries into the same section', () => {
    const e1 = { path: '/screens/sales.md' } as HelpContentEntry;
    const e2 = { path: '/screens/inventory.md' } as HelpContentEntry;

    const grouped = groupBySection([e1, e2]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].entries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// sectionLabelKey
// ---------------------------------------------------------------------------

describe('sectionLabelKey', () => {
  it('returns key for screens', () => {
    expect(sectionLabelKey('screens')).toBe('assistant.help.screens');
  });

  it('returns key for procedures', () => {
    expect(sectionLabelKey('procedures')).toBe('assistant.help.procedures');
  });

  it('returns key for general', () => {
    expect(sectionLabelKey('general')).toBe('assistant.help.general');
  });
});

// ---------------------------------------------------------------------------
// countOrderedListItems
// ---------------------------------------------------------------------------

describe('countOrderedListItems', () => {
  it('counts ordered list items in markdown', () => {
    const body = [
      '1. Open the drawer',
      '2. Count the cash',
      '3. Close the drawer',
    ].join('\n');
    expect(countOrderedListItems(body)).toBe(3);
  });

  it('returns 0 for markdown with no ordered lists', () => {
    const body = '# Title\n\nSome paragraph without numbers.';
    expect(countOrderedListItems(body)).toBe(0);
  });

  it('does not count unordered list items', () => {
    const body = ['- Item one', '- Item two', '- Item three'].join('\n');
    expect(countOrderedListItems(body)).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(countOrderedListItems('')).toBe(0);
  });

  it('counts items across multiple paragraphs', () => {
    const body = [
      'Steps:',
      '',
      '1. First step',
      '2. Second step',
      '',
      'Note: something',
    ].join('\n');
    expect(countOrderedListItems(body)).toBe(2);
  });
});
