import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRightIcon } from './icons';

export type LegalDocument = 'terms' | 'privacy' | 'data';

interface LegalSection {
  heading: string;
  paragraphs: string[];
}

interface LegalContent {
  title: string;
  updated: string;
  sections: LegalSection[];
}

const CONTENT_KEY: Record<LegalDocument, string> = {
  terms: 'legal.terms',
  privacy: 'legal.privacy',
  data: 'legal.data',
};

/** Shared layout for the three legal routes. */
export function LegalPage({ document: doc }: { document: LegalDocument }) {
  const { t } = useTranslation();
  const content = t(CONTENT_KEY[doc], { returnObjects: true }) as LegalContent;

  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-20">
      <Link
        to="/"
        className="data inline-flex items-center gap-2 text-sm text-verde-cruz underline-offset-4 hover:underline"
      >
        <ArrowRightIcon className="rotate-180 text-base" />
        {t('legal.back_home')}
      </Link>

      <h1 className="display mt-8 text-3xl font-bold sm:text-4xl">{content.title}</h1>
      <p className="data mt-3 text-sm text-tinta-media">{content.updated}</p>

      <div className="mt-12 space-y-10">
        {content.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="display text-xl font-bold">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 48)} className="mt-4 leading-relaxed text-tinta-media">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
