/**
 * HelpNotFoundState — shown when a helpTopicId was provided but no matching
 * entry was found.
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface HelpNotFoundStateProps {
  onGoToIndex: () => void;
}

export const HelpNotFoundState: FC<HelpNotFoundStateProps> = ({
  onGoToIndex,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <svg
        className="mb-4 h-10 w-10"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        style={{
          color: 'color-mix(in srgb, var(--color-ink) 25%, transparent)',
        }}
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M12 8v4M12 16h.007"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <p
        className="mb-2 text-body font-medium"
        style={{ color: 'var(--color-ink)' }}
      >
        {t('assistant.help.notFound')}
      </p>
      <button
        type="button"
        className="pos-button pos-button-secondary text-caption"
        onClick={onGoToIndex}
      >
        {t('assistant.help.fallback')}
      </button>
    </div>
  );
};
