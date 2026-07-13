/**
 * Shortcut cheatsheet — full-screen overlay listing all keyboard shortcuts
 * grouped by context, with search, one-click customisation, and conflict
 * detection for user-defined key bindings.
 *
 * Opened with `?` (when not in a text field), from the command palette,
 * or programmatically via `openCheatsheet()`.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  ShortcutBinding,
  ShortcutContext,
} from "../../../domain/assistant/assistant-types";
import { createShortcutManager } from "../../../domain/assistant/shortcut-manager";
import { useAssistantStore } from "../../../stores/assistant.store";
import { useUserPreferencesStore } from "../../../stores/user-preferences.store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Human-readable group labels mapped to i18n keys. */
const GROUP_LABEL_KEYS: Record<ShortcutContext, string> = {
  GLOBAL: "assistant.shortcuts.group_GLOBAL",
  SALE_FLOW: "assistant.shortcuts.group_SALE_FLOW",
  SHIFT_OPEN: "assistant.shortcuts.group_SHIFT_OPEN",
  MANAGER_ONLY: "assistant.shortcuts.group_MANAGER_ONLY",
  TEXT_INPUT: "assistant.shortcuts.group_TEXT_INPUT",
  MODAL_OPEN: "assistant.shortcuts.group_MODAL_OPEN",
};

