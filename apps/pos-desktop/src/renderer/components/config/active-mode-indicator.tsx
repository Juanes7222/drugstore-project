/**
 * ActiveModeIndicator — small color-coded badge in top nav showing current mode.
 *
 * "Modo Simple" (green), "Modo Balanceado" (yellow), "Modo Estricto" (red),
 * "Modo Personalizado" (gray). Click to open config page.
 * Updates reactively when preset changes via useTenantConfig().
 */
import { type FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { useTenantConfig } from '../../../domain/config/use-tenant-config';
import { EyeIcon } from "@/components/ui/icons";

export interface ActiveModeIndicatorProps {
  /** Click handler — navigate to config page or show summary. */
  onClick?: () => void;
  /** If true, clicking shows a read-only summary instead of opening config. */
  readOnly?: boolean;
}

const MODE_COLORS: Record<string, { dot: string; bg: string; text: string; label: string }> = {
  SIMPLE: {
    dot: 'bg-pharma',
    bg: 'bg-success-container',
    text: 'text-pharma',
    label: 'indicator.mode_simple',
  },
  BALANCED: {
    dot: 'bg-urgency',
    bg: 'bg-urgency-surface',
    text: 'text-urgency',
    label: 'indicator.mode_balanced',
  },
  STRICT: {
    dot: 'bg-error',
    bg: 'bg-error-container',
    text: 'text-error',
    label: 'indicator.mode_strict',
  },
  CUSTOM: {
    dot: 'bg-sync',
    bg: 'bg-surface-variant',
    text: 'text-ink-muted',
    label: 'indicator.mode_custom',
  },
};

export const ActiveModeIndicator: FC<ActiveModeIndicatorProps> = ({
  onClick,
  readOnly = false,
}) => {
  const { t } = useTranslation();
  const { effectiveConfig } = useTenantConfig();

  const presetCode = effectiveConfig?.activePresetCode ?? 'CUSTOM';
  const colors = MODE_COLORS[presetCode] ?? MODE_COLORS.CUSTOM;

  const handleClick = useCallback(() => {
    if (onClick) {
      onClick();
    }
  }, [onClick]);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={t('config.indicator.click_to_open')}
      title={t('config.indicator.click_to_open')}
      className={`
        inline-flex items-center gap-1.5 rounded-full px-3 py-1
        text-xs font-medium
        transition-colors
        focus-visible:outline-2 focus-visible:outline-offset-2
        focus-visible:outline-pharma
        ${colors.bg} ${colors.text}
        ${onClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}
      `}
      whileTap={onClick ? { scale: 0.95 } : undefined}
      transition={{ duration: 0.15 }}
    >
      <span className={`h-2 w-2 rounded-full ${colors.dot}`} aria-hidden="true" />
      <span>{t('config.' + colors.label)}</span>
      {readOnly && <EyeIcon size={12} />}
    </motion.button>
  );
};
