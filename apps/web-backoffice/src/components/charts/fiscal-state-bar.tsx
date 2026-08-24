import { useMemo } from "react";
import Card from "@mui/material/Card";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import useTheme from "@mui/material/styles/useTheme";
import { useTranslation } from "react-i18next";
import type { FiscalCountByState } from "../../types/backoffice";

const PENDING_STATES = [
  "PENDING_GENERATION",
  "PENDING_SIGNATURE",
  "PENDING_TRANSMISSION",
  "IN_TRANSMISSION",
  "PENDING_RESPONSE",
];

const ERROR_STATES = ["GENERATION_ERROR", "SIGNATURE_ERROR"];

const PERCENT_FORMATTER = new Intl.NumberFormat("es-CO", {
  style: "percent",
  maximumFractionDigits: 1,
});

// Screen-reader-only summary style (MUI's visuallyHidden equivalent).
const SR_ONLY = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

/** Theme-aware color for the technical-error bucket (deep red family). */
function errorsColor(mode: "light" | "dark"): string {
  return mode === "light" ? "#9F1239" : "#BE123C";
}

interface FiscalStateBarProps {
  counts: FiscalCountByState[];
}

/**
 * Compliance meter for DIAN document states: one stacked bar reading like a
 * receipt line, with a ledger legend (count + share) underneath. Replaces a
 * categorical bar chart — five numbers need proportion, not axes.
 */
export function FiscalStateBar({ counts }: FiscalStateBarProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  const buckets = useMemo(() => {
    const byState = new Map(
      counts.map((row) => [row.fiscalState, row.count]),
    );
    const sumStates = (states: string[]) =>
      states.reduce((sum, state) => sum + (byState.get(state) ?? 0), 0);

    return [
      {
        key: "VALIDATED",
        label: t("fiscal.stateValidated"),
        count: byState.get("VALIDATED") ?? 0,
        color: theme.palette.success.main,
      },
      {
        key: "PENDING",
        label: t("fiscal.statePending"),
        count: sumStates(PENDING_STATES),
        color: theme.palette.warning.main,
      },
      {
        key: "CONTINGENCY",
        label: t("fiscal.stateContingency"),
        count: byState.get("CONTINGENCY") ?? 0,
        color: theme.palette.info.main,
      },
      {
        key: "REJECTED",
        label: t("fiscal.stateRejected"),
        count: byState.get("REJECTED") ?? 0,
        color: theme.palette.error.main,
      },
      {
        key: "ERRORS",
        label: t("fiscal.stateErrors"),
        count: sumStates(ERROR_STATES),
        color: errorsColor(isDark ? "dark" : "light"),
      },
    ];
  }, [counts, t, theme, isDark]);

  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

  return (
    <Card variant="outlined" className="animate-fade-up" component="figure" sx={{ m: 0, mb: 3, p: 2.5 }}>
      <Typography component="figcaption" sx={SR_ONLY}>
        {t("fiscal.stateBarAria", { total })}
      </Typography>

      <Box display="flex" flexWrap="wrap" alignItems="baseline" justifyContent="space-between" gap={1} mb={1.5}>
        <Typography variant="overline" color="text.secondary">
          {t("fiscal.countsByState")}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: "tabular-nums" }}
        >
          {t("fiscal.totalDocs", { total })}
        </Typography>
      </Box>

      {/* Decorative for assistive tech; the figcaption and legend carry the data. */}
      <Box aria-hidden sx={{ display: "flex", gap: "2px", height: 12, borderRadius: 1.5, overflow: "hidden", bgcolor: "action.hover" }}>
        {buckets.map((bucket) =>
          bucket.count > 0 ? (
            <Box
              key={bucket.key}
              title={`${bucket.label}: ${bucket.count}`}
              sx={{ flexBasis: `${(bucket.count / total) * 100}%`, minWidth: 4, bgcolor: bucket.color }}
            />
          ) : null,
        )}
      </Box>

      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, mt: 1.5 }}>
        {buckets.map((bucket, index) => (
          <li key={bucket.key}>
            <Box
              display="flex"
              alignItems="center"
              gap={1}
              py={0.75}
              {...(index > 0 ? { borderTop: `1px solid ${theme.palette.divider}` } : {})}
              sx={bucket.count === 0 ? { opacity: 0.55 } : undefined}
            >
              <Box
                aria-hidden
                sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: bucket.color, flexShrink: 0 }}
              />
              <Typography variant="body2" sx={{ flexGrow: 1 }}>
                {bucket.label}
              </Typography>
              {bucket.count > 0 && total > 0 ? (
                <Typography variant="caption" color="text.secondary" mr={1.5}>
                  {PERCENT_FORMATTER.format(bucket.count / total)}
                </Typography>
              ) : null}
              <Typography
                variant="body2"
                fontWeight={700}
                sx={{ fontVariantNumeric: "tabular-nums", minWidth: 40, textAlign: "right" }}
              >
                {new Intl.NumberFormat("es-CO").format(bucket.count)}
              </Typography>
            </Box>
          </li>
        ))}
      </Box>
    </Card>
  );
}
