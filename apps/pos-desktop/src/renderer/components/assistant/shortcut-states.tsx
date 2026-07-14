/**
 * Shortcut states — conflict warning banner and empty search state
 * for the shortcut cheatsheet.
 */
import type { FC } from "react";
import { useTranslation } from "react-i18next";

// ---------------------------------------------------------------------------
// ShortcutConflictWarning
// ---------------------------------------------------------------------------

export interface ShortcutConflictWarningProps {
  commandDescription: string;
}

export const ShortcutConflictWarning: FC<ShortcutConflictWarningProps> = ({
  commandDescription,
}) => {
  const { t } = useTranslation();

  return (
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
          command: commandDescription,
        })}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ShortcutEmptySearch
// ---------------------------------------------------------------------------

export interface ShortcutEmptySearchProps {
  query: string;
}

export const ShortcutEmptySearch: FC<ShortcutEmptySearchProps> = ({
  query,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <p
        className="text-body"
        style={{
          color:
            "color-mix(in srgb, var(--color-ink) 50%, transparent)",
        }}
      >
        {t("assistant.shortcuts.empty", { query })}
      </p>
    </div>
  );
};
