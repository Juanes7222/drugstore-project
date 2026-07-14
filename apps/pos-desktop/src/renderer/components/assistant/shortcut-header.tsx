/**
 * ShortcutHeader — dialog header with title and close button,
 * used inside the shortcut cheatsheet.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { FC } from "react";
import { useTranslation } from "react-i18next";

export interface ShortcutHeaderProps {
  onClose: () => void;
}

export const ShortcutHeader: FC<ShortcutHeaderProps> = ({ onClose }) => {
  const { t } = useTranslation();

  return (
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
          onClick={onClose}
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
  );
};
