export const REPORT_THEME = {
  colors: {
    pharma: '#0B6E6B',
    urgency: '#E8780A',
    sync: '#4A6572',
    restrict: '#5B3E96',
    surface: '#F9F6F0',
    surfaceVariant: '#EDE9E1',
    panel: '#FFFFFF',
    ink: '#171614',
    inkMuted: '#8B8A87',
    border: '#D4D2CC',
    error: '#D32F2F',
    errorContainer: '#FCE4E4',
    successContainer: '#E0F2F1',
    warningContainer: '#FFF3E5',
    restrictContainer: '#F0EBFA',
  },
  fonts: {
    ui: 'Inter',
    data: 'JetBrains Mono',
    pdfFallback: 'helvetica',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  radius: {
    small: 4,
    medium: 8,
  },
} as const;

export function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

export function hexToArgb(hex: string): string {
  return `FF${hex.replace('#', '').toUpperCase()}`;
}