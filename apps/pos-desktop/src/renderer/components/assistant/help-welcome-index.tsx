/**
 * HelpWelcomeIndex — default welcome/index view when no topic is selected.
 */
import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getHelpEntry } from '../../../help-content';
import type { EntryGroup } from '../../../domain/assistant/help-helpers';
import { sectionLabelKey } from '../../../domain/assistant/help-helpers';
import { TopicContent } from './help-topic-content';

interface HelpWelcomeIndexProps {
  groupedEntries: EntryGroup[];
  onSelectTopic: (id: string) => void;
}

export const HelpWelcomeIndex: FC<HelpWelcomeIndexProps> = ({
  groupedEntries,
  onSelectTopic,
}) => {
  const { t } = useTranslation();

  // Try to show the help-index.md content as a welcome
  const indexEntry = useMemo(() => getHelpEntry('help-index'), []);

  if (indexEntry) {
    return (
      <TopicContent
        entry={indexEntry}
        isProcedure={false}
        checkedSteps={new Set()}
        onToggleStep={() => {}}
      />
    );
  }

  // Fallback: show grouped topics inline
  return (
    <div>
      <h1
        className="mb-4 text-heading font-bold"
        style={{ color: 'var(--color-ink)' }}
      >
        {t('assistant.help.title')}
      </h1>
      <p
        className="mb-6 text-body"
        style={{
          color: 'color-mix(in srgb, var(--color-ink) 60%, transparent)',
        }}
      >
        {t('assistant.help.selectTopic')}
      </p>
      {groupedEntries.map((group) => (
        <div key={group.section} className="mb-6">
          <h3
            className="mb-2 text-ui font-semibold"
            style={{ color: 'var(--color-ink)' }}
          >
            {t(sectionLabelKey(group.section))}
          </h3>
          <ul className="space-y-1">
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="text-body underline-offset-2 transition-colors duration-75 hover:underline"
                  style={{ color: 'var(--color-pharma)' }}
                  onClick={() => onSelectTopic(entry.id)}
                >
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};