/** Fixed context order for rendering (in display priority). */
const CONTEXT_ORDER: ShortcutContext[] = [
  "GLOBAL",
  "SALE_FLOW",
  "SHIFT_OPEN",
  "MANAGER_ONLY",
  "TEXT_INPUT",
  "MODAL_OPEN",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a key combo string for display in a kbd element.
 * - Replaces "Cmd" with the ⌘ symbol.
 * - Leaves other modifiers and keys as-is.
 */
function formatCombo(key: string): string {
  return key.replace(/\bCmd\b/g, "\u2318");
}

/**
 * Check whether a keydown event should be ignored during capture mode.
 * Returns true for modifier-only presses (no accompanying non-modifier key).
 */
function isModifierOnly(event: KeyboardEvent): boolean {
  return ["Meta", "Control", "Alt", "Shift"].includes(event.key);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ShortcutCheatsheet: FC = () => {
  const { t } = useTranslation();

  // ---- Store state ----
  const cheatsheetOpen = useAssistantStore((s) => s.cheatsheetOpen);
  const closeCheatsheet = useAssistantStore((s) => s.closeCheatsheet);
  const customShortcuts = useUserPreferencesStore((s) => s.customShortcuts);
  const setCustomShortcut = useUserPreferencesStore((s) => s.setCustomShortcut);
  const removeCustomShortcut = useUserPreferencesStore(
    (s) => s.removeCustomShortcut,
  );

  // ---- Local state ----
  const [searchQuery, setSearchQuery] = useState("");
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [conflictDescription, setConflictDescription] = useState<string | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const managerRef = useRef<ReturnType<typeof createShortcutManager> | null>(
    null,
  );

  // Lazily initialize the shortcut manager once.
  if (!managerRef.current) {
    managerRef.current = createShortcutManager();
  }
  const defaultBindings = managerRef.current.getBindings();

  // ---- Derived: effective bindings (defaults + user overrides) ----
  const effectiveBindings = useMemo<ShortcutBinding[]>(() => {
    return defaultBindings.map((binding) => {
      const customKey = customShortcuts[binding.commandId];
      if (customKey && customKey !== binding.key) {
        return { ...binding, key: customKey };
      }
      return binding;
    });
  }, [customShortcuts, defaultBindings]);

  // ---- Derived: filtered + grouped ----
  const filteredBindings = useMemo(() => {
    if (!searchQuery.trim()) return effectiveBindings;
    const q = searchQuery.toLowerCase();
    return effectiveBindings.filter(
      (b) =>
        b.key.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q),
    );
  }, [searchQuery, effectiveBindings]);

  /** Bindings grouped by context, sorted by GROUP_PRIORITY. */
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

  /** Check whether a binding currently has a user-defined override. */
  const isCustom = useCallback(
    (commandId: string): boolean => customShortcuts[commandId] !== undefined,
    [customShortcuts],
  );

  /** Get the default key for a commandId (before user override). */
  const defaultKeyForCommand = useCallback(
    (commandId: string): string | undefined =>
      defaultBindings.find((b) => b.commandId === commandId)?.key,
    [defaultBindings],
  );

  // ---- Capture mode: keydown listener ----
  useEffect(() => {
    if (!capturingId) return;

    const handler = (event: KeyboardEvent) => {
      // Escape cancels capture mode without closing the dialog.
      if (event.key === "Escape") {
        event.stopPropagation();
        setCapturingId(null);
        setConflictDescription(null);
        return;
      }

      // Ignore modifier-only presses.
      if (isModifierOnly(event)) return;

      // Prevent default browser behaviour and stop propagation so the
      // Dialog Escape handler doesn't interfere.
      event.preventDefault();
      event.stopPropagation();

      const combo = managerRef.current!.normalizeEvent(event);
      if (!combo) return;

      // Check for conflicts against all effective bindings.
      const conflict = effectiveBindings.find(
        (b) => b.key === combo && b.commandId !== capturingId,
      );
      if (conflict) {
        setConflictDescription(conflict.description);
        return;
      }

      // No conflict — save the custom shortcut.
      setCustomShortcut(capturingId, combo);
      setCapturingId(null);
      setConflictDescription(null);
    };

    // Use capture phase to intercept before Radix Dialog's Escape handler.
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [capturingId, effectiveBindings, setCustomShortcut]);

  // ---- Open / close handlers ----
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closeCheatsheet();
        // Reset local state when dialog closes.
        setSearchQuery("");
        setCapturingId(null);
        setConflictDescription(null);
      }
    },
    [closeCheatsheet],
  );

  // ---- Focus input on open ----
  useEffect(() => {
    if (cheatsheetOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [cheatsheetOpen]);

  // ---- Capture-mode helpers ----
  const startCapture = useCallback(
    (commandId: string) => {
      setCapturingId(commandId);
      setConflictDescription(null);
    },
    [],
  );

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

  // ---- Search handler ----
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [],
  );

  // ---- Render helpers ----

  /** Render a single shortcut row. */
  const renderBinding = useCallback(
    (binding: ShortcutBinding) => {
      const isCapturing = capturingId === binding.commandId;
      const hasCustom = isCustom(binding.commandId);
      const defaultKey = defaultKeyForCommand(binding.commandId);
      const canRestore = hasCustom && defaultKey && defaultKey !== binding.key;

      return (
        <div
          key={binding.id}
          className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-75"
          style={{
            backgroundColor: isCapturing
              ? "color-mix(in srgb, var(--color-restrict) 8%, transparent)"
              : "transparent",
          }}
        >
          {/* Key combo */}
          <kbd
            className="flex shrink-0 items-center gap-0.5 rounded-pos px-1.5 py-0.5 font-data text-caption tabular-nums"
            style={{
              backgroundColor: isCapturing
                ? "color-mix(in srgb, var(--color-restrict) 12%, transparent)"
                : "color-mix(in srgb, var(--color-ink) 8%, transparent)",
              color: isCapturing
                ? "var(--color-restrict)"
                : "color-mix(in srgb, var(--color-ink) 50%, transparent)",
              border: isCapturing
                ? "1px solid color-mix(in srgb, var(--color-restrict) 25%, transparent)"
                : "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
              minWidth: "4rem",
              justifyContent: "center",
            }}
            aria-label={
              isCapturing
                ? t("assistant.shortcuts.capture")
                : `${t("assistant.shortcuts.title")}: ${binding.description}`
            }
          >
            {isCapturing ? (
              <span className="animate-pulse text-caption">
                {t("assistant.shortcuts.capture")}
              </span>
            ) : (
              formatCombo(binding.key)
            )}
          </kbd>

          {/* Description + custom badge */}
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className="truncate text-body"
              style={{ color: "var(--color-ink)" }}
            >
              {binding.description}
            </span>
            {hasCustom && !isCapturing && (
              <span
                className="truncate text-caption font-medium"
                style={{ color: "var(--color-pharma)" }}
              >
                {t("assistant.shortcuts.custom")}
              </span>
            )}
          </div>

          {/* Actions: Edit / Restore */}
          <div className="flex shrink-0 items-center gap-1">
            {isCapturing ? (
              <button
                type="button"
                className="rounded-pos px-2 py-1 text-caption transition-colors duration-75"
                style={{
                  color: "var(--color-ink)",
                  backgroundColor:
                    "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                }}
                onClick={cancelCapture}
              >
                {t("common.cancel")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="rounded-pos px-2 py-1 text-caption font-medium transition-colors duration-75"
                  style={{
                    color: "var(--color-pharma)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                      "color-mix(in srgb, var(--color-pharma) 8%, transparent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                  onClick={() => startCapture(binding.commandId)}
                  aria-label={`${t("assistant.shortcuts.edit")}: ${binding.description}`}
                >
                  {t("assistant.shortcuts.edit")}
                </button>

                {canRestore && (
                  <button
                    type="button"
                    className="rounded-pos px-2 py-1 text-caption transition-colors duration-75"
                    style={{
                      color:
                        "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor =
                        "color-mix(in srgb, var(--color-ink) 8%, transparent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }}
                    onClick={() => restoreDefault(binding.commandId)}
                    aria-label={`${t("assistant.shortcuts.default")}: ${binding.description}`}
                  >
                    {t("assistant.shortcuts.default")}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      );
    },
    [
      capturingId,
      isCustom,
      defaultKeyForCommand,
      startCapture,
      cancelCapture,
      restoreDefault,
      t,
    ],
  );

  // =========================================================================
  // Render
  // =========================================================================

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
              // Prevent Radix Dialog from closing on Escape during capture mode.
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
                {/* ---- Header ---- */}
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{
                    borderBottom:
                      "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
                  }}
                >
                  <h2
                    className="text-ui font-semibold"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("assistant.shortcuts.title")}
                  </h2>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-pos transition-colors duration-75"
                      style={{
                        color:
                          "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor =
                          "color-mix(in srgb, var(--color-ink) 8%, transparent)";
                        e.currentTarget.style.color = "var(--color-ink)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                        e.currentTarget.style.color =
                          "color-mix(in srgb, var(--color-ink) 40%, transparent)";
                      }}
                      aria-label={t("assistant.shortcuts.close")}
                    >
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden
                      >
                        <path
                          d="M12 4L4 12M4 4l8 8"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </Dialog.Close>
                </div>

                {/* ---- Search ---- */}
                <div
                  className="flex items-center gap-2 px-4 py-2.5"
                  style={{
                    borderBottom:
                      "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
                    backgroundColor:
                      "color-mix(in srgb, var(--color-surface) 40%, white)",
                  }}
                >
                  {/* Search icon */}
                  <svg
                    className="h-3.5 w-3.5 shrink-0"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden
                    style={{
                      color:
                        "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                    }}
                  >
                    <path
                      d="M7.333 12.667A5.333 5.333 0 1 0 7.333 2a5.333 5.333 0 0 0 0 10.667ZM14 14l-2.9-2.9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>

                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={handleSearchChange}
                    placeholder={t("assistant.shortcuts.search")}
                    aria-label={t("assistant.shortcuts.search")}
                    className="flex-1 border-none bg-transparent text-body outline-none"
                    style={{
                      color: "var(--color-ink)",
                      fontFamily: "var(--font-ui)",
                    }}
                    disabled={capturingId !== null}
                    autoComplete="off"
                    spellCheck={false}
                  />

                  {/* Clear search button */}
                  {searchQuery.trim() !== "" && (
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded-full transition-colors duration-75"
                      style={{
                        color:
                          "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor =
                          "color-mix(in srgb, var(--color-ink) 8%, transparent)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                      }}
                      onClick={() => setSearchQuery("")}
                      aria-label={t("common.close")}
                    >
                      <svg
                        className="h-3 w-3"
                        viewBox="0 0 12 12"
                        fill="none"
                        aria-hidden
                      >
                        <path
                          d="M10 2L2 10M2 2l8 8"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  )}
                </div>

                {/* ---- Conflict warning ---- */}
                {conflictDescription && (
                  <div
                    className="mx-4 mt-2 flex items-start gap-2 rounded-pos px-3 py-2 text-caption font-medium"
                    style={{
                      backgroundColor:
                        "color-mix(in srgb, var(--color-urgency) 10%, transparent)",
                      color: "var(--color-urgency)",
                    }}
                    role="alert"
                  >
                    {/* Warning icon */}
                    <svg
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M8 5v3.333M8 11.333h.007M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>
                      {t("assistant.shortcuts.conflict", {
                        command: conflictDescription,
                      })}
                    </span>
                  </div>
                )}

                {/* ---- Shortcut list ---- */}
                <div
                  className="flex-1 overflow-y-auto"
                  role="list"
                  aria-label={t("assistant.shortcuts.title")}
                >
                  {/* Empty search */}
                  {searchQuery.trim() !== "" && filteredBindings.length === 0 && (
                    <div className="flex flex-col items-center px-4 py-12 text-center">
                      <p
                        className="text-body"
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                        }}
                      >
                        {t("assistant.shortcuts.empty", {
                          query: searchQuery,
                        })}
                      </p>
                    </div>
                  )}

                  {/* Grouped results */}
                  {groupedBindings.map((group) => (
                    <div key={group.context} role="group">
                      {/* Group header */}
                      <div
                        className="flex items-center gap-2 px-4 py-1.5"
                        style={{
                          backgroundColor:
                            "color-mix(in srgb, var(--color-surface) 50%, transparent)",
                        }}
                      >
                        <span
                          className="text-caption font-semibold uppercase tracking-wider"
                          style={{
                            color:
                              "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                          }}
                        >
                          {t(GROUP_LABEL_KEYS[group.context])}
                        </span>
                        <span
                          className="flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 font-data text-[10px] tabular-nums"
                          style={{
                            backgroundColor:
                              "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                            color:
                              "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                          }}
                        >
                          {group.bindings.length}
                        </span>
                      </div>

                      {/* Group items */}
                      {group.bindings.map((binding) => renderBinding(binding))}
                    </div>
                  ))}
                </div>

                {/* ---- Footer ---- */}
                <div
                  className="flex items-center justify-between px-4 py-2"
                  style={{
                    borderTop:
                      "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
                    backgroundColor:
                      "color-mix(in srgb, var(--color-surface) 50%, transparent)",
                  }}
                >
                  <span
                    className="text-caption"
                    style={{
                      color:
                        "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                    }}
                  >
                    {t("assistant.shortcuts.footer")}
                  </span>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};
