/**
 * TopicContent — rendered topic content with title, metadata, body,
 * and optional procedure checklist.
 */
import {
  type FC,
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { HelpContentEntry } from '../../../help-content';
import { renderMarkdown } from '../../../domain/assistant/markdown-renderer';
import {
  isOlderThanSixMonths,
  formatDate,
  countOrderedListItems,
} from '../../../domain/assistant/help-helpers';

interface TopicContentProps {
  entry: HelpContentEntry;
  isProcedure: boolean;
  checkedSteps: Set<number>;
  onToggleStep: (stepIndex: number) => void;
}

export const TopicContent: FC<TopicContentProps> = ({
  entry,
  isProcedure,
  checkedSteps,
  onToggleStep,
}) => {
  const { t } = useTranslation();
  const isOutdated = isOlderThanSixMonths(entry.lastUpdated);

  // Render body with optional checklist overlay for ordered lists in procedures
  const bodyContent = useMemo(() => {
    if (!isProcedure) return renderMarkdown(entry.body);

    // For procedures, add checkboxes before each <ol><li> element
    const blocks = renderMarkdown(entry.body);
    let stepCounter = 0;

    return blocks.map((block, idx) => {
      if (
        isValidElement(block) &&
        block.type === 'ol'
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listItems = Children.toArray((block.props as any).children).map(
          (child: ReactNode) => {
            const stepIndex = stepCounter++;
            if (isValidElement(child) && child.type === 'li') {
              const isChecked = checkedSteps.has(stepIndex);
              return (
                <li
                  key={`step-${stepIndex}`}
                  className="mb-1 flex items-start gap-2"
                  style={{
                    textDecoration: isChecked ? 'line-through' : 'none',
                    opacity: isChecked ? 0.6 : 1,
                    color: 'var(--color-ink)',
                  }}
                >
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggleStep(stepIndex)}
                      className="mt-1 h-3.5 w-3.5 shrink-0 rounded-pos"
                      style={{
                        accentColor: 'var(--color-pharma)',
                      }}
                      aria-label={`${t('assistant.help.step')} ${stepIndex + 1}`}
                    />
                    <span className="text-body leading-relaxed">
                      {(child.props as Record<string, unknown>).children as ReactNode}
                    </span>
                  </label>
                </li>
              );
            }
            return child;
          },
        );

        const clonedProps: Record<string, unknown> = {
          key: `ol-${idx}`,
          children: listItems,
        };
        return cloneElement(block, clonedProps);
      }
      return block;
    });
  }, [entry.body, isProcedure, checkedSteps, onToggleStep, t]);

  return (
    <article>
      {/* Title */}
      <h1
        className="mb-1 text-heading font-bold leading-tight"
        style={{ color: 'var(--color-ink)' }}
      >
        {entry.title}
      </h1>

      {/* Last updated */}
      {entry.lastUpdated && (
        <p
          className="mb-2 text-caption"
          style={{
            color:
              'color-mix(in srgb, var(--color-ink) 50%, transparent)',
          }}
        >
          {t('assistant.help.lastUpdated', {
            date: formatDate(entry.lastUpdated),
          })}
        </p>
      )}

      {/* Outdated warning */}
      {isOutdated && (
        <div
          className="mb-4 flex items-start gap-2 rounded-pos border-l-4 px-3 py-2 text-caption font-medium"
          style={{
            borderLeftColor: 'var(--color-urgency)',
            backgroundColor: 'var(--color-urgency-surface)',
            color: 'var(--color-urgency)',
          }}
          role="alert"
        >
          <svg
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <path
              d="M8 5v3.333M8 11.333h.007M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>
            {t('assistant.help.outdated', {
              date: formatDate(entry.lastUpdated),
            })}
          </span>
        </div>
      )}

      {/* Procedure checklist header */}
      {isProcedure && (
        <div
          className="mb-3 flex items-center gap-2 rounded-pos px-3 py-2 text-caption font-medium"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--color-pharma) 8%, transparent)',
            color: 'var(--color-pharma)',
          }}
        >
          <svg
            className="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <path
              d="M13.333 4L5.333 12 2.667 9.333"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>
            {checkedSteps.size}/{countOrderedListItems(entry.body)}{' '}
            {t('assistant.help.stepsCompleted')}
          </span>
        </div>
      )}

      {/* Body (rendered Markdown) */}
      <div className="space-y-1">{bodyContent}</div>
    </article>
  );
};
