import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import { CheckIcon } from './icons';
import { usePrintReveal } from '../hooks/use-print-reveal';

interface QueueItem {
  sent: boolean;
}

// Third row stays pending on purpose: the point of the panel is that the
// queue state is legible at a glance, not that everything is green.
const QUEUE_ITEMS: QueueItem[] = [{ sent: true }, { sent: true }, { sent: false }];

/**
 * Offline operating mode as a calm, dark panel — the domain treats offline
 * sales as normal work, so nothing here reads as an error.
 */
export function OfflinePanel() {
  const { t } = useTranslation();
  const queueLines = t('offline.queue_items', { returnObjects: true }) as string[];
  const queueRevealRef = usePrintReveal<HTMLDivElement>();

  return (
    <section aria-labelledby="offline-title" className="bg-papel py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-12 rounded-2xl bg-tinta px-6 py-12 text-papel sm:px-10 lg:grid-cols-[1.1fr_0.9fr] lg:px-14 lg:py-16">
          <div>
            <p className="eyebrow text-menta">{t('offline.eyebrow')}</p>
            <h2 id="offline-title" className="display mt-4 text-3xl font-bold sm:text-4xl">
              {t('offline.title')}
            </h2>
            <p className="mt-5 max-w-lg leading-relaxed text-papel/75">
              {t('offline.body')}
            </p>
            <p className="mt-6 border-l-2 border-verde-cruz pl-4 text-sm text-papel/60">
              {t('offline.note')}
            </p>
          </div>

          <div
            ref={queueRevealRef}
            data-printed="false"
            role="img"
            aria-label={t('offline.queue_label')}
            className="rounded-xl border border-papel/15 bg-papel/5 p-5"
          >
            <p className="eyebrow text-papel/50" aria-hidden="true">
              {t('offline.queue_label')}
            </p>
            <ul aria-hidden="true" className="data mt-4 space-y-3 text-sm">
              {queueLines.map((line, index) => {
                const sent = QUEUE_ITEMS[index]?.sent ?? false;
                return (
                  <li
                    key={line}
                    className="queue-line flex items-center justify-between gap-3"
                    style={{ '--queue-index': index } as CSSProperties}
                  >
                    <span className="data min-w-0 shrink truncate text-papel/85">{line}</span>
                    {sent ? (
                      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-verde-cruz/25 px-2 py-0.5 text-[11px] font-medium text-menta">
                        <CheckIcon className="text-xs" />
                        {t('offline.status_sent')}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-menta/15 px-2 py-0.5 text-[11px] font-medium text-menta">
                        ● {t('offline.status_queued')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
