/**
 * ECharts theme tokens for the local reports module.
 *
 * Centralised so every chart on the Reports page picks up the same
 * semantic palette and respects the POS design system.  The values
 * mirror the design tokens defined in `src/renderer/dev/design-tokens.tsx`.
 */

export interface ReportChartTheme {
  brand: string;
  positive: string;
  warning: string;
  danger: string;
  neutral: string;
  textPrimary: string;
  textMuted: string;
  surface: string;
  border: string;
  series: string[];
}

export const reportChartTheme: ReportChartTheme = {
  brand: '#0B6E6B',
  positive: '#1F8A4C',
  warning: '#E8780A',
  danger: '#C0392B',
  neutral: '#4A6572',
  textPrimary: '#171614',
  textMuted: '#5A5754',
  surface: '#F9F6F0',
  border: '#E5E0D6',
  series: [
    '#0B6E6B', // pharma teal
    '#E8780A', // urgency amber
    '#5B3E96', // restrict violet
    '#4A6572', // sync slate
    '#1F8A4C', // positive
    '#C0392B', // danger
    '#8C6A3D', // ochre
    '#2A6B8F', // ocean
  ],
};

export const chartToneColor = (
  tone: 'positive' | 'warning' | 'danger' | 'neutral' | 'brand' | undefined,
): string | undefined => {
  if (!tone) return undefined;
  return reportChartTheme[tone];
};
