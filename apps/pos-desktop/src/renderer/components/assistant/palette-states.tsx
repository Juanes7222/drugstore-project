/**
 * Palette state components — building index spinner, error alert,
 * empty results message, and welcome/placeholder state.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";

/**
 * Full-page spinner shown while the search index is being built.
 */
export const PaletteIndexBuilding: FC = () => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center px-4 py-12">
      <svg
        className="mb-3 h-6 w-6 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        style={{
          color:
            "color-mix(in srgb, var(--color-ink) 40%, transparent)",
        }}
        aria-hidden
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray="50"
          strokeDashoffset="15"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <p
        className="mt-3 text-body"
        style={{
          color:
            "color-mix(in srgb, var(--color-ink) 50%, transparent)",
        }}
      >
        {t("assistant.palette.building_index")}
      </p>
    </div>
  );
};

/**
 * Error alert shown when a search fails.
 */
export interface PaletteSearchErrorProps {
  message: string;
}

export const PaletteSearchError: FC<PaletteSearchErrorProps> = ({
  message,
}) => (
  <div
    className="mx-4 mt-2 rounded-pos px-3 py-2 text-caption"
    style={{
      backgroundColor:
        "color-mix(in srgb, var(--color-urgency) 10%, transparent)",
      color: "var(--color-urgency)",
    }}
    role="alert"
  >
    {message}
  </div>
);

/**
 * Empty results state — shown when a query returns no results.
 */
export interface PaletteEmptyResultsProps {
  query: string;
}

export const PaletteEmptyResults: FC<PaletteEmptyResultsProps> = ({
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
        {t("assistant.palette.no_results", { query })}
      </p>
    </div>
  );
};

/**
 * Welcome state — shown when no query has been entered yet.
 */
export const PaletteWelcomeState: FC = () => {
  const { t } = useTranslation();

  return (
    <div className="px-4 py-8">
      <p
        className="text-center text-body"
        style={{
          color:
            "color-mix(in srgb, var(--color-ink) 40%, transparent)",
        }}
      >
        {t("assistant.palette.placeholder")}
      </p>
    </div>
  );
};
