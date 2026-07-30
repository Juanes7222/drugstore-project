/**
 * Reports UI store (Zustand).
 *
 * Holds the active report code, the in-flight filter values, the
 * favorites list, and the chart-derived filter applied via chart click.
 * Persistent state (favorites) is kept in `localStorage`; everything
 * else is session-scoped.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ReportCode, ReportDefinition, ReportResponse } from '../../domain/reports/report-types';
import type { ReportFilters } from '../../domain/reports/report-types';

const STORAGE_KEY = 'pharmacy_reports_ui';

interface ChartFilter {
  columnId: string;
  value: string | number;
}

interface ReportsUiState {
  activeReportCode: ReportCode | null;
  favorites: ReportCode[];
  appliedFilters: unknown;
  lastResponse: ReportResponse | null;
  isLoading: boolean;
  error: string | null;
  chartFilter: ChartFilter | null;
  setActiveReport: (code: ReportCode | null) => void;
  setAppliedFilters: (filters: unknown) => void;
  setLastResponse: (response: ReportResponse | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (message: string | null) => void;
  toggleFavorite: (code: ReportCode) => void;
  applyChartFilter: (filter: ChartFilter) => void;
  clearChartFilter: () => void;
  reset: () => void;
}

const initialState = {
  activeReportCode: null,
  favorites: [] as ReportCode[],
  appliedFilters: null,
  lastResponse: null,
  isLoading: false,
  error: null,
  chartFilter: null,
};

export const useReportsUiStore = create<ReportsUiState>()(
  persist(
    (set, get) => ({
      ...initialState,
      setActiveReport: (code) => set({ activeReportCode: code, error: null, lastResponse: null, appliedFilters: null, chartFilter: null }),
      setAppliedFilters: (filters) => set({ appliedFilters: filters, chartFilter: null }),
      setLastResponse: (response) => set({ lastResponse: response, isLoading: false, error: null }),
      setLoading: (loading) => set({ isLoading: loading, error: loading ? null : get().error }),
      setError: (message) => set({ error: message, isLoading: false }),
      toggleFavorite: (code) =>
        set({
          favorites: get().favorites.includes(code)
            ? get().favorites.filter((c) => c !== code)
            : [...get().favorites, code],
        }),
      applyChartFilter: (filter) => set({ chartFilter: filter }),
      clearChartFilter: () => set({ chartFilter: null }),
      reset: () => set({ ...initialState }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist favorites and the active report — everything else is
      // recomputed on every mount.
      partialize: (state) => ({
        favorites: state.favorites,
        activeReportCode: state.activeReportCode,
      }),
    },
  ),
);

export type { ChartFilter, ReportFilters, ReportDefinition };
