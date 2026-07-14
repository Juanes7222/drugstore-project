/**
 * Tests for palette helper functions.
 *
 * These are pure functions with no React or DOM dependencies.
 */
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_PRIORITY,
  GROUP_LABEL_KEYS,
  CATEGORY_ICONS,
  getItemLabel,
  getItemDescription,
  getItemShortcut,
  groupResults,
} from './palette-helpers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('CATEGORY_PRIORITY', () => {
  it('defines priority for all seven categories', () => {
    expect(CATEGORY_PRIORITY).toEqual({
      RECENT: 0,
      COMMAND: 1,
      PAGE: 2,
      SALE: 3,
      CLIENT: 4,
      PRODUCT: 5,
      HELP_TOPIC: 6,
    });
  });
});

describe('GROUP_LABEL_KEYS', () => {
  it('defines an i18n key for every category', () => {
    expect(GROUP_LABEL_KEYS.RECENT).toBe('assistant.palette.group_recent');
    expect(GROUP_LABEL_KEYS.COMMAND).toBe('assistant.palette.group_commands');
    expect(GROUP_LABEL_KEYS.PAGE).toBe('assistant.palette.group_pages');
    expect(GROUP_LABEL_KEYS.SALE).toBe('assistant.palette.group_sales');
    expect(GROUP_LABEL_KEYS.CLIENT).toBe('assistant.palette.group_clients');
    expect(GROUP_LABEL_KEYS.PRODUCT).toBe('assistant.palette.group_products');
    expect(GROUP_LABEL_KEYS.HELP_TOPIC).toBe('assistant.palette.group_help');
  });
});

describe('CATEGORY_ICONS', () => {
  it('defines an icon for every category', () => {
    expect(CATEGORY_ICONS.RECENT).toBe('\u21BB');
    expect(CATEGORY_ICONS.COMMAND).toBe('\u2318');
    expect(CATEGORY_ICONS.PAGE).toBe('\u2192');
    expect(CATEGORY_ICONS.SALE).toBe('$');
    expect(CATEGORY_ICONS.CLIENT).toBe('\u{1F464}');
    expect(CATEGORY_ICONS.PRODUCT).toBe('\u{1F48A}');
    expect(CATEGORY_ICONS.HELP_TOPIC).toBe('?');
  });
});

// ---------------------------------------------------------------------------
// getItemLabel
// ---------------------------------------------------------------------------

describe('getItemLabel', () => {
  it('returns label for a PAGE item', () => {
    const item = {
      category: 'PAGE' as const,
      id: 'page-sales',
      label: 'Pantalla de ventas',
      route: 'sales',
    };
    expect(getItemLabel(item)).toBe('Pantalla de ventas');
  });

  it('returns label for a COMMAND item', () => {
    const item = {
      category: 'COMMAND' as const,
      id: 'cmd.new-sale',
      label: 'Nueva venta',
      group: 'Ventas',
      audience: 'both' as const,
    };
    expect(getItemLabel(item)).toBe('Nueva venta');
  });

  it('returns label for a RECENT item', () => {
    const item = {
      category: 'RECENT' as const,
      id: 'recent-1',
      label: 'Recent Item',
      lastUsed: 1000,
      originalCategory: 'PAGE' as const,
      originalId: 'page-sales',
    };
    expect(getItemLabel(item)).toBe('Recent Item');
  });

  it('returns name for a PRODUCT item', () => {
    const item = {
      category: 'PRODUCT' as const,
      id: 'prod-1',
      name: 'Ibuprofeno 400mg',
    };
    expect(getItemLabel(item)).toBe('Ibuprofeno 400mg');
  });

  it('returns name for a CLIENT item', () => {
    const item = {
      category: 'CLIENT' as const,
      id: 'cli-1',
      name: 'Juan Pérez',
    };
    expect(getItemLabel(item)).toBe('Juan Pérez');
  });

  it('returns formatted string for a SALE item', () => {
    const item = {
      category: 'SALE' as const,
      id: 'sale-1',
      localNumber: 42,
      total: 25500,
      status: 'COMPLETED',
    };
    const label = getItemLabel(item);
    expect(label).toContain('#42');
    expect(label).toContain('$');
    expect(label).toContain('255.00');
  });

  it('returns title for a HELP_TOPIC item', () => {
    const item = {
      category: 'HELP_TOPIC' as const,
      id: 'help-sales',
      title: 'Cómo realizar una venta',
      excerpt: 'Guía paso a paso',
    };
    expect(getItemLabel(item)).toBe('Cómo realizar una venta');
  });
});

// ---------------------------------------------------------------------------
// getItemDescription
// ---------------------------------------------------------------------------

