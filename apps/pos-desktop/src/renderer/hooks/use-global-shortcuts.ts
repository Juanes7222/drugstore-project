/**
 * Global keyboard shortcut hook.
 *
 * Registers at the React root all application-wide keyboard shortcuts:
 * - Cmd+K / Ctrl+K → open command palette
 * - Cmd+/        → open help
 * - ?            → shortcut cheatsheet (not in text fields)
 * - Esc          → close open overlay
 * - Cmd+N        → new sale
 * - Cmd+Shift+S  → sync now
 * - F1           → context help
 *
 * Uses `event.metaKey || event.ctrlKey` for cross-platform consistency.
 * Skips text inputs for non-global shortcuts.
 * Checks IME composition state to avoid false positives with CJK input.
 */

import { useEffect, useCallback } from "react";

export interface ShortcutHandlers {
  onOpenPalette: () => void;
  onOpenHelp: () => void;
  onShowCheatsheet: () => void;
  onCloseOverlay: () => void;
  onNewSale: () => void;
  onSyncNow: () => void;
  onContextHelp: () => void;
}

/**
 * Hook that registers global keyboard shortcuts.
 * Call once at the root component level.
 *
 * @param handlers - Callback functions for each shortcut action
 * @param isModalOpen - Whether a modal/overlay is currently open
 * @param currentScreen - Current active screen (for context awareness)
 */
export function useGlobalShortcuts(
  handlers: ShortcutHandlers,
  isModalOpen: boolean,
  currentScreen: string,
): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Skip if IME composition is active (CJK/Japanese input)
      if (event.isComposing) return;

      const meta = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase() ?? "";
      const isInput =
        tagName === "input" ||
        tagName === "textarea" ||
        target?.isContentEditable === true;

      // ---- Always-active shortcuts ----

      // Cmd+K / Ctrl+K → palette (always works, even in inputs)
      if (meta && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        event.stopPropagation();
        handlers.onOpenPalette();
        return;
      }

      // Esc → close overlay
      if (event.key === "Escape") {
        event.preventDefault();
        handlers.onCloseOverlay();
        return;
      }

      // F1 → context help (always works)
      if (event.key === "F1") {
        event.preventDefault();
        handlers.onContextHelp();
        return;
      }

      // ---- Shortcuts that don't fire in text inputs ----
      if (isInput) return;

      // Cmd+/ → help
      if (meta && event.key === "/") {
        event.preventDefault();
        handlers.onOpenHelp();
        return;
      }

      // ? → shortcut cheatsheet (only keypress, no modifiers)
      if (event.key === "?" && !meta && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        handlers.onShowCheatsheet();
        return;
      }

      // ---- Context-aware shortcuts ----
      // Cmd+N → new sale (SALE_FLOW context)
      if (meta && (event.key === "n" || event.key === "N")) {
        // Only fire on sale-related screens or from global shortcut
        const saleScreens = ["sales", "payment", "receipt"];
        if (saleScreens.includes(currentScreen) || !isModalOpen) {
          event.preventDefault();
          handlers.onNewSale();
          return;
        }
      }

      // Cmd+Shift+S → sync now
      if (meta && event.shiftKey && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        handlers.onSyncNow();
        return;
      }
    },
    [handlers, isModalOpen, currentScreen],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}
