/**
 * HelpNotFoundState — shown when a helpTopicId was provided but no matching
 * entry was found.
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircleIcon } from "@/components/ui/icons";

interface HelpNotFoundStateProps {
  onGoToIndex: () => void;
}

export const HelpNotFoundState: FC<HelpNotFoundStateProps> = ({
  onGoToIndex,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <HelpCircleIcon
        className="mb-4 h-10 w-10"
        style={{
          color: 'color-mix(in srgb, var(--color-ink) 25%, transparent)',
        }}
      />
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
