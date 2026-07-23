/**
 * Tests for audit-event-registry — single source of truth for event configs.
 *
 * Verifies all 42+ event configs are well-formed, every module is represented,
 * and the fallback behaviour for unknown actions does not silently hide data.
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIT_EVENT_CONFIGS,
  EVENT_FILTER_OPTIONS,
  getEventConfig,
  resolveIcon,
  CATEGORY_META,
  type EventModule,
} from './audit-event-registry';

// ---------------------------------------------------------------------------
// Config completeness
// ---------------------------------------------------------------------------

describe('AUDIT_EVENT_CONFIGS', () => {
  const configs = Object.values(AUDIT_EVENT_CONFIGS);
  const actions = Object.keys(AUDIT_EVENT_CONFIGS);

  it('has at least 42 defined events (count may grow as new events are added)', () => {
    expect(configs.length).toBeGreaterThanOrEqual(42);
  });

  it('every config has a non-empty action string matching its key', () => {
    for (const [key, cfg] of Object.entries(AUDIT_EVENT_CONFIGS)) {
      expect(cfg.action, `action missing for ${key}`).toBe(key);
      expect(cfg.action).toBeTruthy();
    }
  });

  it('every config has a labelKey starting with audit_events.', () => {
    for (const cfg of configs) {
      expect(cfg.labelKey).toMatch(/^audit_events\./);
    }
  });

  it('every config has a category that exists in CATEGORY_META', () => {
    for (const cfg of configs) {
      expect(
        CATEGORY_META[cfg.category],
        `category "${cfg.category}" for ${cfg.action} not found in CATEGORY_META`,
      ).toBeDefined();
    }
  });

  it('every config has a non-empty icon string', () => {
    for (const cfg of configs) {
      expect(cfg.icon, `icon missing for ${cfg.action}`).toBeTruthy();
      // Icon name should be PascalCase (lucide convention)
      expect(cfg.icon[0], `icon "${cfg.icon}" for ${cfg.action} should start with uppercase`).toBe(
        cfg.icon[0].toUpperCase(),
      );
    }
  });

  // ── BUG-PREVENTION: module is never undefined/null ────────────────────

  it('NO config has module undefined or null', () => {
    for (const cfg of configs) {
      expect(
        cfg.module,
        `module is ${String(cfg.module)} for ${cfg.action}`,
      ).toBeDefined();
    }
  });

  it('every config module is one of the 9 valid EventModule values', () => {
    const validModules: EventModule[] = [
      'AUTH_USERS',
      'INVENTORY',
      'CASH_SHIFT',
      'SALES',
      'CLIENTS',
      'PRESCRIPTIONS',
      'PURCHASES',
      'FISCAL',
      'SYNC',
    ];
    for (const cfg of configs) {
      expect(
        validModules,
        `module "${cfg.module}" for ${cfg.action} is not a valid EventModule`,
      ).toContain(cfg.module);
    }
  });

  // ── No duplicate action keys ─────────────────────────────────────────

  it('has no duplicate action keys', () => {
    const unique = new Set(actions);
    expect(unique.size).toBe(actions.length);
  });
});

// ---------------------------------------------------------------------------
// Module coverage
// ---------------------------------------------------------------------------

describe('module coverage', () => {
  it('has events for AUTH_USERS module', () => {
    const authEvents = Object.values(AUDIT_EVENT_CONFIGS).filter(
      (c) => c.module === 'AUTH_USERS',
    );
    expect(authEvents.length).toBeGreaterThan(0);
  });

  it('has events for INVENTORY module', () => {
    const invEvents = Object.values(AUDIT_EVENT_CONFIGS).filter(
      (c) => c.module === 'INVENTORY',
    );
    expect(invEvents.length).toBeGreaterThan(0);
  });

  it('has events for CASH_SHIFT module', () => {
    const events = Object.values(AUDIT_EVENT_CONFIGS).filter(
      (c) => c.module === 'CASH_SHIFT',
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it('has events for SALES module', () => {
    const events = Object.values(AUDIT_EVENT_CONFIGS).filter(
      (c) => c.module === 'SALES',
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it('has events for CLIENTS module', () => {
    const events = Object.values(AUDIT_EVENT_CONFIGS).filter(
      (c) => c.module === 'CLIENTS',
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it('has events for PRESCRIPTIONS module', () => {
    const events = Object.values(AUDIT_EVENT_CONFIGS).filter(
      (c) => c.module === 'PRESCRIPTIONS',
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it('has events for PURCHASES module', () => {
    const events = Object.values(AUDIT_EVENT_CONFIGS).filter(
      (c) => c.module === 'PURCHASES',
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it('has events for FISCAL module', () => {
    const events = Object.values(AUDIT_EVENT_CONFIGS).filter(
      (c) => c.module === 'FISCAL',
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it('has events for SYNC module', () => {
    const events = Object.values(AUDIT_EVENT_CONFIGS).filter(
      (c) => c.module === 'SYNC',
    );
    expect(events.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// EVENT_FILTER_OPTIONS
// ---------------------------------------------------------------------------

describe('EVENT_FILTER_OPTIONS', () => {
  it('is derived from AUDIT_EVENT_CONFIGS (no extra items)', () => {
    const filterable = Object.values(AUDIT_EVENT_CONFIGS).filter(
      (c) => c.showInFilter !== false,
    );
    expect(EVENT_FILTER_OPTIONS.length).toBe(filterable.length);
  });

  it('excludes configs with showInFilter: false', () => {
    const excluded = Object.values(AUDIT_EVENT_CONFIGS).filter(
      (c) => c.showInFilter === false,
    );
    for (const exc of excluded) {
      const found = EVENT_FILTER_OPTIONS.find((o) => o.action === exc.action);
      expect(found, `excluded event ${exc.action} found in EVENT_FILTER_OPTIONS`).toBeUndefined();
    }
  });

  it('every EVENT_FILTER_OPTIONS entry has a REAL config', () => {
    for (const opt of EVENT_FILTER_OPTIONS) {
      expect(
        AUDIT_EVENT_CONFIGS[opt.action],
        `EVENT_FILTER_OPTIONS contains orphaned action "${opt.action}"`,
      ).toBeDefined();
    }
  });

  it('contains events from all 9 modules', () => {
    const modulesInFilter = new Set(EVENT_FILTER_OPTIONS.map((o) => o.module));
    expect(modulesInFilter.has('AUTH_USERS')).toBe(true);
    expect(modulesInFilter.has('INVENTORY')).toBe(true);
    expect(modulesInFilter.has('CASH_SHIFT')).toBe(true);
    expect(modulesInFilter.has('SALES')).toBe(true);
    expect(modulesInFilter.has('CLIENTS')).toBe(true);
    expect(modulesInFilter.has('PRESCRIPTIONS')).toBe(true);
    expect(modulesInFilter.has('PURCHASES')).toBe(true);
    expect(modulesInFilter.has('FISCAL')).toBe(true);
    expect(modulesInFilter.has('SYNC')).toBe(true);
  });

  it('is sorted by labelKey alphabetically', () => {
    for (let i = 1; i < EVENT_FILTER_OPTIONS.length; i++) {
      const prev = EVENT_FILTER_OPTIONS[i - 1].labelKey;
      const curr = EVENT_FILTER_OPTIONS[i].labelKey;
      expect(
        prev.localeCompare(curr),
        `EVENT_FILTER_OPTIONS not sorted at index ${i}: ${prev} vs ${curr}`,
      ).toBeLessThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getEventConfig — fallback for unknown actions
// ---------------------------------------------------------------------------

describe('getEventConfig fallback', () => {
  it('returns a valid config for known actions', () => {
    const cfg = getEventConfig('CASH_SHIFT_OPENED');
    expect(cfg.action).toBe('CASH_SHIFT_OPENED');
    expect(cfg.module).toBe('CASH_SHIFT');
    expect(cfg.category).toBe('cashShift');
  });

  it('returns fallback config for unknown actions', () => {
    const cfg = getEventConfig('UNKNOWN_EVENT_999');
    expect(cfg.action).toBe('UNKNOWN_EVENT_999');
    // Fallback defaults
    expect(cfg.category).toBe('default');
    expect(cfg.icon).toBe('Package');
    // BUG-REVEALING: fallback defaults to AUTH_USERS module
    // If an unknown action is stored locally with a non-AUTH_USERS module,
    // the UI filter dropdown will hide it under AUTH_USERS incorrectly.
    expect(cfg.module).toBeUndefined();
  });

  it('fallback config has a labelKey derived from action', () => {
    const cfg = getEventConfig('SOME_RANDOM_EVENT');
    expect(cfg.labelKey).toBe('audit_events.SOME_RANDOM_EVENT');
  });

  it('fallback category "default" has a color in CATEGORY_META', () => {
    expect(CATEGORY_META.default).toBeDefined();
    expect(CATEGORY_META.default.color).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// resolveIcon
// ---------------------------------------------------------------------------

describe('resolveIcon', () => {
  it('returns a component for every icon name referenced in configs', () => {
    const usedIcons = new Set(Object.values(AUDIT_EVENT_CONFIGS).map((c) => c.icon));
    for (const iconName of usedIcons) {
      const Icon = resolveIcon(iconName);
      expect(Icon).toBeDefined();
    }
  });

  it('returns fallback icon for unknown icon name', () => {
    const Icon = resolveIcon('NonExistentIcon');
    expect(Icon).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Category meta consistency
// ---------------------------------------------------------------------------

describe('CATEGORY_META', () => {
  it('has an entry for every category used in any config', () => {
    const usedCategories = new Set(
      Object.values(AUDIT_EVENT_CONFIGS).map((c) => c.category),
    );
    for (const cat of usedCategories) {
      expect(
        CATEGORY_META[cat],
        `no CATEGORY_META entry for category "${cat}"`,
      ).toBeDefined();
    }
  });

  it('every meta entry has a non-empty color', () => {
    for (const [cat, meta] of Object.entries(CATEGORY_META)) {
      expect(meta.color, `missing color for category "${cat}"`).toBeTruthy();
    }
  });
});
