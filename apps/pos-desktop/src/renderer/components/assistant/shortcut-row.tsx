/**
 * ShortcutRow — individual shortcut row with key combo, description,
 * and edit/restore buttons, used inside the shortcut cheatsheet.
 */
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { ShortcutBinding } from "../../../domain/assistant/assistant-types";
import { formatCombo } from "../../../domain/assistant/shortcut-helpers";

export interface ShortcutRowProps {
  binding: ShortcutBinding;
  isCapturing: boolean;
  isCustom: boolean;
  canRestore: boolean;
  onStartCapture: () => void;
  onCancelCapture: () => void;
  onRestoreDefault: () => void;
}

export const ShortcutRow: FC<ShortcutRowProps> = ({
  binding,
  isCapturing,
  isCustom,
  canRestore,
  onStartCapture,
  onCancelCapture,
  onRestoreDefault,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-75"
      style={{
        backgroundColor: isCapturing
          ? "color-mix(in srgb, var(--color-restrict) 8%, transparent)"
          : "transparent",
      }}
    >
      {/* Key combo */}
      <kbd
        className="flex shrink-0 items-center gap-0.5 rounded-pos px-1.5 py-0.5 font-data text-caption tabular-nums"
        style={{
          backgroundColor: isCapturing
            ? "color-mix(in srgb, var(--color-restrict) 12%, transparent)"
            : "color-mix(in srgb, var(--color-ink) 8%, transparent)",
          color: isCapturing
            ? "var(--color-restrict)"
            : "color-mix(in srgb, var(--color-ink) 50%, transparent)",
          border: isCapturing
            ? "1px solid color-mix(in srgb, var(--color-restrict) 25%, transparent)"
            : "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
          minWidth: "4rem",
          justifyContent: "center",
        }}
        aria-label={
          isCapturing
            ? t("assistant.shortcuts.capture")
            : `${t("assistant.shortcuts.title")}: ${binding.description}`
        }
      >
        {isCapturing ? (
          <span className="animate-pulse text-caption">
            {t("assistant.shortcuts.capture")}
          </span>
        ) : (
          formatCombo(binding.key)
        )}
      </kbd>

      {/* Description + custom badge */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate text-body"
          style={{ color: "var(--color-ink)" }}
        >
          {binding.description}
        </span>
        {isCustom && !isCapturing && (
          <span
            className="truncate text-caption font-medium"
            style={{ color: "var(--color-pharma)" }}
          >
            {t("assistant.shortcuts.custom")}
          </span>
        )}
      </div>

      {/* Actions: Edit / Restore */}
      <div className="flex shrink-0 items-center gap-1">
        {isCapturing ? (
          <button
            type="button"
            className="rounded-pos px-2 py-1 text-caption transition-colors duration-75"
            style={{
              color: "var(--color-ink)",
              backgroundColor:
                "color-mix(in srgb, var(--color-ink) 8%, transparent)",
            }}
            onClick={onCancelCapture}
          >
            {t("common.cancel")}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="rounded-pos px-2 py-1 text-caption font-medium transition-colors duration-75"
              style={{
                color: "var(--color-pharma)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  "color-mix(in srgb, var(--color-pharma) 8%, transparent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
              onClick={onStartCapture}
              aria-label={`${t("assistant.shortcuts.edit")}: ${binding.description}`}
            >
              {t("assistant.shortcuts.edit")}
            </button>

            {canRestore && (
              <button
                type="button"
                className="rounded-pos px-2 py-1 text-caption transition-colors duration-75"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor =
                    "color-mix(in srgb, var(--color-ink) 8%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
                onClick={onRestoreDefault}
                aria-label={`${t("assistant.shortcuts.default")}: ${binding.description}`}
              >
                {t("assistant.shortcuts.default")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
