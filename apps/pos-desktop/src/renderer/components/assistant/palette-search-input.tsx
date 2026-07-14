/**
 * Palette search input — the header search bar with icon and optional
 * building-index spinner indicator.
 */
import {
  type ChangeEvent,
  type FC,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

export interface PaletteSearchInputProps {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  isBuilding: boolean;
  placeholder: string;
}

export const PaletteSearchInput: FC<PaletteSearchInputProps> = ({
  value,
  onChange,
  onKeyDown,
  inputRef,
  disabled,
  isBuilding,
  placeholder,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-center gap-3 px-4"
      style={{
        borderBottom:
          "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
      }}
    >
      {/* Search icon */}
      <svg
        className="h-4 w-4 shrink-0"
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
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 border-none bg-transparent py-3.5 text-body outline-none"
        style={{
          color: "var(--color-ink)",
          fontFamily: "var(--font-ui)",
        }}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />

      {/* Building index spinner in the search bar */}
      {isBuilding && (
        <div className="flex shrink-0 items-center gap-2 text-caption">
          <svg
            className="h-3.5 w-3.5 animate-spin"
            viewBox="0 0 16 16"
            fill="none"
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
            aria-hidden
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="28"
              strokeDashoffset="8"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
          <span
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            {t("assistant.palette.building_index")}
          </span>
        </div>
      )}
    </div>
  );
};
