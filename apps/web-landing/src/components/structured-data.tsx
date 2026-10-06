import { useTranslation } from "react-i18next";
import type { PlanView } from "../data/plans";
import {
  buildStructuredData,
  serializeStructuredData,
} from "../lib/structured-data";

interface StructuredDataProps {
  plans: PlanView[];
}

/**
 * Renders the product and FAQ as schema.org JSON-LD. Both plans are published
 * and priced; the block reads the live catalog, so it updates with the same
 * refresh that updates the visible prices.
 */
export function StructuredData({ plans }: StructuredDataProps) {
  const { t } = useTranslation();

  const data = buildStructuredData({
    brandName: t("brand.name"),
    tagline: t("brand.tagline"),
    description: t("hero.subtitle"),
    plans,
    faq: t("faq.items", { returnObjects: true }) as { q: string; a: string }[],
  });

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeStructuredData(data) }}
    />
  );
}
