import { useTranslation } from 'react-i18next';

interface Step {
  title: string;
  body: string;
}

/**
 * The three purchase steps. Numbered because the order is real information:
 * pay → receive code → activate.
 */
export function Steps() {
  const { t } = useTranslation();
  const items = t('steps.items', { returnObjects: true }) as Step[];

  return (
    <section aria-labelledby="steps-title" className="py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="steps-title" className="display text-3xl font-bold sm:text-4xl">
          {t('steps.title')}
        </h2>

        <ol className="mt-12 grid gap-8 sm:grid-cols-3">
          {items.map((step, index) => (
            <li key={step.title} className="border-t-2 border-verde-cruz pt-6">
              <span className="data text-sm font-semibold text-verde-cruz">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="display mt-3 text-lg font-bold">{step.title}</h3>
              <p className="mt-2 leading-relaxed text-tinta-media">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
