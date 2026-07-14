/**
 * Tests for the useShortcutCheatsheet hook.
 *
 * The hook owns search filtering, capture mode, restore defaults, and
 * effective binding computation for the ShortcutCheatsheet component.
 * We mock the two Zustand stores, the shortcut manager, and the
 * isModifierOnly helper so tests stay focused on hook behaviour.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShortcutCheatsheet } from './use-shortcut-cheatsheet';
import type { ShortcutBinding, ShortcutContext } from '../../domain/assistant/assistant-types';
import { isModifierOnly } from '../../domain/assistant/shortcut-helpers';

// ---------------------------------------------------------------------------
// Mock Zustand stores
// ---------------------------------------------------------------------------

let mockAssistantState: Record<string, any>;
let mockUserPreferencesState: Record<string, any>;

vi.mock('../../stores/assistant.store', () => ({
  useAssistantStore: vi.fn((selector: any) => selector(mockAssistantState)),
}));

vi.mock('../../stores/user-preferences.store', () => ({
  useUserPreferencesStore: vi.fn(
    (selector: any) => selector(mockUserPreferencesState),
  ),
}));

// ---------------------------------------------------------------------------
// Mock shortcut manager
// ---------------------------------------------------------------------------

const mockGetBindings = vi.fn();
const mockNormalizeEvent = vi.fn();
const mockFindBindingByKey = vi.fn();

vi.mock('../../domain/assistant/shortcut-manager', () => ({
  createShortcutManager: vi.fn(() => ({
    getBindings: mockGetBindings,
    normalizeEvent: mockNormalizeEvent,
    findBindingByKey: mockFindBindingByKey,
    findBindingByCommandId: vi.fn(),
    getBindingsForContext: vi.fn(),
    getBindingsForContexts: vi.fn(),
    registerCustomBinding: vi.fn(),
    shouldSuppress: vi.fn(),
    isGlobalShortcut: vi.fn(),
    applyUserOverrides: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Mock isModifierOnly
// ---------------------------------------------------------------------------

vi.mock('../../domain/assistant/shortcut-helpers', () => ({
  CONTEXT_ORDER: [
    'GLOBAL',
    'SALE_FLOW',
    'SHIFT_OPEN',
    'MANAGER_ONLY',
    'TEXT_INPUT',
    'MODAL_OPEN',
  ],
  isModifierOnly: vi.fn(),
  formatCombo: vi.fn((k: string) => k),
  GROUP_LABEL_KEYS: {},
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createBinding(overrides: Partial<ShortcutBinding> = {}): ShortcutBinding {
  return {
    id: 'shortcut.test',
    key: 'Cmd+K',
    commandId: 'cmd.test',
    context: 'GLOBAL' as ShortcutContext,
    description: 'Test shortcut',
    ...overrides,
  };
}

const DEFAULT_BINDINGS: ShortcutBinding[] = [
  createBinding({ id: 'shortcut.palette', key: 'Cmd+K', commandId: 'cmd.open-palette', description: 'Abrir paleta' }),
  createBinding({ id: 'shortcut.new-sale', key: 'Cmd+N', commandId: 'cmd.new-sale', context: 'SALE_FLOW', description: 'Nueva venta' }),
  createBinding({ id: 'shortcut.sync', key: 'Cmd+Shift+S', commandId: 'cmd.sync-now', description: 'Sincronizar' }),
];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useShortcutCheatsheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAssistantState = {
      cheatsheetOpen: false,
      closeCheatsheet: vi.fn(),
    };

    mockUserPreferencesState = {
      customShortcuts: {},
      setCustomShortcut: vi.fn(),
      removeCustomShortcut: vi.fn(),
    };

    mockGetBindings.mockReturnValue(DEFAULT_BINDINGS);
    vi.mocked(isModifierOnly).mockReturnValue(false);

    mockNormalizeEvent.mockReturnValue('');
  });

  // --- Interface shape ---

  it('returns the expected interface properties', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    expect(result.current).toHaveProperty('cheatsheetOpen');
    expect(result.current).toHaveProperty('searchQuery');
    expect(result.current).toHaveProperty('setSearchQuery');
    expect(result.current).toHaveProperty('capturingId');
    expect(result.current).toHaveProperty('conflictDescription');
    expect(result.current).toHaveProperty('effectiveBindings');
    expect(result.current).toHaveProperty('filteredBindings');
    expect(result.current).toHaveProperty('groupedBindings');
    expect(result.current).toHaveProperty('isCustom');
    expect(result.current).toHaveProperty('defaultKeyForCommand');
    expect(result.current).toHaveProperty('startCapture');
    expect(result.current).toHaveProperty('cancelCapture');
    expect(result.current).toHaveProperty('restoreDefault');
    expect(result.current).toHaveProperty('handleSearchChange');
    expect(result.current).toHaveProperty('handleOpenChange');
  });

  // --- Initial state ---

  it('reflects cheatsheetOpen from the store', () => {
    mockAssistantState.cheatsheetOpen = true;
    const { result } = renderHook(() => useShortcutCheatsheet());

    expect(result.current.cheatsheetOpen).toBe(true);
  });

  it('starts with no capture and no conflict', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    expect(result.current.capturingId).toBeNull();
    expect(result.current.conflictDescription).toBeNull();
  });

  it('starts with an empty search query', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    expect(result.current.searchQuery).toBe('');
  });

  // --- Effective bindings ---

  it('effectiveBindings equals default bindings when no overrides exist', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    expect(result.current.effectiveBindings).toEqual(DEFAULT_BINDINGS);
  });

  it('effectiveBindings applies custom shortcut overrides', () => {
    mockUserPreferencesState.customShortcuts = {
      'cmd.open-palette': 'Alt+P',
    };

    const { result } = renderHook(() => useShortcutCheatsheet());

    const paletteBinding = result.current.effectiveBindings.find(
      (b) => b.commandId === 'cmd.open-palette',
    );
    expect(paletteBinding?.key).toBe('Alt+P');
  });

  it('effectiveBindings leaves non-overridden bindings unchanged', () => {
    mockUserPreferencesState.customShortcuts = {
      'cmd.open-palette': 'Alt+P',
    };

    const { result } = renderHook(() => useShortcutCheatsheet());

    const saleBinding = result.current.effectiveBindings.find(
      (b) => b.commandId === 'cmd.new-sale',
    );
    expect(saleBinding?.key).toBe('Cmd+N');
  });

  // --- Filtered bindings ---

  it('filteredBindings equals effectiveBindings when search is empty', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    expect(result.current.filteredBindings).toEqual(
      result.current.effectiveBindings,
    );
  });

  it('filteredBindings filters by key when search matches', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.setSearchQuery('cmd+k');
    });

    expect(result.current.filteredBindings).toHaveLength(1);
    expect(result.current.filteredBindings[0].commandId).toBe(
      'cmd.open-palette',
    );
  });

  it('filteredBindings filters by description when search matches', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.setSearchQuery('nueva');
    });

    expect(result.current.filteredBindings).toHaveLength(1);
    expect(result.current.filteredBindings[0].commandId).toBe('cmd.new-sale');
  });

  it('filteredBindings returns empty array when no bindings match', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.setSearchQuery('zzzno_match');
    });

    expect(result.current.filteredBindings).toEqual([]);
  });

  // --- Search input handler ---

  it('handleSearchChange updates the search query', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.handleSearchChange({
        target: { value: 'sync' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.searchQuery).toBe('sync');
  });

  // --- Grouped bindings ---

  it('groupedBindings groups filtered bindings by context in CONTEXT_ORDER', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    expect(result.current.groupedBindings).toHaveLength(2); // GLOBAL and SALE_FLOW
    expect(result.current.groupedBindings[0].context).toBe('GLOBAL');
    expect(result.current.groupedBindings[1].context).toBe('SALE_FLOW');
  });

  it('groupedBindings only includes contexts that have matching bindings', () => {
    // Only GLOBAL bindings after filtering
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.setSearchQuery('cmd+k');
    });

    expect(result.current.groupedBindings).toHaveLength(1);
    expect(result.current.groupedBindings[0].context).toBe('GLOBAL');
  });

  // --- open/close ---

  it('handleOpenChange calls closeCheatsheet when open is false', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.handleOpenChange(false);
    });

    expect(mockAssistantState.closeCheatsheet).toHaveBeenCalledOnce();
  });

  it('handleOpenChange resets state when closing', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.setSearchQuery('sync');
    });

    act(() => {
      result.current.handleOpenChange(false);
    });

    expect(mockAssistantState.closeCheatsheet).toHaveBeenCalledOnce();
  });

  it('handleOpenChange does nothing when open is true', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.handleOpenChange(true);
    });

    expect(mockAssistantState.closeCheatsheet).not.toHaveBeenCalled();
  });

  // --- Capture mode ---

  it('startCapture sets the capturingId', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.startCapture('cmd.open-palette');
    });

    expect(result.current.capturingId).toBe('cmd.open-palette');
    expect(result.current.conflictDescription).toBeNull();
  });

  it('cancelCapture clears capturingId and conflict', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.startCapture('cmd.open-palette');
    });
    act(() => {
      result.current.cancelCapture();
    });

    expect(result.current.capturingId).toBeNull();
    expect(result.current.conflictDescription).toBeNull();
  });

  it('capture mode document listener calls setCustomShortcut on valid keydown', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.startCapture('cmd.open-palette');
    });

    mockNormalizeEvent.mockReturnValue('Alt+P');

    // Dispatch a keydown event
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'p', altKey: true });
      document.dispatchEvent(event);
    });

    expect(mockUserPreferencesState.setCustomShortcut).toHaveBeenCalledWith(
      'cmd.open-palette',
      'Alt+P',
    );
    expect(result.current.capturingId).toBeNull();
  });

  it('capture mode ignores modifier-only events', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.startCapture('cmd.open-palette');
    });

    vi.mocked(isModifierOnly).mockReturnValue(true);

    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Meta' });
      document.dispatchEvent(event);
    });

    expect(mockUserPreferencesState.setCustomShortcut).not.toHaveBeenCalled();
    expect(result.current.capturingId).toBe('cmd.open-palette');
  });

  it('capture mode exits on Escape', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.startCapture('cmd.open-palette');
    });

    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);
    });

    expect(result.current.capturingId).toBeNull();
    expect(mockUserPreferencesState.setCustomShortcut).not.toHaveBeenCalled();
  });

  // --- isCustom ---

  it('isCustom returns true for commands with a custom shortcut', () => {
    mockUserPreferencesState.customShortcuts = {
      'cmd.open-palette': 'Alt+P',
    };

    const { result } = renderHook(() => useShortcutCheatsheet());

    expect(result.current.isCustom('cmd.open-palette')).toBe(true);
    expect(result.current.isCustom('cmd.new-sale')).toBe(false);
  });

  // --- defaultKeyForCommand ---

  it('defaultKeyForCommand returns the default key for a known command', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    expect(result.current.defaultKeyForCommand('cmd.open-palette')).toBe(
      'Cmd+K',
    );
    expect(result.current.defaultKeyForCommand('cmd.nonexistent')).toBeUndefined();
  });

  // --- restoreDefault ---

  it('restoreDefault calls removeCustomShortcut with the command id', () => {
    const { result } = renderHook(() => useShortcutCheatsheet());

    act(() => {
      result.current.restoreDefault('cmd.open-palette');
    });

    expect(
      mockUserPreferencesState.removeCustomShortcut,
    ).toHaveBeenCalledWith('cmd.open-palette');
  });
});
