/**
 * Help viewer hook — owns all state, search logic, effects, and handlers
 * for the HelpViewer component.
 *
 * Extracted from the monolithic help-viewer.tsx so the logic can be
 * unit-tested without rendering the full dialog tree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HelpContentEntry } from '../../help-content';
import {
  getAllHelpEntries,
  getHelpEntry,
  searchHelpEntries,
} from '../../help-content';
import { useAssistantStore } from '../../stores/assistant.store';
import { useUserPreferencesStore } from '../../stores/user-preferences.store';
import { groupBySection } from '../../domain/assistant/help-helpers';
import type { EntryGroup } from '../../domain/assistant/help-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseHelpViewerReturn {
  /** Whether the help dialog is open. */
  helpOpen: boolean;
  /** Current search query text. */
  searchQuery: string;
  /** Set the search query. */
  setSearchQuery: (query: string) => void;
  /** ID of the currently selected topic, or null for index view. */
  selectedTopicId: string | null;
  /** The currently selected topic entry, or null. */
  selectedTopic: HelpContentEntry | null;
  /** Whether the selected topic is a procedure. */
  isProcedure: boolean;
  /** All help entries grouped by section (filtered by search). */
  groupedEntries: EntryGroup[];
  /** Help entry ID from the store (external navigation). */
  helpTopicId: string | null;
  /** Set of checked step indices for procedure checklists. */
  checkedSteps: Set<number>;
  /** Ref for the search input element. */
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  /** Call when the dialog open state changes. */
  handleOpenChange: (open: boolean) => void;
  /** Call when a topic is selected from the sidebar. */
  handleSelectTopic: (id: string) => void;
  /** Call to return to the index/welcome view. */
  handleGoToIndex: () => void;
  /** Call on keydown in the search input. */
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Call to toggle a procedure step checkbox. */
  handleToggleStep: (stepIndex: number) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHelpViewer(): UseHelpViewerReturn {
  // -- Store --
  const helpOpen = useAssistantStore((s) => s.helpOpen);
  const helpTopicId = useAssistantStore((s) => s.helpTopicId);
  const closeHelp = useAssistantStore((s) => s.closeHelp);

  const recordHelpPageView = useUserPreferencesStore(
    (s) => s.recordHelpPageView,
  );

  // -- Local state --
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [checkedSteps, setCheckedSteps] = useState<Set<number>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // -- Derived data --
  const allEntries = useMemo(() => getAllHelpEntries(), []);

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return allEntries;
    return searchHelpEntries(searchQuery);
  }, [searchQuery, allEntries]);

  const selectedTopic = useMemo(() => {
    const id = selectedTopicId ?? helpTopicId ?? null;
    if (!id) return null;
    return getHelpEntry(id) ?? null;
  }, [selectedTopicId, helpTopicId, allEntries]);

  const isProcedure =
    selectedTopic?.path.includes('/procedures/') ?? false;

  const groupedEntries = useMemo(
    () => groupBySection(filteredEntries),
    [filteredEntries],
  );

  // -- Initialise on open --
  useEffect(() => {
    if (helpOpen) {
      setSearchQuery('');
      setSelectedTopicId(helpTopicId ?? null);
      setCheckedSteps(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helpOpen]);

  // -- Record help page view when topic changes --
  useEffect(() => {
    if (helpOpen && selectedTopic) {
      const key = selectedTopic.route ?? selectedTopic.id;
      recordHelpPageView(key);
    }
  }, [helpOpen, selectedTopic, recordHelpPageView]);

  // -- Global keyboard shortcuts --
  useEffect(() => {
    if (!helpOpen) return;

    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [helpOpen]);

  // -- Handlers --
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeHelp();
    },
    [closeHelp],
  );

  const handleSelectTopic = useCallback((id: string) => {
    setSelectedTopicId(id);
    setCheckedSteps(new Set());
  }, []);

  const handleGoToIndex = useCallback(() => {
    setSelectedTopicId(null);
    setSearchQuery('');
    searchInputRef.current?.focus();
  }, []);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSearchQuery('');
        searchInputRef.current?.focus();
      }
    },
    [],
  );

  const handleToggleStep = useCallback((stepIndex: number) => {
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepIndex)) {
        next.delete(stepIndex);
      } else {
        next.add(stepIndex);
      }
      return next;
    });
  }, []);

  return {
    helpOpen,
    searchQuery,
    setSearchQuery,
    selectedTopicId,
    selectedTopic,
    isProcedure,
    groupedEntries,
    helpTopicId,
    checkedSteps,
    searchInputRef,
    handleOpenChange,
    handleSelectTopic,
    handleGoToIndex,
    handleSearchKeyDown,
    handleToggleStep,
  };
}
