/**
 * Palette search result item — a single clickable row with category icon,
 * label, description, and optional shortcut hint.
 */
import { type FC } from "react";
import type { IndexableItem } from "../../../domain/assistant/assistant-types";
import {
  CATEGORY_ICONS,
  getItemDescription,
  getItemLabel,
  getItemShortcut,
} from "../../../domain/assistant/palette-helpers";

export interface PaletteSearchResultItemProps {
  item: IndexableItem;
  index: number;
  selectedIndex: number;
  onSelect: (item: IndexableItem) => void;
  onHover: (index: number) => void;
}

export const PaletteSearchResultItem: FC<PaletteSearchResultItemProps> = ({
  item,
  index,
  selectedIndex,
  onSelect,
  onHover,
}) => {
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
      onMouseEnter={() => onHover(index)}
      onClick={() => onSelect(item)}
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
};
