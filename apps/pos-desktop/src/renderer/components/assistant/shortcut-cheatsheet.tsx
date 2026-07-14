/**
 * Shortcut cheatsheet — full-screen overlay listing all keyboard shortcuts
 * grouped by context, with search, one-click customisation, and conflict
 * detection for user-defined key bindings.
 *
 * Opened with `?` (when not in a text field), from the command palette,
 * or programmatically via `openCheatsheet()`.
 *
 * Composition over logic: state and side effects are delegated to the
 * useShortcutCheatsheet hook; this file only wires presentational components
 * into the dialog shell.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { useShortcutCheatsheet } from "../../hooks/use-shortcut-cheatsheet";
import {
  ShortcutConflictWarning,
  ShortcutEmptySearch,
} from "./shortcut-states";
import { ShortcutFooter } from "./shortcut-footer";
import { ShortcutGroup } from "./shortcut-group";
import { ShortcutHeader } from "./shortcut-header";
import { ShortcutSearchInput } from "./shortcut-search-input";

export const ShortcutCheatsheet: FC = () => {
  const { t } = useTranslation();

  const {
    cheatsheetOpen,
    searchQuery,
    setSearchQuery,
    capturingId,
    conflictDescription,
    groupedBindings,
    inputRef,
    isCustom,
    defaultKeyForCommand,
    startCapture,
    cancelCapture,
    restoreDefault,
    handleSearchChange,
    handleOpenChange,
    filteredBindings,
  } = useShortcutCheatsheet();

  return (
    <Dialog.Root open={cheatsheetOpen} onOpenChange={handleOpenChange}>
      <AnimatePresence>
        {cheatsheetOpen && (
          <Dialog.Portal forceMount>
            {/* Overlay */}
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                  backdropFilter: "blur(4px)",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              />
            </Dialog.Overlay>

            {/* Panel */}
            <Dialog.Content
              onEscapeKeyDown={(event: Event) => {
                if (capturingId) {
                  event.preventDefault();
                  cancelCapture();
                }
              }}
              asChild
            >
              <motion.div
                className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden focus-visible:outline-none"
                style={{
                  backgroundColor: "var(--color-panel)",
                  borderRadius: "var(--radius-pos)",
                  boxShadow: "var(--shadow-pos-elevated)",
                }}
                initial={{ opacity: 0, scale: 0.96, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              >
                <ShortcutHeader onClose={() => handleOpenChange(false)} />

                <ShortcutSearchInput
                  value={searchQuery}
                  onChange={handleSearchChange}
                  disabled={capturingId !== null}
                  inputRef={inputRef}
                  onClear={() => setSearchQuery("")}
                />

                {conflictDescription && (
                  <ShortcutConflictWarning
                    commandDescription={conflictDescription}
                  />
                )}

                {/* Shortcut list */}
                <div
                  className="flex-1 overflow-y-auto"
                  role="list"
                  aria-label={t("assistant.shortcuts.title")}
                >
                  {/* Empty search */}
                  {searchQuery.trim() !== "" &&
                    filteredBindings.length === 0 && (
                      <ShortcutEmptySearch query={searchQuery} />
                    )}

                  {/* Grouped results */}
                  {groupedBindings.map((group) => (
                    <ShortcutGroup
                      key={group.context}
                      context={group.context}
                      bindings={group.bindings}
                      capturingId={capturingId}
                      isCustom={isCustom}
                      defaultKeyForCommand={defaultKeyForCommand}
                      onStartCapture={startCapture}
                      onCancelCapture={cancelCapture}
                      onRestoreDefault={restoreDefault}
                    />
                  ))}
                </div>

                <ShortcutFooter />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};
