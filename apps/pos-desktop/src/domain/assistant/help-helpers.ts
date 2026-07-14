/**
 * Pure helper functions for the help viewer, extracted from the monolithic
 * help-viewer.tsx so they can be unit-tested without rendering React.
 */

import type { HelpContentEntry } from '../../help-content';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntrySection = 'screens' | 'procedures' | 'general';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

/** Determine which section a help entry belongs to based on its file path. */
export function getEntrySection(entry: HelpContentEntry): EntrySection {
  if (entry.path.includes('/screens/')) return 'screens';
  if (entry.path.includes('/procedures/')) return 'procedures';
  return 'general';
}

/** Format an ISO date string to a locale-friendly short date. */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Check whether a date string is older than six months. */
export function isOlderThanSixMonths(iso: string): boolean {
  try {
    return Date.now() - new Date(iso).getTime() > SIX_MONTHS_MS;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface EntryGroup {
  section: EntrySection;
  entries: HelpContentEntry[];
}

/** Group an array of entries by section, preserving a stable order. */
export function groupBySection(
  entries: HelpContentEntry[],
): EntryGroup[] {
  const map = new Map<EntrySection, HelpContentEntry[]>();
  for (const entry of entries) {
    const section = getEntrySection(entry);
    const list = map.get(section);
    if (list) {
      list.push(entry);
    } else {
      map.set(section, [entry]);
    }
  }
  const order: EntrySection[] = ['screens', 'procedures', 'general'];
  const result: EntryGroup[] = [];
  for (const section of order) {
    const items = map.get(section);
    if (items && items.length > 0) {
      result.push({ section, entries: items });
    }
  }
  return result;
}

/** Translate a section type to an i18n key. */
export function sectionLabelKey(section: EntrySection): string {
  switch (section) {
    case 'screens':
      return 'assistant.help.screens';
    case 'procedures':
      return 'assistant.help.procedures';
    case 'general':
      return 'assistant.help.general';
  }
}

/** Count the number of ordered list items in a markdown body. */
export function countOrderedListItems(body: string): number {
  const matches = body.match(/^\d+\.\s+/gm);
  return matches ? matches.length : 0;
}
