/**
 * Suggestion banner — non-blocking contextual suggestions from the rule-based
 * suggestion engine.
 *
 * Renders at the top of the main POS view. Max 3 non-critical suggestions
 * visible at once; if more are active, lower-priority ones collapse into a
 * "+N más" link that expands a slide-down tray. CRITICAL suggestions appear
 * in a separate persistent top strip with no dismiss or collapse.
 *
 * Reads active suggestions from the Zustand assistant store, and calls
 * dismissSuggestion on the user-preferences store for INFO/WARN closings.
 */

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAssistantStore } from "../../../stores/assistant.store";
import { useUserPreferencesStore } from "../../../stores/user-preferences.store";
import type { ActiveSuggestion } from "../../../domain/assistant/assistant-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of non-critical suggestions visible before the "+N más" link. */
const MAX_VISIBLE = 3;

// ---------------------------------------------------------------------------
// Severity tokens — maps severity to design-system colours
// ---------------------------------------------------------------------------

interface SeverityTokens {
  /** Left-border colour for the suggestion bar. */
  indicator: string;
  /** Subtle background tint for the suggestion bar. */
  surface: string;
  /** Text colour for the action link label. */
  accent: string;
}

const SEVERITY: Record<ActiveSuggestion["severity"], SeverityTokens> = {
  CRITICAL: {
    indicator: "var(--color-urgency)",
    surface: "var(--color-urgency-surface)",
    accent: "var(--color-urgency)",
  },
  WARN: {
    indicator: "var(--color-urgency)",
    surface: "transparent",
    accent: "var(--color-urgency)",
  },
  INFO: {
    indicator: "var(--color-pharma)",
    surface: "transparent",
    accent: "var(--color-pharma)",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an optional translation key for a suggestion's title.
 *
 * The rule IDs already carry a `suggestion.` segment (e.g.
 * `suggestion.warn.sync-stale`), so we strip the leading prefix to produce
 * a clean key: `assistant.suggestion.warn.sync-stale.title`.
 */
function titleTranslationKey(ruleId: string): string {
  const stripped = ruleId.replace(/^suggestion\./, "");
  return `assistant.suggestion.${stripped}.title`;
}

// ---------------------------------------------------------------------------
// SuggestionItem
// ---------------------------------------------------------------------------

interface SuggestionItemProps {
  suggestion: ActiveSuggestion;
  onDismiss: (ruleId: string) => void;
  onAction: (suggestion: ActiveSuggestion) => void;
  /** CRITICAL items use a denser, more prominent layout. */
  isCritical?: boolean;
}

const SuggestionItem: FC<SuggestionItemProps> = ({
  suggestion,
  onDismiss,
  onAction,
  isCritical = false,
}) => {
  const { t } = useTranslation();
  const tokens = SEVERITY[suggestion.severity];

  const handleActionClick = useCallback(() => {
    onAction(suggestion);
  }, [onAction, suggestion]);

  const handleDismissClick = useCallback(() => {
    onDismiss(suggestion.ruleId);
  }, [onDismiss, suggestion.ruleId]);

  return (
    <div
      className="flex items-start gap-3"
      style={{
        borderLeft: `3px solid ${tokens.indicator}`,
        backgroundColor: isCritical ? tokens.surface : "transparent",
        padding: isCritical
          ? "var(--spacing-pos-xs) var(--spacing-pos-lg)"
          : "var(--spacing-pos-sm) var(--spacing-pos-lg)",
      }}
      role="status"
    >
      {/* Severity dot — hidden indicator for screen-readers */}
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: tokens.indicator }}
        aria-hidden="true"
      />

      {/* Title + description */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body-sm font-semibold text-ink">
          {t(titleTranslationKey(suggestion.ruleId), {
            defaultValue: suggestion.title,
          })}
        </span>
        <span
          className="truncate text-caption"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
          }}
        >
          {suggestion.description}
        </span>
      </div>

      {/* Action button — styled as a text link */}
      <button
        type="button"
        className="pos-button shrink-0 text-caption font-semibold"
        style={{
          color: tokens.accent,
          backgroundColor: "transparent",
          border: "none",
          padding: "var(--spacing-pos-xs) var(--spacing-pos-sm)",
          minWidth: 0,
        }}
        onClick={handleActionClick}
      >
        {suggestion.action.label}
      </button>

      {/* Dismiss button — hidden for persistent CRITICAL suggestions */}
      {suggestion.dismissable && (
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-pos transition-colors duration-75"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 30%, transparent)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--color-ink)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color =
              "color-mix(in srgb, var(--color-ink) 30%, transparent)";
          }}
          onClick={handleDismissClick}
          aria-label={t("common.close")}
        >
          {/* × icon */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M9 3L3 9M3 3l6 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// SuggestionBanner
// ---------------------------------------------------------------------------

export const SuggestionBanner: FC = () => {
  const { t } = useTranslation();

  const suggestions = useAssistantStore((s) => s.suggestions);
  const suggestionsExpanded = useAssistantStore((s) => s.suggestionsExpanded);
  const setSuggestionsExpanded = useAssistantStore(
    (s) => s.setSuggestionsExpanded,
  );
  const dismissSuggestion = useUserPreferencesStore(
    (s) => s.dismissSuggestion,
  );

  // -- Derive --
  const criticalSuggestions = suggestions.filter(
    (s) => s.severity === "CRITICAL",
  );
  const nonCriticalSuggestions = suggestions.filter(
    (s) => s.severity !== "CRITICAL",
  );

  const hasAny = suggestions.length > 0;

  const showAllNonCritical =
    suggestionsExpanded || nonCriticalSuggestions.length <= MAX_VISIBLE;

  const visibleNonCritical = showAllNonCritical
    ? nonCriticalSuggestions
    : nonCriticalSuggestions.slice(0, MAX_VISIBLE);

  const hiddenCount = nonCriticalSuggestions.length - MAX_VISIBLE;

  // -- Handlers --
  const handleDismiss = useCallback(
    (ruleId: string) => {
      dismissSuggestion(ruleId);
    },
    [dismissSuggestion],
  );

  const handleAction = useCallback(
    (suggestion: ActiveSuggestion) => {
      suggestion.action.execute();
    },
    [],
  );

  const handleToggleExpand = useCallback(() => {
    setSuggestionsExpanded(!suggestionsExpanded);
  }, [suggestionsExpanded, setSuggestionsExpanded]);

  // -- Early exit: nothing to show --
  if (!hasAny) return null;

  return (
    <div
      className="w-full"
      style={{
        borderBottom:
          "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
      }}
      role="region"
      aria-label={t("assistant.suggestion.label")}
    >
      {/* ------------------------------------------------------------------ */}
      {/* CRITICAL strip — always visible, no collapse, no dismiss           */}
      {/* ------------------------------------------------------------------ */}
      {criticalSuggestions.length > 0 && (
        <div
          className="flex flex-col"
          style={{
            borderBottom:
              "1px solid color-mix(in srgb, var(--color-urgency) 15%, transparent)",
          }}
        >
          {criticalSuggestions.map((suggestion) => (
            <SuggestionItem
              key={suggestion.ruleId}
              suggestion={suggestion}
              onDismiss={handleDismiss}
              onAction={handleAction}
              isCritical
            />
          ))}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Non-CRITICAL suggestions — max 3 visible, expandable               */}
      {/* ------------------------------------------------------------------ */}
      {visibleNonCritical.length > 0 && (
        <div className="flex flex-col">
          {visibleNonCritical.map((suggestion) => (
            <SuggestionItem
              key={suggestion.ruleId}
              suggestion={suggestion}
              onDismiss={handleDismiss}
              onAction={handleAction}
            />
          ))}

          {/* "+N más" / "Mostrar menos" collapse toggle */}
          {nonCriticalSuggestions.length > MAX_VISIBLE && (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1 py-1.5 text-caption font-medium transition-colors duration-75 hover:text-ink"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                backgroundColor: "transparent",
                border: "none",
                cursor: "pointer",
              }}
              onClick={handleToggleExpand}
            >
              {suggestionsExpanded
                ? t("assistant.suggestion.showLess")
                : t("assistant.suggestion.more", { count: hiddenCount })}
              {/* Chevron icon */}
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                aria-hidden="true"
                className={suggestionsExpanded ? "rotate-180" : ""}
                style={{ transition: "transform 150ms ease" }}
              >
                <path
                  d="M2 3.5l3 3 3-3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
