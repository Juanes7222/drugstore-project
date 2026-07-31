/**
 * Saved report views (a.k.a. "personal shortcuts").
 *
 * Persists a set of named filter bundles per report so a user can
 * re-apply their favourite configurations in one click.  Persistence
 * uses the same `localStorage` store as the rest of the reports UI.
 */

import { useReportsUiStore } from "../../stores/reports.store";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { BookmarkIcon, Trash2Icon } from "@/components/ui/icons";
import type { ReportCode } from "../../../domain/reports/report-types";

interface SavedView {
  id: string;
  reportCode: ReportCode;
  name: string;
  filters: unknown;
  createdAt: string;
}

const STORAGE_KEY = 'pharmacy_reports_saved_views';

const readViews = (): SavedView[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedView[];
  } catch {
    return [];
  }
};

const writeViews = (views: SavedView[]): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    // localStorage may be unavailable in private mode.
  }
};

interface SavedReportViewsProps {
  reportCode: ReportCode;
  filters: unknown;
  onApply: (filters: unknown) => void;
}

export const SavedReportViews: React.FC<SavedReportViewsProps> = ({ reportCode, filters, onApply }) => {
  const { t } = useTranslation();
  const [views, setViews] = useState<SavedView[]>(() => readViews().filter((v) => v.reportCode === reportCode));
  const [name, setName] = useState('');

  const refresh = (): void => setViews(readViews().filter((v) => v.reportCode === reportCode));

  const handleSave = (): void => {
    if (!name.trim()) return;
    const view: SavedView = {
      id: globalThis.crypto.randomUUID(),
      reportCode,
      name: name.trim(),
      filters,
      createdAt: new Date().toISOString(),
    };
    const next = [...readViews(), view];
    writeViews(next);
    setName('');
    refresh();
  };

  const handleRemove = (id: string): void => {
    const next = readViews().filter((v) => v.id !== id);
    writeViews(next);
    refresh();
  };

  // Re-read when the active report changes.
  useReportsUiStore((s) => s.activeReportCode); // re-render trigger
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-white px-3 py-2">
      <BookmarkIcon className="h-4 w-4 text-muted" />
      <span className="text-caption text-muted">{t("reports.saved_views.label")}:</span>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("reports.saved_views.name_placeholder")}
        className="w-40 rounded-md border border-border bg-white px-2 py-1 text-body-sm"
      />
      <button
        type="button"
        onClick={handleSave}
        className="rounded-md bg-pharma px-2 py-1 text-caption text-white"
      >
        {t("reports.saved_views.save")}
      </button>
      {views.map((v) => (
        <span key={v.id} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-caption">
          <button type="button" onClick={() => onApply(v.filters)} className="hover:underline">
            {v.name}
          </button>
          <button
            type="button"
            aria-label={t("reports.saved_views.remove")}
            onClick={() => handleRemove(v.id)}
            className="text-muted hover:text-rose-600"
          >
            <Trash2Icon className="h-3 w-3" />
          </button>
        </span>
      ))}
      <span className="text-caption text-muted" aria-hidden style={{ display: 'none' }}>{t('reports.viewer.empty')}</span>
    </div>
  );
};
