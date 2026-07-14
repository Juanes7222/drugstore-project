/**
 * ShortcutSearchInput — search input with icon and clear button,
 * used inside the shortcut cheatsheet.
 */
import type { ChangeEvent, FC, RefObject } from "react";
import { useTranslation } from "react-i18next";

export interface ShortcutSearchInputProps {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onClear: () => void;
}

export const ShortcutSearchInput: FC<ShortcutSearchInputProps> = ({
  value,
  onChange,
  disabled,
  inputRef,
  onClear,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5"
      style={{
        borderBottom:
          "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
        backgroundColor:
          "color-mix(in srgb, var(--color-surface) 40%, white)",
      }}
    >
      {/* Search icon */}
      <svg
        className="h-3.5 w-3.5 shrink-0"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
        style={{
          color:
            "color-mix(in srgb, var(--color-ink) 40%, transparent)",
        }}
      >
        <path
          d="M7.333 12.667A5.333 5.333 0 1 0 7.333 2a5.333 5.333 0 0 0 0 10.667ZM14 14l-2.9-2.9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={onChange}
        placeholder={t("assistant.shortcuts.search")}
        aria-label={t("assistant.shortcuts.search")}
        className="flex-1 border-none bg-transparent text-body outline-none"
        style={{
          color: "var(--color-ink)",
          fontFamily: "var(--font-ui)",
        }}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />

      {/* Clear search button */}
      {value.trim() !== "" && (
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded-full transition-colors duration-75"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 40%, transparent)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor =
              "color-mix(in srgb, var(--color-ink) 8%, transparent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
          onClick={onClear}
          aria-label={t("common.close")}
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden
          >
            <path
              d="M10 2L2 10M2 2l8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
};
