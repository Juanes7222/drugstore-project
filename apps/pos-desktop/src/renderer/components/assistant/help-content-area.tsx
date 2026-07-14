/**
 * HelpContentArea — main content area with header and body for the help viewer.
 */
import { type FC } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import type { HelpContentEntry } from '../../../help-content';
import type { EntryGroup } from '../../../domain/assistant/help-helpers';
import { TopicContent } from './help-topic-content';
import { HelpNotFoundState } from './help-not-found-state';
import { HelpWelcomeIndex } from './help-welcome-index';

interface HelpContentAreaProps {
  selectedTopic: HelpContentEntry | null;
  helpTopicId: string | null;
  isProcedure: boolean;
  checkedSteps: Set<number>;
  onToggleStep: (stepIndex: number) => void;
  onGoToIndex: () => void;
  groupedEntries: EntryGroup[];
  onSelectTopic: (id: string) => void;
}

export const HelpContentArea: FC<HelpContentAreaProps> = ({
  selectedTopic,
  helpTopicId,
  isProcedure,
  checkedSteps,
  onToggleStep,
  onGoToIndex,
  groupedEntries,
  onSelectTopic,
}) => {
  const { t } = useTranslation();

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{
          borderBottom:
            '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
        }}
      >
        <h2
          className="text-ui font-semibold"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('assistant.help.title')}
        </h2>
        <div className="flex items-center gap-2">
          {selectedTopic && (
            <button
              type="button"
              className="pos-button pos-button-secondary text-caption"
              onClick={onGoToIndex}
            >
              {t('assistant.help.index')}
            </button>
          )}
          <Dialog.Close asChild>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-pos transition-colors duration-75"
              style={{
                color:
                  'color-mix(in srgb, var(--color-ink) 40%, transparent)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  'color-mix(in srgb, var(--color-ink) 8%, transparent)';
                e.currentTarget.style.color = 'var(--color-ink)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color =
                  'color-mix(in srgb, var(--color-ink) 40%, transparent)';
              }}
              aria-label={t('common.close')}
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden
              >
                <path
                  d="M12 4L4 12M4 4l8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </Dialog.Close>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {selectedTopic ? (
          <TopicContent
            entry={selectedTopic}
            isProcedure={isProcedure}
            checkedSteps={checkedSteps}
            onToggleStep={onToggleStep}
          />
        ) : helpTopicId && !selectedTopic ? (
          <HelpNotFoundState onGoToIndex={onGoToIndex} />
        ) : (
          <HelpWelcomeIndex
            groupedEntries={groupedEntries}
            onSelectTopic={onSelectTopic}
          />
        )}
      </div>
    </main>
  );
};
