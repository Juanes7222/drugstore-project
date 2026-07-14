/**
 * Palette search result group — a category section with header label,
 * count badge, and list of result items.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { IndexableItem } from "../../../domain/assistant/assistant-types";
import { PaletteSearchResultItem } from "./palette-search-result-item";

export interface PaletteSearchResultGroupProps {
  category: string;
  labelKey: string;
  items: IndexableItem[];
  flatItems: IndexableItem[];
  selectedIndex: number;
  onSelect: (item: IndexableItem) => void;
  onHover: (index: number) => void;
}

export const PaletteSearchResultGroup: FC<PaletteSearchResultGroupProps> = ({
  category,
  labelKey,
  items,
  flatItems,
  selectedIndex,
  onSelect,
  onHover,
}) => {
  const { t } = useTranslation();

  return (
    <div key={category}>
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
          {t(labelKey)}
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
          {items.length}
        </span>
      </div>

      {/* Group items */}
      {items.map((item) => {
        const globalIndex = flatItems.indexOf(item);
        return (
          <PaletteSearchResultItem
            key={`${item.category}-${item.id}`}
            item={item}
            index={globalIndex}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            onHover={onHover}
          />
        );
      })}
    </div>
  );
};
