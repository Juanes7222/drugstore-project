/**
 * Pure helper functions extracted from the CommandPalette component.
 *
 * These operate on indexable search results and have no React or DOM
 * dependencies, making them directly unit-testable.
 */

import type { IndexableItem } from './assistant-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Display priority for each category (lower = higher). */
export const CATEGORY_PRIORITY: Record<IndexableItem['category'], number> = {
  RECENT: 0,
  COMMAND: 1,
  PAGE: 2,
  SALE: 3,
  CLIENT: 4,
  PRODUCT: 5,
  HELP_TOPIC: 6,
};

/** Human-readable group labels mapped to i18n keys. */
export const GROUP_LABEL_KEYS: Record<IndexableItem['category'], string> = {
  RECENT: 'assistant.palette.group_recent',
  COMMAND: 'assistant.palette.group_commands',
  PAGE: 'assistant.palette.group_pages',
  SALE: 'assistant.palette.group_sales',
  CLIENT: 'assistant.palette.group_clients',
  PRODUCT: 'assistant.palette.group_products',
  HELP_TOPIC: 'assistant.palette.group_help',
};

/** Icon label for each category (used as a simple text indicator). */
export const CATEGORY_ICONS: Record<IndexableItem['category'], string> = {
  RECENT: '\u21BB',
  COMMAND: '\u2318',
  PAGE: '\u2192',
  SALE: '$',
  CLIENT: '\u{1F464}',
  PRODUCT: '\u{1F48A}',
  HELP_TOPIC: '?',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get a display label for an indexable item, regardless of its category. */
export function getItemLabel(item: IndexableItem): string {
  switch (item.category) {
    case 'PAGE':
    case 'COMMAND':
    case 'RECENT':
      return item.label;
    case 'PRODUCT':
      return item.name;
    case 'CLIENT':
      return item.name;
    case 'SALE':
      return `#${item.localNumber} \u2014 $${(item.total / 100).toFixed(2)}`;
    case 'HELP_TOPIC':
      return item.title;
  }
}

/** Get a secondary description for an item (shown below the label). */
export function getItemDescription(item: IndexableItem): string | null {
  switch (item.category) {
    case 'PRODUCT':
      return item.genericName ?? item.laboratory ?? null;
    case 'CLIENT':
      return item.document ?? item.phone ?? null;
    case 'SALE':
      return item.status;
    case 'HELP_TOPIC':
      return item.excerpt;
    case 'COMMAND':
      return item.shortcut ?? null;
    case 'PAGE':
      return null;
    case 'RECENT':
      return null;
  }
}

/** Get the shortcut string for a command item. */
export function getItemShortcut(item: IndexableItem): string | null {
  if (item.category === 'COMMAND') {
    return item.shortcut ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface GroupedResult {
  category: IndexableItem['category'];
  items: IndexableItem[];
  labelKey: string;
}

/**
 * Group results by category, sorted by display priority (RECENT first).
 */
export function groupResults(results: IndexableItem[]): GroupedResult[] {
  const groups = new Map<IndexableItem['category'], IndexableItem[]>();

  for (const item of results) {
    const existing = groups.get(item.category);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.category, [item]);
    }
  }

  // Sort groups by the fixed priority order
  const sorted = Array.from(groups.entries()).sort(
    ([a], [b]) =>
      (CATEGORY_PRIORITY[a] ?? 99) - (CATEGORY_PRIORITY[b] ?? 99),
  );

  return sorted.map(([category, items]) => ({
    category,
    items,
    labelKey: GROUP_LABEL_KEYS[category],
  }));
}
