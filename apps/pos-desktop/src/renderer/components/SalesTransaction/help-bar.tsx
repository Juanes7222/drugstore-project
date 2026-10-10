/**
 * Help bar — a muted strip below the search input exposing the two
 * global-assistant shortcuts as clickable buttons: the command palette
 * (⌘K) and contextual help (F1).
 *
 * The shortcut cheatsheet (?) is not here: it lives in the cart command rail,
 * where the sale commands it would sit beside are already drawn. Three
 * surfaces advertising overlapping shortcut sets is how they drift apart.
 *
 * Uses the assistant store to trigger overlays directly instead of requiring
 * the user to already know the keyboard shortcuts.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { useAssistantStore } from "../../../stores/assistant.store";
import { CommandIcon, HelpCircleIcon } from "@/components/ui/icons";

interface HelpBarProps {
  /** Optional class name for layout positioning. */
  className?: string;
}

export const HelpBar: FC<HelpBarProps> = ({ className = "" }) => {
  const { t } = useTranslation();
  const openPalette = useAssistantStore((s) => s.openPalette);
  const openHelp = useAssistantStore((s) => s.openHelp);

  return (
    <div
      className={`flex items-center gap-3 ${className}`}
      style={{ color: "color-mix(in srgb, var(--color-ink) 45%, transparent)" }}
    >
      <button
        type="button"
        onClick={openPalette}
        className="flex items-center gap-1.5 text-caption transition-colors hover:text-pharma"
        title={t("help_bar.tooltip_palette")}
      >
        <CommandIcon size={12} />
        <kbd className="pos-kbd" aria-hidden="true">
          ⌘K
        </kbd>
      </button>

      <span
        className="text-caption"
        style={{ color: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
        aria-hidden="true"
      >
        ·
      </span>

      <button
        type="button"
        onClick={() => openHelp(undefined)}
        className="flex items-center gap-1.5 text-caption transition-colors hover:text-pharma"
        title={t("help_bar.tooltip_help")}
      >
        <HelpCircleIcon size={12} />
        <span>{t("help_bar.help")}</span>
      </button>
    </div>
  );
};