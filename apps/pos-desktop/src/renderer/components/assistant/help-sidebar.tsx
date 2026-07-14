/**
 * HelpSidebar — search input and topic navigation for the help viewer.
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { EntryGroup } from '../../../domain/assistant/help-helpers';
import { sectionLabelKey } from '../../../domain/assistant/help-helpers';

interface HelpSidebarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  groupedEntries: EntryGroup[];
  selectedTopicId: string | null;
  helpTopicId: string | null;
  onSelectTopic: (id: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  entryHasRecentView: (key: string) => boolean;
}

export const HelpSidebar: FC<HelpSidebarProps> = ({
  searchQuery,
  onSearchChange,
  onSearchKeyDown,
  groupedEntries,
  selectedTopicId,
  helpTopicId,
  onSelectTopic,
  searchInputRef,
  entryHasRecentView,
}) => {
  const { t } = useTranslation();

  return (
    <aside
      className="flex w-60 shrink-0 flex-col overflow-hidden"
      style={{
        borderRight:
          '1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)',
        backgroundColor:
          'color-mix(in srgb, var(--color-surface) 40%, white)',
      }}
    >
      {/* Search input */}
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{
          borderBottom:
            '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
        }}
      >
        <svg
          className="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          style={{
            color:
              'color-mix(in srgb, var(--color-ink) 40%, transparent)',
          }}
        >
          <path
            d="M7.333 12.667A5.333 5.333 0 1 0 7.333 2a5.333 5.333 0 0 0 0 10.667ZM14 14l-2.9-2.9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={t('assistant.help.search')}
          aria-label={t('assistant.help.search')}
          className="flex-1 border-none bg-transparent text-body outline-none"
          style={{
            color: 'var(--color-ink)',
            fontFamily: 'var(--font-ui)',
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/* Topic list */}
      <nav
        className="flex-1 overflow-y-auto"
        aria-label={t('assistant.help.index')}
      >
        {groupedEntries.length === 0 && searchQuery.trim() !== '' && (
          <div className="flex flex-col items-center px-3 py-8 text-center">
            <p
              className="text-body-sm"
              style={{
                color:
                  'color-mix(in srgb, var(--color-ink) 50%, transparent)',
              }}
            >
              {t('assistant.help.emptySearch', { query: searchQuery })}
            </p>
          </div>
        )}

        {groupedEntries.map((group) => (
          <div key={group.section}>
            {/* Section header */}
            <div
              className="flex items-center px-3 py-1.5"
              style={{
                backgroundColor:
                  'color-mix(in srgb, var(--color-surface) 60%, white)',
              }}
            >
              <span
                className="text-caption font-semibold uppercase tracking-wider"
                style={{
                  color:
                    'color-mix(in srgb, var(--color-ink) 50%, transparent)',
                }}
              >
                {t(sectionLabelKey(group.section))}
              </span>
              <span
                className="ml-auto flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 font-data text-[10px] tabular-nums"
                style={{
                  backgroundColor:
                    'color-mix(in srgb, var(--color-ink) 10%, transparent)',
                  color:
                    'color-mix(in srgb, var(--color-ink) 50%, transparent)',
                }}
              >
                {group.entries.length}
              </span>
            </div>

            {/* Entry items */}
            {group.entries.map((entry) => {
              const isActive =
                selectedTopicId === entry.id ||
                helpTopicId === entry.id;
              const viewedRecently = entryHasRecentView(
                entry.route ?? entry.id,
              );

              return (
                <button
                  key={entry.id}
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors duration-75"
                  style={{
                    backgroundColor: isActive
                      ? 'color-mix(in srgb, var(--color-pharma) 8%, transparent)'
                      : 'transparent',
                    color: isActive
                      ? 'var(--color-pharma)'
                      : 'var(--color-ink)',
                  }}
                  onClick={() => onSelectTopic(entry.id)}
                >
                  {/* Recently-viewed indicator */}
                  {viewedRecently && (
                    <span
                      className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: 'var(--color-pharma)',
                        opacity: 0.5,
                      }}
                      aria-hidden
                    />
                  )}
                  {!viewedRecently && (
                    <span className="block w-1.5 shrink-0" aria-hidden />
                  )}

                  <span className="min-w-0 flex-1 truncate text-body-sm leading-snug">
                    {entry.title}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
};
