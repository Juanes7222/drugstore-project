import type { PlanView } from "../data/plans";

interface FaqEntry {
  q: string;
  a: string;
}

interface StructuredDataInput {
  brandName: string;
  tagline: string;
  description: string;
  plans: PlanView[];
  faq: FaqEntry[];
}

/**
 * Machine-readable description of the product and its price, built from the same
 * catalog and the same FAQ the page renders.
 *
 * Deriving it here rather than hand-writing it into index.html is deliberate: a
 * static block would be a second copy of the pricing, free to drift out of sync
 * with what a visitor is actually asked to pay — which is the one thing a
 * structured-data block must never do. It carries no aggregate rating or review
 * count, because there are none to report.
 */
export function buildStructuredData({
  brandName,
  tagline,
  description,
  plans,
  faq,
}: StructuredDataInput) {
  const prices = plans.map((plan) => plan.basePriceCents / 100);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: brandName,
        description: `${tagline} ${description}`.trim(),
        applicationCategory: "BusinessApplication",
        operatingSystem: "Windows, macOS, Linux",
        inLanguage: "es-CO",
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "COP",
          lowPrice: Math.min(...prices).toFixed(0),
          highPrice: Math.max(...prices).toFixed(0),
          offerCount: plans.length,
          offers: plans.map((plan) => ({
            "@type": "Offer",
            name: plan.name,
            price: (plan.basePriceCents / 100).toFixed(0),
            priceCurrency: "COP",
            ...(plan.description ? { description: plan.description } : {}),
          })),
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: faq.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
}

/**
 * JSON-LD has to be a raw script element, so the payload is escaped before it
 * reaches the DOM: an unescaped `</script>` anywhere in a translated string
 * would end the block early and dump the rest of the markup as text.
 */
export function serializeStructuredData(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
