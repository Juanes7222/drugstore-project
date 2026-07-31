/**
 * Help bar — a subtle strip below the search input showing keyboard shortcuts.
 *
 * Makes Cmd+K (palette), F1 (help), and ? (shortcuts) discoverable without
 * taking focus. Uses small text and muted colors so it does not compete with
 * the transaction workflow.
 *
 * Uses the assistant store to trigger overlays directly instead of requiring
 * the user to already know the keyboard shortcuts.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { useAssistantStore } from "../../../stores/assistant.store";
import { CommandIcon, EnterIcon, HelpCircleIcon } from "@/components/ui/icons";

interface HelpBarProps {
  /** Optional class name for layout positioning. */
  className?: string;
}

export const HelpBar: FC<HelpBarProps> = ({ className = "" }) => {
  const { t } = useTranslation();
  const openPalette = useAssistantStore((s) => s.openPalette);
  const openHelp = useAssistantStore((s) => s.openHelp);
  const openCheatsheet = useAssistantStore((s) => s.openCheatsheet);

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
        <kbd className="rounded border px-1 font-mono text-xs leading-none tabular-nums"
          style={{
            borderColor: "color-mix(in srgb, var(--color-ink) 20%, transparent)",
          }}
        >
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

      <span
        className="text-caption"
        style={{ color: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
        aria-hidden="true"
      >
        ·
      </span>

      <button
        type="button"
        onClick={openCheatsheet}
        className="flex items-center gap-1.5 text-caption transition-colors hover:text-pharma"
        title={t("help_bar.tooltip_shortcuts")}
      >
        <EnterIcon size={12} />
        <span>{t("help_bar.shortcuts")}</span>
      </button>
    </div>
  );
};
