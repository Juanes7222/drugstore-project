/**
 * Command palette hook — owns all state, search logic, keyboard navigation,
 * and side effects for the CommandPalette component.
 *
 * Extracted from the monolithic command-palette.tsx so that the logic can be
 * unit-tested without rendering the full dialog tree.
 */

import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { IndexableItem } from '../../domain/assistant/assistant-types';
import { createSearchIndexService } from '../../domain/assistant/search-index.service';
import { useAssistantStore } from '../../stores/assistant.store';
import { useUserPreferencesStore } from '../../stores/user-preferences.store';
import { groupResults } from '../../domain/assistant/palette-helpers';
import type { GroupedResult } from '../../domain/assistant/palette-helpers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Debounce delay before triggering a search. */
const SEARCH_DEBOUNCE_MS = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseCommandPaletteReturn {
  /** The raw list of search results. */
  results: IndexableItem[];
  /** Currently selected index for keyboard navigation. */
  selectedIndex: number;
  /** Whether a search is in progress. */
  isSearching: boolean;
  /** Search error message, if any. */
  searchError: string | null;
  /** Results grouped and sorted by category. */
  groupedResults: GroupedResult[];
  /** Flat list for keyboard navigation indexing. */
  flatItems: IndexableItem[];
  /** Whether the search index is still building. */
  isIndexBuilding: boolean;
  /** The current search query. */
  query: string;
  /** Ref for the search input element. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Ref for the results list container. */
  listRef: React.RefObject<HTMLDivElement | null>;
  /** Call when the search input value changes. */
  handleInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Call when the dialog open state changes. */
  handleOpenChange: (open: boolean) => void;
  /** Call on keydown events for keyboard navigation. */
  handleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** Execute the action associated with a selected item. */
  executeItem: (item: IndexableItem) => void;
  /** Close the palette. */
  closePalette: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCommandPalette(): UseCommandPaletteReturn {
  // -- Store state --
  const paletteOpen = useAssistantStore((s) => s.paletteOpen);
  const paletteQuery = useAssistantStore((s) => s.paletteQuery);
  const isIndexBuilding = useAssistantStore((s) => s.isIndexBuilding);
  const closePalette = useAssistantStore((s) => s.closePalette);
  const setPaletteQuery = useAssistantStore((s) => s.setPaletteQuery);

  const addPaletteRecentItem = useUserPreferencesStore(
    (s) => s.addPaletteRecentItem,
  );
  const incrementPaletteUsage = useUserPreferencesStore(
    (s) => s.incrementPaletteUsage,
  );

  // -- Local state --
  const [results, setResults] = useState<IndexableItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchServiceRef = useRef<ReturnType<typeof createSearchIndexService> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -- Execute a selected item --
  const executeItem = useCallback(
    (item: IndexableItem) => {
      addPaletteRecentItem(`${item.category}:${item.id}`);
      closePalette();

      if (item.category === 'COMMAND') {
        import('../../domain/assistant/commands').then(
          ({ COMMANDS }) => {
            const command = COMMANDS.find(
              (cmd) => cmd.id === item.id,
            );
            if (command) {
              command.execute();
            }
          },
        );
      }
    },
    [addPaletteRecentItem, closePalette],
  );

  // -- Perform search --
  const performSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setResults([]);
        setSelectedIndex(0);
        setIsSearching(false);
        setSearchError(null);
        return;
      }

      setIsSearching(true);
      setSearchError(null);

      try {
        const svc = searchServiceRef.current ?? createSearchIndexService();
        searchServiceRef.current = svc;

        if (!svc.isBuilt) {
          await svc.build();
        }

        const searchResults = svc.search(query);
        setResults(searchResults);
        setSelectedIndex(0);
      } catch (err) {
        setSearchError(
          err instanceof Error ? err.message : String(err),
        );
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [],
  );

  // -- Debounced search effect --
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSearch(paletteQuery);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [paletteQuery, performSearch]);

  // -- Reset state on open --
  useEffect(() => {
    if (paletteOpen) {
      setResults([]);
      setSelectedIndex(0);
      setSearchError(null);
      setIsSearching(false);
      incrementPaletteUsage();

      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [paletteOpen, incrementPaletteUsage]);

  // -- Group results --
  const groupedResults = useMemo(
    () => groupResults(results),
    [results],
  );

  // -- Flat items for keyboard navigation --
  const flatItems = useMemo(
    () => groupedResults.flatMap((group) => group.items),
    [groupedResults],
  );

  // -- Input change handler --
  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPaletteQuery(event.target.value);
    },
    [setPaletteQuery],
  );

  // -- Dialog open change handler --
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closePalette();
      }
    },
    [closePalette],
  );

  // -- Keyboard navigation --
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev < flatItems.length - 1 ? prev + 1 : 0,
        );
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : flatItems.length - 1,
        );
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const selectedItem = flatItems[selectedIndex];
        if (selectedItem) {
          executeItem(selectedItem);
        }
      }
    },
    [flatItems, selectedIndex, executeItem],
  );

  // -- Scroll selected item into view --
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const items = listRef.current.querySelectorAll<HTMLElement>(
        '[data-palette-item]',
      );
      const target = items[selectedIndex];
      if (target) {
        target.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  return {
    results,
    selectedIndex,
    isSearching,
    searchError,
    groupedResults,
    flatItems,
    isIndexBuilding,
    query: paletteQuery,
    inputRef,
    listRef,
    handleInputChange,
    handleOpenChange,
    handleKeyDown,
    executeItem,
    closePalette,
  };
}
