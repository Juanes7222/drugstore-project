/**
 * Command palette — modal overlay for the in-app productivity assistant.
 *
 * Opens with Cmd+K / Ctrl+K from anywhere in the app. Provides fast,
 * keyboard-first search across pages, commands, products, clients, sales,
 * and help topics. Inspired by Linear / Raycast.
 *
 * Rendered as a singleton in the React root, not mounted per-page.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import {
  type ChangeEvent,
  type FC,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { IndexableItem } from "../../../domain/assistant/assistant-types";
import { createSearchIndexService } from "../../../domain/assistant/search-index.service";
import { useAssistantStore } from "../../../stores/assistant.store";
import { useUserPreferencesStore } from "../../../stores/user-preferences.store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Debounce delay before triggering a search. */
const SEARCH_DEBOUNCE_MS = 50;

/**
 * Display priority for each category (lower = higher).
 * Used to sort groups in the fixed order defined in the spec.
 */
const CATEGORY_PRIORITY: Record<IndexableItem["category"], number> = {
  RECENT: 0,
  COMMAND: 1,
  PAGE: 2,
  SALE: 3,
  CLIENT: 4,
  PRODUCT: 5,
  HELP_TOPIC: 6,
};

/**
 * Human-readable group labels mapped to i18n keys.
 */
const GROUP_LABEL_KEYS: Record<IndexableItem["category"], string> = {
  RECENT: "assistant.palette.group_recent",
  COMMAND: "assistant.palette.group_commands",
  PAGE: "assistant.palette.group_pages",
  SALE: "assistant.palette.group_sales",
  CLIENT: "assistant.palette.group_clients",
  PRODUCT: "assistant.palette.group_products",
  HELP_TOPIC: "assistant.palette.group_help",
};

/**
 * Icon label for each category (used as a simple text indicator).
 */
