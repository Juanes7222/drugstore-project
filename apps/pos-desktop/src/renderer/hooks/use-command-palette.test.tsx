/**
 * Tests for the useCommandPalette hook.
 *
 * The hook owns search logic, keyboard navigation, and side effects for the
 * CommandPalette component.  We mock the two Zustand stores and the search
 * service so the tests stay focused on hook behaviour.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCommandPalette } from './use-command-palette';
import type { IndexableItem } from '../../domain/assistant/assistant-types';

// ---------------------------------------------------------------------------
// Mock state
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
// Mock search index service
// ---------------------------------------------------------------------------

const mockSearch = vi.fn();
const mockBuild = vi.fn();

vi.mock('../../domain/assistant/search-index.service', () => ({
  createSearchIndexService: vi.fn(() => ({
    isBuilt: true,
    build: mockBuild,
    search: mockSearch,
    addOrUpdate: vi.fn(),
    remove: vi.fn(),
    itemCount: 0,
    onBuildStart: vi.fn(),
    onBuildComplete: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockItem(
  overrides: Partial<IndexableItem> = {},
): IndexableItem {
  return {
    category: 'COMMAND',
    id: 'cmd.test',
    label: 'Test Command',
    group: 'Test',
    audience: 'both',
    ...overrides,
  } as IndexableItem;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useCommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAssistantState = {
      paletteOpen: false,
      paletteQuery: '',
      isIndexBuilding: false,
      closePalette: vi.fn(),
      setPaletteQuery: vi.fn(),
    };

    mockUserPreferencesState = {
      addPaletteRecentItem: vi.fn(),
      incrementPaletteUsage: vi.fn(),
    };
  });

  // --- Interface shape ---

  it('returns the expected interface properties', () => {
    const { result } = renderHook(() => useCommandPalette());

    expect(result.current).toHaveProperty('results');
    expect(result.current).toHaveProperty('selectedIndex');
    expect(result.current).toHaveProperty('isSearching');
    expect(result.current).toHaveProperty('searchError');
    expect(result.current).toHaveProperty('groupedResults');
    expect(result.current).toHaveProperty('flatItems');
    expect(result.current).toHaveProperty('isIndexBuilding');
    expect(result.current).toHaveProperty('query');
    expect(result.current).toHaveProperty('handleInputChange');
    expect(result.current).toHaveProperty('handleOpenChange');
    expect(result.current).toHaveProperty('handleKeyDown');
    expect(result.current).toHaveProperty('executeItem');
    expect(result.current).toHaveProperty('closePalette');
  });

  // --- Initial state ---

  it('starts with an empty query and no results', () => {
    const { result } = renderHook(() => useCommandPalette());

    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
    expect(result.current.selectedIndex).toBe(0);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.searchError).toBeNull();
  });

  it('reflects isIndexBuilding from the store', () => {
    mockAssistantState.isIndexBuilding = true;
    const { result } = renderHook(() => useCommandPalette());

    expect(result.current.isIndexBuilding).toBe(true);
  });

  // --- open/close ---

  it('handleOpenChange calls closePalette when open is false', () => {
    const { result } = renderHook(() => useCommandPalette());

    act(() => {
      result.current.handleOpenChange(false);
    });

    expect(mockAssistantState.closePalette).toHaveBeenCalledOnce();
  });

  it('handleOpenChange does nothing when open is true', () => {
    const { result } = renderHook(() => useCommandPalette());

    act(() => {
      result.current.handleOpenChange(true);
    });

    expect(mockAssistantState.closePalette).not.toHaveBeenCalled();
  });

  // --- Input change ---

  it('handleInputChange calls setPaletteQuery with the input value', () => {
    const { result } = renderHook(() => useCommandPalette());

    act(() => {
      result.current.handleInputChange({
        target: { value: 'ibuprofeno' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    expect(mockAssistantState.setPaletteQuery).toHaveBeenCalledWith(
      'ibuprofeno',
    );
  });

  // --- Execute item ---

  it('executeItem calls addPaletteRecentItem and closePalette', () => {
    const { result } = renderHook(() => useCommandPalette());

    const item = createMockItem({ category: 'PAGE', id: 'page-sales' });

    act(() => {
      result.current.executeItem(item);
    });

    expect(mockUserPreferencesState.addPaletteRecentItem).toHaveBeenCalledWith(
      'PAGE:page-sales',
    );
    expect(mockAssistantState.closePalette).toHaveBeenCalledOnce();
  });

  // --- Keyboard navigation ---

  it('selectedIndex starts at 0', () => {
    const { result } = renderHook(() => useCommandPalette());

    expect(result.current.selectedIndex).toBe(0);
  });

  it('ArrowDown increments selectedIndex', async () => {
    const item1 = createMockItem({ category: 'COMMAND', id: 'cmd.1' });
    const item2 = createMockItem({ category: 'COMMAND', id: 'cmd.2' });

    mockSearch.mockReturnValue([item1, item2]);
    mockAssistantState.paletteQuery = 'test';
    const { result } = renderHook(() => useCommandPalette());

    // Wait for debounced search to populate flatItems
    await waitFor(() => {
      expect(result.current.flatItems).toHaveLength(2);
    });

    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(result.current.selectedIndex).toBe(1);
  });

  it('Enter triggers executeItem for the selected item', async () => {
    const item = createMockItem({ category: 'COMMAND', id: 'cmd.test' });

    mockSearch.mockReturnValue([item]);
    mockAssistantState.paletteQuery = 'test';
    const { result } = renderHook(() => useCommandPalette());

    // Wait for debounced search to populate flatItems
    await waitFor(() => {
      expect(result.current.flatItems).toHaveLength(1);
    });

    act(() => {
      result.current.handleKeyDown({
        key: 'Enter',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(mockUserPreferencesState.addPaletteRecentItem).toHaveBeenCalled();
    expect(mockAssistantState.closePalette).toHaveBeenCalledOnce();
  });

  it('ArrowUp wraps to the last item when at the beginning', async () => {
    const item1 = createMockItem({ category: 'COMMAND', id: 'cmd.1' });
    const item2 = createMockItem({ category: 'COMMAND', id: 'cmd.2' });

    mockSearch.mockReturnValue([item1, item2]);
    mockAssistantState.paletteQuery = 'test';
    const { result } = renderHook(() => useCommandPalette());

    // Wait for debounced search to populate flatItems
    await waitFor(() => {
      expect(result.current.flatItems).toHaveLength(2);
    });

    act(() => {
      // selectedIndex is 0, pressing ArrowUp should wrap to length - 1
      result.current.handleKeyDown({
        key: 'ArrowUp',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(result.current.selectedIndex).toBe(1); // flatItems.length - 1 = 1
  });

  it('ArrowDown wraps to 0 when at the last item', async () => {
    const item1 = createMockItem({ category: 'COMMAND', id: 'cmd.1' });
    const item2 = createMockItem({ category: 'COMMAND', id: 'cmd.2' });
    mockSearch.mockReturnValue([item1, item2]);
    mockAssistantState.paletteQuery = 'test';
    const { result } = renderHook(() => useCommandPalette());

    // Wait for debounced search to populate flatItems
    await waitFor(() => {
      expect(result.current.flatItems).toHaveLength(2);
    });

    // Navigate to the last item (index 1)
    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });
    expect(result.current.selectedIndex).toBe(1);

    // ArrowDown at last item wraps to 0
    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });
    expect(result.current.selectedIndex).toBe(0);
  });

  // --- Debounced search effect ---

  it('triggers a search when paletteQuery is set to a non-empty value', async () => {
    const items = [createMockItem({ category: 'PAGE', id: 'page-sales' })];
    mockSearch.mockReturnValue(items);

    // Set query before render so the effect fires immediately
    mockAssistantState.paletteQuery = 'sales';
    const { result } = renderHook(() => useCommandPalette());

    // Wait for the debounce (50ms)
    await waitFor(
      () => {
        expect(result.current.results).toEqual(items);
      },
      { timeout: 200 },
    );
  });

  it('clears results when paletteQuery becomes empty', async () => {
    mockAssistantState.paletteQuery = 'sales';
    const { result, rerender } = renderHook(() => useCommandPalette());

    // Wait for initial search to populate results
    await waitFor(
      () => {
        expect(mockSearch).toHaveBeenCalled();
      },
      { timeout: 200 },
    );

    // Now clear the query
    mockAssistantState.paletteQuery = '';
    rerender();

    await waitFor(
      () => {
        expect(result.current.results).toEqual([]);
      },
      { timeout: 200 },
    );
  });
});
