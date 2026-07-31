/**
 * PresetCard — reusable card for selecting an operation mode preset.
 *
 * Shows icon area, name, brief description. Active state with highlighted
 * border and "Activo" badge. Customized state shows "Personalizado" overlay.
 */
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import type { PresetDefinition } from '../../../domain/config';
import { CheckCircleIcon, ClockIcon, LockIcon, SettingsIcon } from "@/components/ui/icons";

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
  const [isHovered, setIsHovered] = useState(false);

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

  const displayName = preset.nameI18nKey ? t(preset.nameI18nKey) : preset.name;
  const displayDescription = preset.descriptionI18nKey
    ? t(preset.descriptionI18nKey)
    : preset.description;

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={disabled}
      aria-pressed={isActive}
      aria-label={`${displayName}${isActive ? ` - ${t('config.presets.active')}` : ''}`}
      className={`
        relative flex w-full flex-col gap-2 rounded-sm border-2 p-4 text-left
        transition-colors
        focus-visible:outline-2 focus-visible:outline-offset-2
        focus-visible:outline-pharma
        disabled:cursor-not-allowed disabled:opacity-50
        ${
          isActive
            ? 'border-pharma bg-pharma/[0.08]'
            : 'border-border bg-panel'
        }
        ${!disabled && !isActive ? 'hover:border-ink/20' : ''}
      `}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      {/* Active badge */}
      {isActive && (
        <motion.span
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute right-2 top-2 rounded-full bg-pharma px-2 py-0.5 text-caption font-semibold text-white"
        >
          {t('config.presets.active')}
        </motion.span>
      )}

      {/* Customized badge overlay */}
      {isActive && isCustomized && (
        <motion.span
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute bottom-2 right-2 rounded-full bg-urgency px-2 py-0.5 text-caption font-semibold text-white"
        >
          {t('config.presets.customized')}
        </motion.span>
      )}

      {/* Icon area */}
      <motion.div
        className="flex h-10 w-10 items-center justify-center rounded-sm bg-surface-variant"
        animate={isHovered && !disabled ? { scale: 1.05 } : { scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
      >
        <PresetIcon code={preset.code} />
      </motion.div>

      {/* Name */}
      <h3         className="text-body-sm font-semibold text-ink">
        {displayName}
      </h3>

      {/* Description */}
      <p className="text-caption text-ink-muted line-clamp-2">
        {displayDescription}
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
        <CheckCircleIcon size={20} className="text-pharma" />
      );
    case 'BALANCED':
      return (
        <ClockIcon size={20} className="text-urgency" />
      );
    case 'STRICT':
      return (
        <LockIcon size={20} className="text-error" />
      );
    case 'CUSTOM':
      return (
        <SettingsIcon size={20} className="text-restrict" />
      );
    default:
      return null;
  }
};
