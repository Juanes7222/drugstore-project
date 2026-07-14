/**
 * ShortcutFooter — dialog footer with hint text,
 * used inside the shortcut cheatsheet.
 */
import type { FC } from "react";
import { useTranslation } from "react-i18next";

export const ShortcutFooter: FC = () => {
  const { t } = useTranslation();

  return (
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
  );
};
