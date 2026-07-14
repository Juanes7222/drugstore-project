/**
 * Shortcut cheatsheet hook — owns all state, customisation logic, capture
 * mode, search filtering, and side effects for the ShortcutCheatsheet
 * component.
 *
 * Extracted from the monolithic shortcut-cheatsheet.tsx so the logic can be
 * unit-tested without rendering the full dialog tree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ShortcutBinding, ShortcutContext } from '../../domain/assistant/assistant-types';
import { createShortcutManager } from '../../domain/assistant/shortcut-manager';
import { useAssistantStore } from '../../stores/assistant.store';
import { useUserPreferencesStore } from '../../stores/user-preferences.store';
import { CONTEXT_ORDER, isModifierOnly } from '../../domain/assistant/shortcut-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseShortcutCheatsheetReturn {
  /** Whether the cheatsheet dialog is open. */
  cheatsheetOpen: boolean;
  /** Current search query text. */
  searchQuery: string;
  /** Set the search query. */
  setSearchQuery: (q: string) => void;
  /** ID of the binding currently being captured, or null. */
  capturingId: string | null;
  /** Description of a conflicting binding, or null. */
  conflictDescription: string | null;
  /** Effective bindings (defaults + user overrides). */
  effectiveBindings: ShortcutBinding[];
  /** Filtered bindings matching the search query. */
  filteredBindings: ShortcutBinding[];
  /** Bindings grouped by context and sorted by display priority. */
  groupedBindings: { context: ShortcutContext; bindings: ShortcutBinding[] }[];
  /** Ref for the search input element. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Check if a binding has a user-defined override. */
  isCustom: (commandId: string) => boolean;
  /** Get the default key for a commandId. */
  defaultKeyForCommand: (commandId: string) => string | undefined;
  /** Start capturing a new key combination for a command. */
  startCapture: (commandId: string) => void;
  /** Cancel the current capture. */
  cancelCapture: () => void;
  /** Restore a shortcut to its default key. */
  restoreDefault: (commandId: string) => void;
  /** Call when search input changes. */
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Call when dialog open state changes. */
  handleOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useShortcutCheatsheet(): UseShortcutCheatsheetReturn {
  // -- Store --
  const cheatsheetOpen = useAssistantStore((s) => s.cheatsheetOpen);
  const closeCheatsheet = useAssistantStore((s) => s.closeCheatsheet);
  const customShortcuts = useUserPreferencesStore((s) => s.customShortcuts);
  const setCustomShortcut = useUserPreferencesStore(
    (s) => s.setCustomShortcut,
  );
  const removeCustomShortcut = useUserPreferencesStore(
    (s) => s.removeCustomShortcut,
  );

  // -- Local state --
  const [searchQuery, setSearchQuery] = useState('');
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [conflictDescription, setConflictDescription] = useState<
    string | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const managerRef = useRef<ReturnType<typeof createShortcutManager> | null>(
    null,
  );

  // Lazily initialize the shortcut manager once.
  if (!managerRef.current) {
    managerRef.current = createShortcutManager();
  }
  const defaultBindings = managerRef.current.getBindings();

  // -- Derived: effective bindings (defaults + user overrides) --
  const effectiveBindings = useMemo<ShortcutBinding[]>(() => {
    return defaultBindings.map((binding) => {
      const customKey = customShortcuts[binding.commandId];
      if (customKey && customKey !== binding.key) {
        return { ...binding, key: customKey };
      }
      return binding;
    });
  }, [customShortcuts, defaultBindings]);

  // -- Derived: filtered + grouped --
  const filteredBindings = useMemo(() => {
    if (!searchQuery.trim()) return effectiveBindings;
    const q = searchQuery.toLowerCase();
    return effectiveBindings.filter(
      (b) =>
        b.key.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q),
    );
  }, [searchQuery, effectiveBindings]);

  const groupedBindings = useMemo(() => {
    const map = new Map<ShortcutContext, ShortcutBinding[]>();
    for (const binding of filteredBindings) {
      const list = map.get(binding.context);
      if (list) {
        list.push(binding);
      } else {
        map.set(binding.context, [binding]);
      }
    }
    return CONTEXT_ORDER.filter((ctx) => map.has(ctx)).map((ctx) => ({
      context: ctx,
      bindings: map.get(ctx)!,
    }));
  }, [filteredBindings]);

  // -- Derived: custom/default detection --
  const isCustom = useCallback(
    (commandId: string): boolean =>
      customShortcuts[commandId] !== undefined,
    [customShortcuts],
  );

  const defaultKeyForCommand = useCallback(
    (commandId: string): string | undefined =>
      defaultBindings.find((b) => b.commandId === commandId)?.key,
    [defaultBindings],
  );

  // -- Capture mode: keydown listener --
  useEffect(() => {
    if (!capturingId) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setCapturingId(null);
        setConflictDescription(null);
        return;
      }

      if (isModifierOnly(event)) return;

      event.preventDefault();
      event.stopPropagation();

      const combo = managerRef.current!.normalizeEvent(event);
      if (!combo) return;

      const conflict = effectiveBindings.find(
        (b) => b.key === combo && b.commandId !== capturingId,
      );
      if (conflict) {
        setConflictDescription(conflict.description);
        return;
      }

      setCustomShortcut(capturingId, combo);
      setCapturingId(null);
      setConflictDescription(null);
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [capturingId, effectiveBindings, setCustomShortcut]);

  // -- Handlers --
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closeCheatsheet();
        setSearchQuery('');
        setCapturingId(null);
        setConflictDescription(null);
      }
    },
    [closeCheatsheet],
  );

  // Focus input on open
  useEffect(() => {
    if (cheatsheetOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [cheatsheetOpen]);

  const startCapture = useCallback((commandId: string) => {
    setCapturingId(commandId);
    setConflictDescription(null);
  }, []);

  const cancelCapture = useCallback(() => {
    setCapturingId(null);
    setConflictDescription(null);
  }, []);

  const restoreDefault = useCallback(
    (commandId: string) => {
      removeCustomShortcut(commandId);
    },
    [removeCustomShortcut],
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [],
  );

  return {
    cheatsheetOpen,
    searchQuery,
    setSearchQuery,
    capturingId,
    conflictDescription,
    effectiveBindings,
    filteredBindings,
    groupedBindings,
    inputRef,
    isCustom,
    defaultKeyForCommand,
    startCapture,
    cancelCapture,
    restoreDefault,
    handleSearchChange,
    handleOpenChange,
  };
}
