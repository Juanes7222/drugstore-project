/**
 * FormMemoryAutocomplete — positioned dropdown that provides auto-complete
 * suggestions for form fields based on previously entered values.
 *
 * Renders below the input element when the field has stored suggestions,
 * auto-complete is not opted out, and the input is focused. Typing filters
 * the list (startsWith, case-insensitive). Selecting a suggestion refreshes
 * the timestamp via the form memory service. A small opt-out link lets the
 * user disable auto-complete for the field entirely.
 *
 * ## States
 * - No suggestions: renders children only (no dropdown)
 * - Opted-out: renders children only (no dropdown)
 * - Has suggestions + input focused: shows dropdown with filtered list
 * - Empty filter result: shows "No se encontraron sugerencias" message
 * - Opt-out link at the bottom: persists opt-out to user preferences store
 */

import {
  type FC,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { createFormMemoryService } from "../../../domain/assistant/form-memory.service";
import { useUserPreferencesStore } from "../../../stores/user-preferences.store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormMemoryAutocompleteProps {
  /** Stable form identifier (e.g. "inventory-adjustment-form"). */
  formId: string;
  /** Field identifier (e.g. "reason"). */
  fieldId: string;
  /** The current value of the input field. */
  value: string;
  /** Callback when a suggestion is selected. */
  onSelect: (value: string) => void;
  /** The input element this attaches to — must be a single child. */
  children: ReactNode;
  /** Maximum suggestions to show (default 8). */
  maxSuggestions?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Key separator for the form memory cache and preferences store. */
const KEY_SEPARATOR = "::" as const;

/** Maximum height of the suggestion list before scrolling. */
const MAX_DROPDOWN_HEIGHT = 200;

/** Minimum number of matching suggestions required to show the dropdown. */
const MIN_MATCHES_TO_SHOW = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the stable field key used by both the form memory service (cache)
 * and the user preferences store (opt-out).
 */
function buildFieldKey(formId: string, fieldId: string): string {
  return `${formId}${KEY_SEPARATOR}${fieldId}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FormMemoryAutocomplete: FC<FormMemoryAutocompleteProps> = ({
  formId,
  fieldId,
  value,
  onSelect,
  children,
  maxSuggestions = 8,
}) => {
  const { t } = useTranslation();

  // -- State --
  const [isFocused, setIsFocused] = useState(false);

  // -- Refs --
  const containerRef = useRef<HTMLDivElement>(null);
  /** Stable service instance across renders — never restarted. */
  const formMemoryRef = useRef(createFormMemoryService());

  // -- Store selectors --
  const optOutFormField = useUserPreferencesStore((s) => s.optOutFormField);
  const isFormFieldOptedOut = useUserPreferencesStore(
    (s) => s.isFormFieldOptedOut,
  );

  // -- Derived --
  const fieldKey = buildFieldKey(formId, fieldId);
  const isOptedOut = isFormFieldOptedOut(fieldKey);

  // -- Suggestions --
  const allSuggestions = useMemo(
    () =>
      isOptedOut
        ? []
        : formMemoryRef.current.getSuggestions(formId, fieldId),
    [formId, fieldId, isOptedOut],
  );

  const filteredSuggestions = useMemo(() => {
    if (!value.trim()) {
      return allSuggestions.slice(0, maxSuggestions);
    }
    const lowerValue = value.trim().toLowerCase();
    return allSuggestions
      .filter((s) => s.toLowerCase().startsWith(lowerValue))
      .slice(0, maxSuggestions);
  }, [allSuggestions, value, maxSuggestions]);

  const showDropdown =
    isFocused && !isOptedOut && filteredSuggestions.length >= MIN_MATCHES_TO_SHOW;

  // -- Focus management --
  // React attaches onFocus as focusin (bubbles), so a single handler on the
  // wrapper catches focus from any child input/textarea/select.
  const handleFocusCapture = useCallback(() => {
    setIsFocused(true);
  }, []);

  // -- Outside click --
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // -- Escape key --
  useEffect(() => {
    if (!showDropdown) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFocused(false);
        e.preventDefault();
        // Return focus to the input element inside the container
        const input = containerRef.current?.querySelector<HTMLElement>(
          "input, textarea, select",
        );
        input?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showDropdown]);

  // -- Scroll / resize repositioning --
  // The dropdown uses `position: absolute; top: 100%` relative to the
  // container, so it follows the container automatically on scroll or resize
  // of the viewport.  No manual recalculation needed.

  // -- Handlers --

  const handleSelect = useCallback(
    (suggestion: string) => {
      onSelect(suggestion);
      formMemoryRef.current.remember(formId, fieldId, suggestion);
      setIsFocused(false);
      // Return focus to the input for continued typing
      const input = containerRef.current?.querySelector<HTMLElement>(
        "input, textarea, select",
      );
      input?.focus();
    },
    [onSelect, formId, fieldId],
  );

  const handleOptOut = useCallback(() => {
    optOutFormField(fieldKey);
    setIsFocused(false);
    const input = containerRef.current?.querySelector<HTMLElement>(
      "input, textarea, select",
    );
    input?.focus();
  }, [optOutFormField, fieldKey]);

  // -- Highlight matching portion --
  const highlightMatch = useCallback(
    (suggestion: string): { matchPart: string; rest: string } | null => {
      if (!value.trim()) return null;
      const lowerValue = value.trim().toLowerCase();
      const lowerSuggestion = suggestion.toLowerCase();
      if (lowerSuggestion.startsWith(lowerValue)) {
        return {
          matchPart: suggestion.slice(0, value.trim().length),
          rest: suggestion.slice(value.trim().length),
        };
      }
      return null;
    },
    [value],
  );

  // -- Render --

  return (
    <div
      ref={containerRef}
      className="relative"
      onFocus={handleFocusCapture}
    >
      {children}

      {showDropdown && (
        <div
          className="absolute left-0 right-0 z-30 mt-0.5 overflow-y-auto rounded-pos border"
          style={{
            maxHeight: MAX_DROPDOWN_HEIGHT,
            backgroundColor: "var(--color-panel)",
            borderColor:
              "color-mix(in srgb, var(--color-ink) 12%, transparent)",
            boxShadow:
              "0 4px 12px color-mix(in srgb, var(--color-ink) 8%, transparent)",
          }}
          role="listbox"
          aria-label={t("assistant.formMemory.recent")}
        >
          {/* ---- Header ---- */}
          <div
            className="px-2.5 py-1.5 text-caption font-medium"
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 45%, transparent)",
              borderBottom:
                "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
            }}
          >
            {t("assistant.formMemory.recent")}
          </div>

          {/* ---- Suggestion items ---- */}
          <div className="py-0.5">
            {filteredSuggestions.length > 0 ? (
              filteredSuggestions.map((suggestion, index) => {
                const highlighted = highlightMatch(suggestion);
                return (
                  <button
                    key={`${suggestion}-${index}`}
                    type="button"
                    className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-body-sm transition-colors duration-75"
                    style={{ color: "var(--color-ink)" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        "color-mix(in srgb, var(--color-pharma) 8%, transparent)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        "transparent";
                    }}
                    onFocus={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        "color-mix(in srgb, var(--color-pharma) 8%, transparent)";
                    }}
                    onBlur={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        "transparent";
                    }}
                    onClick={() => handleSelect(suggestion)}
                    role="option"
                    aria-selected={false}
                  >
                    {highlighted ? (
                      <>
                        <span className="font-semibold">
                          {highlighted.matchPart}
                        </span>
                        <span>{highlighted.rest}</span>
                      </>
                    ) : (
                      <span>{suggestion}</span>
                    )}
                  </button>
                );
              })
            ) : (
              <div
                className="px-2.5 py-2 text-caption"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                }}
              >
                {t("assistant.formMemory.noSuggestions")}
              </div>
            )}
          </div>

          {/* ---- Opt-out link ---- */}
          <button
            type="button"
            className="flex w-full items-center px-2.5 py-1.5 text-caption transition-colors duration-75"
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 40%, transparent)",
              borderTop:
                "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color =
                "var(--color-ink)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color =
                "color-mix(in srgb, var(--color-ink) 40%, transparent)";
            }}
            onFocus={(e) => {
              (e.currentTarget as HTMLElement).style.color =
                "var(--color-ink)";
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLElement).style.color =
                "color-mix(in srgb, var(--color-ink) 40%, transparent)";
            }}
            onClick={handleOptOut}
          >
            {t("assistant.formMemory.optOut")}
          </button>
        </div>
      )}
    </div>
  );
};
