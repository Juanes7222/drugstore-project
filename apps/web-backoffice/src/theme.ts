import { createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

export function buildTheme(mode: 'light' | 'dark'): Theme {
  return createTheme({
    palette: {
      mode,
      primary: {
        main: '#0E7490',
        light: '#06B6D4',
        dark: '#155E75',
        contrastText: '#FFFFFF',
      },
      secondary: {
        main: '#475569',
        light: '#64748B',
        dark: '#334155',
        contrastText: '#FFFFFF',
      },
      background: {
        default: mode === 'light' ? '#F1F5F9' : '#0F172A',
        paper: mode === 'light' ? '#FFFFFF' : '#1E293B',
      },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily:
        '"Inter", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
    },
    components: {
      MuiCard: {
        defaultProps: { elevation: 0 },
      },
      MuiTableCell: {
        styleOverrides: {
          head: { fontWeight: 700 },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
      },
    },
  });
}