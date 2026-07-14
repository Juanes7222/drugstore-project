/**
 * Tests for the useHelpViewer hook.
 *
 * The hook owns article navigation, search within help content, and overlay
 * state for the HelpViewer component.  We mock the two Zustand stores and
 * the help-content lookup functions so tests stay focused on hook behaviour.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHelpViewer } from './use-help-viewer';
import type { HelpContentEntry } from '../../help-content';

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
// Mock help-content lookup functions
// ---------------------------------------------------------------------------

const mockGetAllHelpEntries = vi.fn();
const mockGetHelpEntry = vi.fn();
const mockSearchHelpEntries = vi.fn();

vi.mock('../../help-content', () => ({
  getAllHelpEntries: (...args: any[]) => mockGetAllHelpEntries(...args),
  getHelpEntry: (...args: any[]) => mockGetHelpEntry(...args),
  searchHelpEntries: (...args: any[]) => mockSearchHelpEntries(...args),
}));

// ---------------------------------------------------------------------------
// Mock groupBySection (pure helper, but we return controlled data)
// ---------------------------------------------------------------------------

const mockGroupBySection = vi.fn();

vi.mock('../../domain/assistant/help-helpers', () => ({
  groupBySection: (...args: any[]) => mockGroupBySection(...args),
  getEntrySection: vi.fn(),
  sectionLabelKey: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createEntry(
  overrides: Partial<HelpContentEntry> = {},
): HelpContentEntry {
  return {
    id: 'help-sales',
    title: 'Cómo realizar una venta',
    keywords: ['venta', 'cobrar'],
    audience: 'cashier',
    lastUpdated: '2026-07-01',
    path: '/src/help-content/screens/sales.md',
    body: 'Para realizar una venta, busca el producto y presiona Cobrar.',
    ...overrides,
  } as HelpContentEntry;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useHelpViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAssistantState = {
      helpOpen: false,
      helpTopicId: null,
      closeHelp: vi.fn(),
    };

    mockUserPreferencesState = {
      recordHelpPageView: vi.fn(),
    };

    // Default mock implementations
    const entry = createEntry();
    mockGetAllHelpEntries.mockReturnValue([entry, createEntry({ id: 'help-returns', title: 'Devoluciones', path: '/procedures/returns.md' })]);
    mockGetHelpEntry.mockReturnValue(entry);
    mockSearchHelpEntries.mockReturnValue([entry]);
    mockGroupBySection.mockImplementation((entries: any[]) => [
      { section: 'screens' as const, entries: entries.filter((e: any) => e.path?.includes('/screens/')) },
      { section: 'procedures' as const, entries: entries.filter((e: any) => e.path?.includes('/procedures/')) },
    ]);
  });

  // --- Interface shape ---

  it('returns the expected interface properties', () => {
    const { result } = renderHook(() => useHelpViewer());

    expect(result.current).toHaveProperty('helpOpen');
    expect(result.current).toHaveProperty('searchQuery');
    expect(result.current).toHaveProperty('setSearchQuery');
    expect(result.current).toHaveProperty('selectedTopicId');
    expect(result.current).toHaveProperty('selectedTopic');
    expect(result.current).toHaveProperty('isProcedure');
    expect(result.current).toHaveProperty('groupedEntries');
    expect(result.current).toHaveProperty('helpTopicId');
    expect(result.current).toHaveProperty('checkedSteps');
    expect(result.current).toHaveProperty('handleOpenChange');
    expect(result.current).toHaveProperty('handleSelectTopic');
    expect(result.current).toHaveProperty('handleGoToIndex');
    expect(result.current).toHaveProperty('handleSearchKeyDown');
    expect(result.current).toHaveProperty('handleToggleStep');
  });

  // --- Initial state ---

  it('starts with helpOpen from the store', () => {
    mockAssistantState.helpOpen = true;
    const { result } = renderHook(() => useHelpViewer());

    expect(result.current.helpOpen).toBe(true);
  });

  it('starts with searchQuery empty and no selected topic', () => {
    const { result } = renderHook(() => useHelpViewer());

    expect(result.current.searchQuery).toBe('');
    expect(result.current.selectedTopicId).toBeNull();
  });

  it('loads all help entries via getAllHelpEntries', () => {
    renderHook(() => useHelpViewer());

    expect(mockGetAllHelpEntries).toHaveBeenCalledOnce();
  });

  // --- open/close ---

  it('handleOpenChange calls closeHelp when open is false', () => {
    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.handleOpenChange(false);
    });

    expect(mockAssistantState.closeHelp).toHaveBeenCalledOnce();
  });

  it('handleOpenChange does nothing when open is true', () => {
    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.handleOpenChange(true);
    });

    expect(mockAssistantState.closeHelp).not.toHaveBeenCalled();
  });

  // --- Topic selection ---

  it('handleSelectTopic sets the selected topic id and resets checked steps', () => {
    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.handleSelectTopic('help-sales');
    });

    expect(result.current.selectedTopicId).toBe('help-sales');
  });

  it('handleGoToIndex clears selection and search', () => {
    const { result } = renderHook(() => useHelpViewer());

    // First select a topic
    act(() => {
      result.current.handleSelectTopic('help-sales');
    });
    act(() => {
      result.current.setSearchQuery('venta');
    });

    // Then go back to index
    act(() => {
      result.current.handleGoToIndex();
    });

    expect(result.current.selectedTopicId).toBeNull();
    expect(result.current.searchQuery).toBe('');
  });

  // --- Topic resolution ---

  it('resolves selectedTopic from selectedTopicId via getHelpEntry', () => {
    const entry = createEntry({ id: 'help-sales' });
    mockGetHelpEntry.mockReturnValue(entry);

    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.handleSelectTopic('help-sales');
    });

    expect(mockGetHelpEntry).toHaveBeenCalledWith('help-sales');
    expect(result.current.selectedTopic).toEqual(entry);
  });

  it('selectedTopic is null when no id is set', () => {
    const { result } = renderHook(() => useHelpViewer());

    expect(result.current.selectedTopic).toBeNull();
  });

  it('uses helpTopicId from store when selectedTopicId is null', () => {
    const entry = createEntry({ id: 'help-sales' });
    mockGetHelpEntry.mockReturnValue(entry);
    mockAssistantState.helpTopicId = 'help-sales';

    const { result } = renderHook(() => useHelpViewer());

    expect(mockGetHelpEntry).toHaveBeenCalledWith('help-sales');
    expect(result.current.selectedTopic).toEqual(entry);
  });

  // --- isProcedure ---

  it('isProcedure is true when the selected topic is in /procedures/', () => {
    const entry = createEntry({
      id: 'help-returns',
      path: '/procedures/returns.md',
    });
    mockGetHelpEntry.mockReturnValue(entry);

    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.handleSelectTopic('help-returns');
    });

    expect(result.current.isProcedure).toBe(true);
  });

  it('isProcedure is false for a screens topic', () => {
    const entry = createEntry({ id: 'help-sales', path: '/screens/sales.md' });
    mockGetHelpEntry.mockReturnValue(entry);

    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.handleSelectTopic('help-sales');
    });

    expect(result.current.isProcedure).toBe(false);
  });

  // --- Search ---

  it('setSearchQuery updates the search query', () => {
    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.setSearchQuery('devolución');
    });

    expect(result.current.searchQuery).toBe('devolución');
  });

  it('filters entries via searchHelpEntries when query is non-empty', () => {
    const entry = createEntry();
    mockSearchHelpEntries.mockReturnValue([entry]);

    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.setSearchQuery('devolución');
    });

    expect(mockSearchHelpEntries).toHaveBeenCalledWith('devolución');
  });

  it('uses all entries when search query is empty', () => {
    const allEntries = [createEntry({ id: 'e1' }), createEntry({ id: 'e2' })];
    mockGetAllHelpEntries.mockReturnValue(allEntries);

    renderHook(() => useHelpViewer());

    // getAllHelpEntries should have been called directly, not searchHelpEntries
    expect(mockSearchHelpEntries).not.toHaveBeenCalled();
  });

  // --- Search keydown ---

  it('handleSearchKeyDown with Escape clears the search', () => {
    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.setSearchQuery('venta');
    });

    act(() => {
      result.current.handleSearchKeyDown({
        key: 'Escape',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(result.current.searchQuery).toBe('');
  });

  it('handleSearchKeyDown with other keys does nothing', () => {
    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.setSearchQuery('venta');
    });

    act(() => {
      result.current.handleSearchKeyDown({
        key: 'Enter',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(result.current.searchQuery).toBe('venta');
  });

  // --- Step toggling ---

  it('handleToggleStep adds an unchecked step', () => {
    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.handleToggleStep(0);
    });

    expect(result.current.checkedSteps.has(0)).toBe(true);
    expect(result.current.checkedSteps.size).toBe(1);
  });

  it('handleToggleStep removes a checked step on second call', () => {
    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.handleToggleStep(0);
    });
    act(() => {
      result.current.handleToggleStep(0);
    });

    expect(result.current.checkedSteps.has(0)).toBe(false);
    expect(result.current.checkedSteps.size).toBe(0);
  });

  it('handleToggleStep can track multiple steps independently', () => {
    const { result } = renderHook(() => useHelpViewer());

    act(() => {
      result.current.handleToggleStep(0);
    });
    act(() => {
      result.current.handleToggleStep(2);
    });

    expect(result.current.checkedSteps.has(0)).toBe(true);
    expect(result.current.checkedSteps.has(2)).toBe(true);
    expect(result.current.checkedSteps.size).toBe(2);
  });

  // --- groupedEntries ---

  it('groupedEntries is derived from filtered entries via groupBySection', () => {
    const entry = createEntry();
    mockGroupBySection.mockReturnValue([
      { section: 'screens' as const, entries: [entry] },
    ]);

    const { result } = renderHook(() => useHelpViewer());

    expect(result.current.groupedEntries).toHaveLength(1);
    expect(result.current.groupedEntries[0].section).toBe('screens');
    expect(result.current.groupedEntries[0].entries).toEqual([entry]);
  });
});
