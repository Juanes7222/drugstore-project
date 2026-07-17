/**
 * PresetCard — reusable card for selecting an operation mode preset.
 *
 * Shows icon area, name, brief description. Active state with highlighted
 * border and "Activo" badge. Customized state shows "Personalizado" overlay.
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import type { PresetDefinition } from '../../../domain/config';

export interface PresetCardProps {
  /** The preset definition to display. */
  preset: PresetDefinition;
  /** Whether this preset is currently active. */
  isActive: boolean;
  /** Whether the config has overrides from this preset. */
  isCustomized: boolean;
  /** Click handler. */
  onSelect: (code: string) => void;
  /** Optional disabled state. */
  disabled?: boolean;
}

export const PresetCard: FC<PresetCardProps> = ({
  preset,
  isActive,
  isCustomized,
  onSelect,
  disabled = false,
}) => {
  const { t } = useTranslation();

  const handleClick = (): void => {
    if (!disabled) {
      onSelect(preset.code);
    }
  };

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
      disabled={disabled}
      aria-pressed={isActive}
      aria-label={`${preset.name}${isActive ? ` - ${t('config.presets.active')}` : ''}`}
      className={`
        relative flex w-full flex-col gap-2 rounded-lg border-2 p-4 text-left
        transition-colors
        focus-visible:outline-2 focus-visible:outline-offset-2
        focus-visible:outline-pharma
        disabled:cursor-not-allowed disabled:opacity-50
        ${
          isActive
            ? 'border-pharma bg-pharma/10 dark:border-pharma dark:bg-pharma/20'
            : 'border-border bg-panel hover:border-border dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-500'
        }
      `}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.15 }}
    >
      {/* Active badge */}
      {isActive && (
        <span className="absolute right-2 top-2 rounded-full bg-pharma px-2 py-0.5 text-xs font-medium text-white">
          {t('config.presets.active')}
        </span>
      )}

      {/* Customized badge overlay */}
      {isActive && isCustomized && (
        <span className="absolute bottom-2 right-2 rounded-full bg-urgency px-2 py-0.5 text-xs font-medium text-white">
          {t('config.presets.customized')}
        </span>
      )}

      {/* Icon area */}
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-variant dark:bg-gray-700">
        <PresetIcon code={preset.code} />
      </div>

      {/* Name */}
      <h3 className="text-sm font-semibold text-ink dark:text-gray-100">
        {preset.name}
      </h3>

      {/* Description */}
      <p className="text-xs text-ink-muted dark:text-gray-400 line-clamp-2">
        {preset.description}
      </p>
    </motion.button>
  );
};

// ---------------------------------------------------------------------------
// Small SVG icon per preset
// ---------------------------------------------------------------------------

interface PresetIconProps {
  code: string;
}

const PresetIcon: FC<PresetIconProps> = ({ code }) => {
  switch (code) {
    case 'SIMPLE':
      return (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-green-600"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12l2 2 4-4" />
        </svg>
      );
    case 'BALANCED':
      return (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-blue-600"
          aria-hidden="true"
        >
          <path d="M12 2v20M2 12h20" />
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12a10 10 0 0 1 20 0" />
        </svg>
      );
    case 'STRICT':
      return (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-red-600"
          aria-hidden="true"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    case 'CUSTOM':
      return (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-purple-600"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    default:
      return null;
  }
};
