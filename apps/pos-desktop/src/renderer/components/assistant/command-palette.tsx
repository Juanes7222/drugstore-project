/**
 * Command palette — modal overlay for the in-app productivity assistant.
 *
 * Opens with Cmd+K / Ctrl+K from anywhere in the app. Provides fast,
 * keyboard-first search across pages, commands, products, clients, sales,
 * and help topics. Inspired by Linear / Raycast.
 *
 * Rendered as a singleton in the React root, not mounted per-page.
 *
 * Composition shell that wires the useCommandPalette hook to extracted
 * presentational components.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { type FC, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAssistantStore } from "../../../stores/assistant.store";
import { useCommandPalette } from "../../hooks/use-command-palette";
import { PaletteFooter } from "./palette-footer";
import { PaletteSearchInput } from "./palette-search-input";
import { PaletteSearchResultGroup } from "./palette-search-result-group";
import {
  PaletteEmptyResults,
  PaletteIndexBuilding,
  PaletteSearchError,
  PaletteWelcomeState,
} from "./palette-states";

export const CommandPalette: FC = () => {
  const { t } = useTranslation();

  // ---- Dialog open state (from store; hook manages the rest) ----
  const paletteOpen = useAssistantStore((s) => s.paletteOpen);

  // ---- Hook — state, search, keyboard navigation, execution ----
  const {
    query,
    selectedIndex,
    groupedResults,
    flatItems,
    isIndexBuilding,
    inputRef,
    listRef,
    searchError,
    handleInputChange,
    handleOpenChange,
    handleKeyDown,
    executeItem,
  } = useCommandPalette();

  // ---- Local hover state — syncs with keyboard via wrapped handler ----
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const effectiveIndex = hoveredIndex >= 0 ? hoveredIndex : selectedIndex;

  const handleLocalKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Reset mouse hover so keyboard selection takes over visually
      setHoveredIndex(-1);
      handleKeyDown(event);
    },
    [handleKeyDown],
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
                <PaletteSearchInput
                  value={query}
                  onChange={handleInputChange}
                  onKeyDown={handleLocalKeyDown}
                  inputRef={inputRef}
                  disabled={isIndexBuilding}
                  isBuilding={isIndexBuilding}
                  placeholder={t("assistant.palette.placeholder")}
                />

                {/* Results list */}
                <div
                  ref={listRef}
                  className="overflow-y-auto"
                  style={{ maxHeight: "500px" }}
                  role="listbox"
                  aria-label={t("assistant.palette.placeholder")}
                >
                  {isIndexBuilding && <PaletteIndexBuilding />}

                  {!isIndexBuilding && searchError && (
                    <PaletteSearchError message={searchError} />
                  )}

                  {!isIndexBuilding &&
                    !searchError &&
                    query.trim() !== "" &&
                    flatItems.length === 0 && (
                      <PaletteEmptyResults query={query} />
                    )}

                  {!isIndexBuilding &&
                    !searchError &&
                    query.trim() === "" &&
                    flatItems.length === 0 && <PaletteWelcomeState />}

                  {!isIndexBuilding &&
                    !searchError &&
                    flatItems.length > 0 &&
                    groupedResults.map((group) => (
                      <PaletteSearchResultGroup
                        key={group.category}
                        category={group.category}
                        labelKey={group.labelKey}
                        items={group.items}
                        flatItems={flatItems}
                        selectedIndex={effectiveIndex}
                        onSelect={executeItem}
                        onHover={setHoveredIndex}
                      />
                    ))}
                </div>

                <PaletteFooter />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};