describe('getItemDescription', () => {
  it('returns genericName for a PRODUCT when available', () => {
    const item = {
      category: 'PRODUCT' as const,
      id: 'prod-1',
      name: 'Ibuprofeno 400mg',
      genericName: 'Ibuprofeno',
    };
    expect(getItemDescription(item)).toBe('Ibuprofeno');
  });

  it('returns laboratory for a PRODUCT when genericName is absent', () => {
    const item = {
      category: 'PRODUCT' as const,
      id: 'prod-1',
      name: 'Ibuprofeno 400mg',
      laboratory: 'Genfar',
    };
    expect(getItemDescription(item)).toBe('Genfar');
  });

  it('returns null for a PRODUCT when both genericName and laboratory are absent', () => {
    const item = {
      category: 'PRODUCT' as const,
      id: 'prod-1',
      name: 'Ibuprofeno 400mg',
    };
    expect(getItemDescription(item)).toBeNull();
  });

  it('returns document for a CLIENT when available', () => {
    const item = {
      category: 'CLIENT' as const,
      id: 'cli-1',
      name: 'Juan Pérez',
      document: 'CC-12345678',
    };
    expect(getItemDescription(item)).toBe('CC-12345678');
  });

  it('returns phone for a CLIENT when document is absent', () => {
    const item = {
      category: 'CLIENT' as const,
      id: 'cli-1',
      name: 'Juan Pérez',
      phone: '3001234567',
    };
    expect(getItemDescription(item)).toBe('3001234567');
  });

  it('returns null for a CLIENT when both document and phone are absent', () => {
    const item = {
      category: 'CLIENT' as const,
      id: 'cli-1',
      name: 'Juan Pérez',
    };
    expect(getItemDescription(item)).toBeNull();
  });

  it('returns status for a SALE item', () => {
    const item = {
      category: 'SALE' as const,
      id: 'sale-1',
      localNumber: 1,
      total: 1000,
      status: 'COMPLETED',
    };
    expect(getItemDescription(item)).toBe('COMPLETED');
  });

  it('returns excerpt for a HELP_TOPIC item', () => {
    const item = {
      category: 'HELP_TOPIC' as const,
      id: 'help-sales',
      title: 'Cómo realizar una venta',
      excerpt: 'Guía paso a paso para cobrar productos',
    };
    expect(getItemDescription(item)).toBe('Guía paso a paso para cobrar productos');
  });

  it('returns shortcut for a COMMAND when available', () => {
    const item = {
      category: 'COMMAND' as const,
      id: 'cmd.new-sale',
      label: 'Nueva venta',
      shortcut: 'Cmd+N',
      group: 'Ventas',
      audience: 'both' as const,
    };
    expect(getItemDescription(item)).toBe('Cmd+N');
  });

  it('returns null for a COMMAND with no shortcut', () => {
    const item = {
      category: 'COMMAND' as const,
      id: 'cmd.other',
      label: 'Other',
      group: 'Otros',
      audience: 'both' as const,
    };
    expect(getItemDescription(item)).toBeNull();
  });

  it('returns null for a PAGE item', () => {
    const item = {
      category: 'PAGE' as const,
      id: 'page-sales',
      label: 'Sales',
      route: 'sales',
    };
    expect(getItemDescription(item)).toBeNull();
  });

  it('returns null for a RECENT item', () => {
    const item = {
      category: 'RECENT' as const,
      id: 'recent-1',
      label: 'Recent',
      lastUsed: 1000,
      originalCategory: 'PAGE' as const,
      originalId: 'page-sales',
    };
    expect(getItemDescription(item)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getItemShortcut
// ---------------------------------------------------------------------------

describe('getItemShortcut', () => {
  it('returns shortcut for a COMMAND item', () => {
    const item = {
      category: 'COMMAND' as const,
      id: 'cmd.new-sale',
      label: 'Nueva venta',
      shortcut: 'Cmd+N',
      group: 'Ventas',
      audience: 'both' as const,
    };
    expect(getItemShortcut(item)).toBe('Cmd+N');
  });

  it('returns null for a COMMAND with no shortcut', () => {
    const item = {
      category: 'COMMAND' as const,
      id: 'cmd.other',
      label: 'Other',
      group: 'Otros',
      audience: 'both' as const,
    };
    expect(getItemShortcut(item)).toBeNull();
  });

  it('returns null for a non-COMMAND item', () => {
    const item = {
      category: 'PAGE' as const,
      id: 'page-sales',
      label: 'Sales',
      route: 'sales',
    };
    expect(getItemShortcut(item)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// groupResults
// ---------------------------------------------------------------------------

describe('groupResults', () => {
  it('groups items by category', () => {
    const pageItem = { category: 'PAGE' as const, id: 'p1', label: 'Page', route: '/page' };
    const cmdItem = { category: 'COMMAND' as const, id: 'c1', label: 'Cmd', group: 'G', audience: 'both' as const };
    const results = [pageItem, cmdItem];

    const grouped = groupResults(results);

    expect(grouped).toHaveLength(2);
    const pageGroup = grouped.find((g) => g.category === 'PAGE');
    const cmdGroup = grouped.find((g) => g.category === 'COMMAND');
    expect(pageGroup?.items).toEqual([pageItem]);
    expect(cmdGroup?.items).toEqual([cmdItem]);
  });

  it('sorts groups by priority (RECENT first, HELP_TOPIC last)', () => {
    const helpItem = { category: 'HELP_TOPIC' as const, id: 'h1', title: 'Help', excerpt: '...' };
    const recentItem = {
      category: 'RECENT' as const, id: 'r1', label: 'Recent',
      lastUsed: 1000, originalCategory: 'PAGE' as const, originalId: 'p1',
    };
    const cmdItem = { category: 'COMMAND' as const, id: 'c1', label: 'Cmd', group: 'G', audience: 'both' as const };

    const grouped = groupResults([helpItem, cmdItem, recentItem]);

    expect(grouped.map((g) => g.category)).toEqual(['RECENT', 'COMMAND', 'HELP_TOPIC']);
  });

  it('includes labelKey from GROUP_LABEL_KEYS for each group', () => {
    const pageItem = { category: 'PAGE' as const, id: 'p1', label: 'Page', route: '/page' };
    const grouped = groupResults([pageItem]);

    expect(grouped[0].labelKey).toBe('assistant.palette.group_pages');
  });

  it('returns an empty array for empty input', () => {
    expect(groupResults([])).toEqual([]);
  });

  it('merges multiple items of the same category into one group', () => {
    const p1 = { category: 'PAGE' as const, id: 'p1', label: 'Page 1', route: '/p1' };
    const p2 = { category: 'PAGE' as const, id: 'p2', label: 'Page 2', route: '/p2' };

    const grouped = groupResults([p1, p2]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].category).toBe('PAGE');
    expect(grouped[0].items).toHaveLength(2);
  });
});
