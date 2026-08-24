import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon } from './icons';

interface FaqItem {
  q: string;
  a: string;
}

/** Single-open FAQ accordion; grid-rows transition keeps it interruptible. */
export function Faq() {
  const { t } = useTranslation();
  const baseId = useId();
  const [openQuestion, setOpenQuestion] = useState<number | null>(0);
  const items = t('faq.items', { returnObjects: true }) as FaqItem[];

  return (
    <section id="faq" aria-labelledby="faq-title" className="py-20 lg:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <p className="eyebrow text-verde-cruz">{t('faq.eyebrow')}</p>
        <h2 id="faq-title" className="display mt-4 text-3xl font-bold sm:text-4xl">
          {t('faq.title')}
        </h2>

        <dl className="mt-10 divide-y divide-tinta/10 border-y border-tinta/10">
          {items.map((item, index) => {
            const isOpen = openQuestion === index;
            const buttonId = `${baseId}-q${index}`;
            const panelId = `${baseId}-a${index}`;

            return (
              <div key={item.q}>
                <dt>
                  <button
                    type="button"
                    id={buttonId}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className="flex w-full items-center justify-between gap-4 py-5 text-left text-base font-semibold"
                    onClick={() => setOpenQuestion(isOpen ? null : index)}
                  >
                    {item.q}
                    <ChevronDownIcon
                      className={`shrink-0 text-lg text-tinta-media transition-transform duration-200 ease-out ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </dt>
                <dd>
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    className="accordion-panel"
                    data-open={isOpen}
                  >
                    <div>
                      <p className="pb-5 leading-relaxed text-tinta-media">{item.a}</p>
                    </div>
                  </div>
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
