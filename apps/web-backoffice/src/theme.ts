import { createTheme, alpha } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";

/**
 * Motion tokens shared by component overrides. UI animations stay under
 * 300ms; ease-out curves keep interactions feeling responsive.
 */
export const EASING = {
  outExpo: "cubic-bezier(0.23, 1, 0.32, 1)",
  inOut: "cubic-bezier(0.77, 0, 0.175, 1)",
} as const;

export const DURATION = {
  press: 160,
  micro: 150,
  enter: 200,
} as const;

const PALETTE = {
  light: {
    canvas: "#F6F8FA",
    paper: "#FFFFFF",
    divider: "#E2E8F0",
    textPrimary: "#0F172A",
    textSecondary: "#5B6779",
    primary: "#0E7490",
    success: "#15803D",
    warning: "#B45309",
    error: "#DC2626",
    info: "#0369A1",
  },
  dark: {
    canvas: "#0F172A",
    paper: "#16213A",
    divider: "#283548",
    textPrimary: "#EDF2F7",
    textSecondary: "#94A3B8",
    primary: "#22D3EE",
    success: "#4ADE80",
    warning: "#FBBF24",
    error: "#F87171",
    info: "#38BDF8",
  },
} as const;

export function buildTheme(mode: "light" | "dark"): Theme {
  const c = PALETTE[mode];

  return createTheme({
    palette: {
      mode,
      primary: { main: c.primary, contrastText: mode === "light" ? "#FFFFFF" : "#083344" },
      secondary: { main: mode === "light" ? "#475569" : "#CBD5E1" },
      success: { main: c.success },
      warning: { main: c.warning },
      error: { main: c.error },
      info: { main: c.info },
      background: { default: c.canvas, paper: c.paper },
      divider: c.divider,
      text: { primary: c.textPrimary, secondary: c.textSecondary },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily:
        '"Inter", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
      h5: { letterSpacing: "-0.01em" },
      // Values are the hero of a data dashboard; tabular figures stop
      // digits from jittering on refresh.
      h6: { letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" },
      button: { textTransform: "none", fontWeight: 600 },
      overline: { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", lineHeight: 1.6 },
      caption: { letterSpacing: "0.01em" },
    },
    components: {
      MuiCard: {
        defaultProps: { elevation: 0 },
      },
      MuiPaper: {
        styleOverrides: {
          outlined: { borderColor: c.divider },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            transition: `transform ${DURATION.press}ms ${EASING.outExpo}, background-color ${DURATION.micro}ms ease, border-color ${DURATION.micro}ms ease`,
            "&:active": { transform: "scale(0.98)" },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            transition: `transform ${DURATION.press}ms ${EASING.outExpo}, background-color ${DURATION.micro}ms ease`,
            "&:active": { transform: "scale(0.94)" },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            transition: `background-color ${DURATION.micro}ms ease`,
            "&.Mui-selected": {
              backgroundColor: alpha(c.primary, mode === "light" ? 0.1 : 0.16),
              "&:hover": {
                backgroundColor: alpha(c.primary, mode === "light" ? 0.14 : 0.2),
              },
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          // Column headers read as ticket labels, not body copy.
          head: {
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: c.textSecondary,
            borderBottom: `1px solid ${c.divider}`,
          },
          root: { borderColor: c.divider },
        },
      },
      MuiChip: {
        styleOverrides: {
          outlined: { backgroundColor: alpha(c.textPrimary, 0.03) },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: {
            backgroundColor:
              mode === "light"
                ? alpha("#0F172A", 0.08)
                : alpha("#EDF2F7", 0.1),
          },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
      },
    },
  });
}