const CATEGORY_ICONS: Record<IndexableItem["category"], string> = {
  RECENT: "\u21BB",
  COMMAND: "\u2318",
  PAGE: "\u2192",
  SALE: "$",
  CLIENT: "\u{1F464}",
  PRODUCT: "\u{1F48A}",
  HELP_TOPIC: "?",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get a display label for an indexable item, regardless of its category.
 */
function getItemLabel(item: IndexableItem): string {
  switch (item.category) {
    case "PAGE":
    case "COMMAND":
    case "RECENT":
      return item.label;
    case "PRODUCT":
      return item.name;
    case "CLIENT":
      return item.name;
    case "SALE":
      return `#${item.localNumber} \u2014 $${(item.total / 100).toFixed(2)}`;
    case "HELP_TOPIC":
      return item.title;
  }
}

/**
 * Get a secondary description for an item (shown below the label).
 */
function getItemDescription(item: IndexableItem): string | null {
  switch (item.category) {
    case "PRODUCT":
      return item.genericName ?? item.laboratory ?? null;
    case "CLIENT":
      return item.document ?? item.phone ?? null;
    case "SALE":
      return item.status;
    case "HELP_TOPIC":
      return item.excerpt;
    case "COMMAND":
      return item.shortcut ?? null;
    case "PAGE":
      return null;
    case "RECENT":
      return null;
  }
}

/**
 * Get the shortcut string for a command item.
 */
function getItemShortcut(item: IndexableItem): string | null {
  if (item.category === "COMMAND") {
    return item.shortcut ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CommandPalette: FC = () => {
  const { t } = useTranslation();

  // ---- Store state ----
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

  // ---- Local state ----
  const [results, setResults] = useState<IndexableItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchServiceRef = useRef<ReturnType<typeof createSearchIndexService> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Execute a selected item ----
  const executeItem = useCallback(
    (item: IndexableItem) => {
      // Add to recent items
      addPaletteRecentItem(`${item.category}:${item.id}`);

      // Close the palette
      closePalette();

      // For command items, execute the associated function
      if (item.category === "COMMAND") {
        // Dynamic import to avoid circular deps at module init
        import("../../../domain/assistant/commands").then(
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

  // ---- Perform search ----
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

        // Ensure index is built
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

  // ---- Debounced search effect ----
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

  // ---- Reset state on open ----
  useEffect(() => {
    if (paletteOpen) {
      setResults([]);
      setSelectedIndex(0);
      setSearchError(null);
      setIsSearching(false);
      incrementPaletteUsage();

      // Focus input after dialog mounts
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [paletteOpen, incrementPaletteUsage]);

  // ---- Group results ----
  const groupedResults = useMemo(() => {
    const groups = new Map<IndexableItem["category"], IndexableItem[]>();

    for (const item of results) {
      const existing = groups.get(item.category);
      if (existing) {
        existing.push(item);
      } else {
        groups.set(item.category, [item]);
      }
    }

    // Sort groups by the fixed priority order
    const sorted = Array.from(groups.entries()).sort(
      ([a], [b]) => (CATEGORY_PRIORITY[a] ?? 99) - (CATEGORY_PRIORITY[b] ?? 99),
    );

    return sorted.map(([category, items]) => ({
      category,
      items,
      labelKey: GROUP_LABEL_KEYS[category],
    }));
  }, [results]);

  // ---- Flattened items for keyboard navigation ----
  const flatItems = useMemo(() => {
    return groupedResults.flatMap((group) => group.items);
  }, [groupedResults]);

  // ---- Input change handler ----
  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPaletteQuery(event.target.value);
    },
    [setPaletteQuery],
  );

  // ---- Dialog open change handler ----
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closePalette();
      }
    },
    [closePalette],
  );

  // ---- Keyboard navigation ----
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev < flatItems.length - 1 ? prev + 1 : 0,
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : flatItems.length - 1,
        );
      } else if (event.key === "Enter") {
        event.preventDefault();
        const selectedItem = flatItems[selectedIndex];
        if (selectedItem) {
          executeItem(selectedItem);
        }
      }
    },
    [flatItems, selectedIndex, executeItem],
  );

  // ---- Scroll selected item into view ----
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const items = listRef.current.querySelectorAll<HTMLElement>(
        "[data-palette-item]",
      );
      const target = items[selectedIndex];
      if (target) {
        target.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  // ---- Render a single item ----
  const renderItem = useCallback(
    (item: IndexableItem, index: number) => {
      const isSelected = index === selectedIndex;
      const description = getItemDescription(item);

      return (
        <button
          key={`${item.category}-${item.id}`}
          data-palette-item
          type="button"
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-75"
          style={{
            backgroundColor: isSelected
              ? "color-mix(in srgb, var(--color-pharma) 8%, transparent)"
              : "transparent",
            color: "var(--color-ink)",
          }}
          onMouseEnter={() => setSelectedIndex(index)}
          onClick={() => executeItem(item)}
          onPointerDown={(event) => {
            // Prevent Radix Dialog from closing on mousedown before click fires
            event.preventDefault();
          }}
        >
          {/* Category icon */}
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pos text-caption"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-ink) 8%, transparent)",
              color:
                "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
            aria-hidden
          >
            {CATEGORY_ICONS[item.category]}
          </span>

          {/* Label and description */}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body font-medium">
              {getItemLabel(item)}
            </span>
            {description && (
              <span
                className="truncate text-caption"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                }}
              >
                {description}
              </span>
            )}
          </div>

          {/* Shortcut hint */}
          {getItemShortcut(item) && (
            <kbd
              className="ml-auto shrink-0 rounded-pos px-1.5 py-0.5 font-data text-caption tabular-nums"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                color:
                  "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                border:
                  "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
              }}
            >
              {getItemShortcut(item)}
            </kbd>
          )}
        </button>
      );
    },
    [executeItem],
  );

  // ---- Render ----
  return (
    <Dialog.Root open={paletteOpen} onOpenChange={handleOpenChange}>
      <AnimatePresence>
        {paletteOpen && (
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

            {/* Modal */}
            <Dialog.Content asChild>
              <motion.div
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 focus-visible:outline-none"
                initial={{ opacity: 0, scale: 0.96, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                style={{
                  backgroundColor: "var(--color-panel)",
                  borderRadius: "var(--radius-pos)",
                  boxShadow: "var(--shadow-pos-elevated)",
                }}
              >
                {/* Input */}
                <div
                  className="flex items-center gap-3 px-4"
                  style={{
                    borderBottom:
                      "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
                  }}
                >
                  {/* Search icon */}
                  <svg
                    className="h-4 w-4 shrink-0"
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
                    value={paletteQuery}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={t("assistant.palette.placeholder")}
                    aria-label={t("assistant.palette.placeholder")}
                    className="flex-1 border-none bg-transparent py-3.5 text-body outline-none"
                    style={{
                      color: "var(--color-ink)",
                      fontFamily: "var(--font-ui)",
                    }}
                    disabled={isIndexBuilding}
                    autoComplete="off"
                    spellCheck={false}
                  />

                  {/* Building index spinner */}
                  {isIndexBuilding && (
                    <div className="flex shrink-0 items-center gap-2 text-caption">
                      <svg
                        className="h-3.5 w-3.5 animate-spin"
                        viewBox="0 0 16 16"
                        fill="none"
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                        }}
                        aria-hidden
                      >
                        <circle
                          cx="8"
                          cy="8"
                          r="6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeDasharray="28"
                          strokeDashoffset="8"
                          strokeLinecap="round"
                          fill="none"
                        />
                      </svg>
                      <span
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                        }}
                      >
                        {t("assistant.palette.building_index")}
                      </span>
                    </div>
                  )}
                </div>

                {/* Results list */}
                <div
                  ref={listRef}
                  className="overflow-y-auto"
                  style={{ maxHeight: "500px" }}
                  role="listbox"
                  aria-label={t("assistant.palette.placeholder")}
                >
                  {/* Building index state */}
                  {isIndexBuilding && (
                    <div className="flex flex-col items-center justify-center px-4 py-12">
                      <svg
                        className="mb-3 h-6 w-6 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                        }}
                        aria-hidden
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeDasharray="50"
                          strokeDashoffset="15"
                          strokeLinecap="round"
                          fill="none"
                        />
                      </svg>
                      <p
                        className="mt-3 text-body"
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                        }}
                      >
                        {t("assistant.palette.building_index")}
                      </p>
                    </div>
                  )}

                  {/* Search error */}
                  {searchError && !isIndexBuilding && (
                    <div
                      className="mx-4 mt-2 rounded-pos px-3 py-2 text-caption"
                      style={{
                        backgroundColor:
                          "color-mix(in srgb, var(--color-urgency) 10%, transparent)",
                        color: "var(--color-urgency)",
                      }}
                      role="alert"
                    >
                      {searchError}
                    </div>
                  )}

                  {/* Empty results */}
                  {!isIndexBuilding &&
                    !searchError &&
                    paletteQuery.trim() !== "" &&
                    flatItems.length === 0 && (
                      <div className="flex flex-col items-center px-4 py-12 text-center">
                        <p
                          className="text-body"
                          style={{
                            color:
                              "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                          }}
                        >
                          {t("assistant.palette.no_results", {
                            query: paletteQuery,
                          })}
                        </p>
                      </div>
                    )}

                  {/* Empty state (no query, no results) */}
                  {!isIndexBuilding &&
                    !searchError &&
                    paletteQuery.trim() === "" &&
                    flatItems.length === 0 && (
                      <div className="px-4 py-8">
                        <p
                          className="text-center text-body"
                          style={{
                            color:
                              "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                          }}
                        >
                          {t("assistant.palette.placeholder")}
                        </p>
                      </div>
                    )}

                  {/* Grouped results */}
                  {!isIndexBuilding &&
                    !searchError &&
                    groupedResults.map((group) => (
                      <div key={group.category}>
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
                            {t(group.labelKey)}
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
                            {group.items.length}
                          </span>
                        </div>

                        {/* Group items */}
                        {group.items.map((item) => {
                          const globalIndex = flatItems.indexOf(item);
                          return renderItem(item, globalIndex);
                        })}
                      </div>
                    ))}
                </div>

                {/* Footer */}
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
                    {t("assistant.palette.footer_hints")}
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
