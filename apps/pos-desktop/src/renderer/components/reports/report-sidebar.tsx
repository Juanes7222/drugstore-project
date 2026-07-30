/**
 * Reports sidebar.
 *
 * - Categorized list of reports, filtered by the current role.
 * - Search input (case-insensitive substring match on title/description).
 * - Favorites section, persisted via the reports UI store.
 * - Active report highlight.
 */

import { type FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReportsUiStore } from "../../stores/reports.store";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { listReportsByCategory, getReportDefinition } from "../../../domain/reports/report-catalog";
import type { ReportCategory, ReportDefinition } from "../../../domain/reports/report-types";
import { Star } from "lucide-react";

const CATEGORY_KEY: Record<ReportCategory, string> = {
  sales: "reports.categories.sales",
  inventory: "reports.categories.inventory",
  fiscal: "reports.categories.fiscal",
  cash_shift: "reports.categories.cash_shift",
  audit: "reports.categories.audit",
  profitability: "reports.categories.profitability",
};

export const ReportSidebar: FC = () => {
  const { t } = useTranslation();
  const role = useLocalSessionStore((s) => s.session?.role ?? null);
  const activeCode = useReportsUiStore((s) => s.activeReportCode);
  const setActive = useReportsUiStore((s) => s.setActiveReport);
  const favorites = useReportsUiStore((s) => s.favorites);
  const toggleFavorite = useReportsUiStore((s) => s.toggleFavorite);
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const map = listReportsByCategory(role);
    if (!search.trim()) return map;
    const needle = search.toLowerCase();
    const filtered = new Map<ReportCategory, readonly ReportDefinition[]>();
    for (const [cat, defs] of map.entries()) {
      const matched = defs.filter((d) => {
        const title = t(d.titleKey).toLowerCase();
        const desc = t(d.descriptionKey).toLowerCase();
        return title.includes(needle) || desc.includes(needle);
      });
      if (matched.length) filtered.set(cat, matched);
    }
    return filtered;
  }, [role, search, t]);

  const favoriteReports = favorites
    .map((code) => getReportDefinition(code))
    .filter((d) => d.allowedRoles.includes(role as never));

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 border-r border-border bg-surface px-4 py-4">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("reports.sidebar.search_placeholder")}
        className="w-full rounded-md border border-border bg-white px-3 py-2 text-body-sm focus:border-pharma focus:outline-none"
        aria-label={t("reports.sidebar.search_placeholder")}
      />
      {favoriteReports.length ? (
        <Section title={t("reports.sidebar.favorites")}>
          {favoriteReports.map((def) => (
            <ReportItem
              key={def.code}
              def={def}
              active={def.code === activeCode}
              favorite
              onSelect={() => setActive(def.code)}
              onToggleFavorite={() => toggleFavorite(def.code)}
            />
          ))}
        </Section>
      ) : null}
      {[...grouped.entries()].map(([cat, defs]) => (
        <Section key={cat} title={t(CATEGORY_KEY[cat])}>
          {defs.map((def) => (
            <ReportItem
              key={def.code}
              def={def}
              active={def.code === activeCode}
              favorite={favorites.includes(def.code)}
              onSelect={() => setActive(def.code)}
              onToggleFavorite={() => toggleFavorite(def.code)}
            />
          ))}
        </Section>
      ))}
    </aside>
  );
};

interface SectionProps {
  title: string;
  children: React.ReactNode;
}
const Section: FC<SectionProps> = ({ title, children }) => (
  <section className="flex flex-col gap-1">
    <h2 className="text-caption font-semibold uppercase tracking-wide text-muted">
      {title}
    </h2>
    <ul className="flex flex-col gap-1">{children}</ul>
  </section>
);

interface ReportItemProps {
  def: ReportDefinition;
  active: boolean;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}
const ReportItem: FC<ReportItemProps> = ({ def, active, favorite, onSelect, onToggleFavorite }) => {
  const { t } = useTranslation();
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-body-sm transition ${
          active
            ? "bg-pharma text-white"
            : "bg-white text-ink hover:bg-amber-50"
        }`}
      >
        <span className="flex flex-col">
          <span className="font-medium">{t(def.titleKey)}</span>
        </span>
        <span
          role="button"
          aria-label={favorite ? t("reports.sidebar.remove_favorite") : t("reports.sidebar.add_favorite")}
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onToggleFavorite();
            }
          }}
          className={`flex h-6 w-6 items-center justify-center rounded-full ${
            favorite ? "text-amber-500" : "text-muted hover:text-amber-500"
          }`}
        >
          <Star className="h-4 w-4" fill={favorite ? "currentColor" : "none"} />
        </span>
      </button>
    </li>
  );
};
