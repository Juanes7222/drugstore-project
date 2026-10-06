import { useTranslation } from "react-i18next";
import { Reveal } from "./reveal";
import { Tear } from "./tear";

interface FaqItem {
  q: string;
  a: string;
}

interface ColumnProps {
  items: FaqItem[];
}

function FaqColumn({ items }: ColumnProps) {
  return (
    <dl className="border-t border-line-quiet">
      {items.map((item) => (
        <div key={item.q} className="border-b border-line-quiet py-6">
          <dt className="display text-lg">{item.q}</dt>
          <dd className="mt-2.5 leading-relaxed text-grafito">{item.a}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The objections, all of them, in two columns. No accordion: a shop owner
 * deciding whether to trust a POS should be able to read every answer without
 * clicking, and eight hidden answers read as eight things being hidden.
 */
export function Faq() {
  const { t } = useTranslation();
  const items = t("faq.items", { returnObjects: true }) as FaqItem[];
  const midpoint = Math.ceil(items.length / 2);

  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="scroll-mt-20 bg-papel"
    >
      <Tear bite="var(--color-papel-alto)" />

      <div className="mx-auto max-w-[78rem] px-5 pt-12 pb-20 sm:px-8 lg:pt-16 lg:pb-28">
        <p className="folio text-verde">{t("faq.eyebrow")}</p>
        <Reveal>
          <h2
            id="faq-title"
            className="display mt-5 max-w-2xl text-[clamp(1.8rem,3.4vw,2.5rem)]"
          >
            {t("faq.title")}
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-x-16 gap-y-0 lg:grid-cols-2">
          <FaqColumn items={items.slice(0, midpoint)} />
          <FaqColumn items={items.slice(midpoint)} />
        </div>
      </div>
    </section>
  );
}
