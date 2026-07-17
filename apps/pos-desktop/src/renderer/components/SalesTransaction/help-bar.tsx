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
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
        </svg>
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
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
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
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect width="20" height="14" x="2" y="4" rx="2" />
          <path d="M8 12h8" />
          <path d="M10 10 8 12l2 2" />
        </svg>
        <span>{t("help_bar.shortcuts")}</span>
      </button>
    </div>
  );
};
