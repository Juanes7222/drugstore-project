import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRightIcon } from "./icons";

export type LegalDocument = "terms" | "privacy" | "data";

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
  terms: "legal.terms",
  privacy: "legal.privacy",
  data: "legal.data",
};

/**
 * Shared layout for the three legal routes. Rendered inside the site frame, so
 * these pages keep the header, the footer and the skip link like every other
 * page on the site.
 */
export function LegalPage({ document: doc }: { document: LegalDocument }) {
  const { t } = useTranslation();
  const content = t(CONTENT_KEY[doc], { returnObjects: true }) as LegalContent;

  return (
    <main
      id="contenido"
      className="mx-auto max-w-3xl px-5 py-16 sm:px-8 lg:py-20"
    >
      <Link
        to="/"
        className="data inline-flex items-center gap-2 text-sm text-verde"
      >
        <ArrowRightIcon className="rotate-180 text-base" />
        {t("legal.back_home")}
      </Link>

      <h1 className="display mt-8 text-[clamp(1.8rem,3.4vw,2.5rem)]">
        {content.title}
      </h1>
      <p className="data mt-3 text-sm text-grafito">{content.updated}</p>

      <div className="mt-12 space-y-10">
        {content.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="display text-xl">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p
                key={paragraph.slice(0, 48)}
                className="mt-4 leading-relaxed text-grafito"
              >
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
