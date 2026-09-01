/**
 * Zustand store for inventory-count reactive state.
 *
 * Module-scoped store — holds the active session summary so any component
 * can show progress without polling the database. Hydrated from
 * InventoryCountService on demand.
 */
import { create } from 'zustand';

export interface InventoryCountSummary {
  id: string;
  code: string;
  state: string;
  scopeType: string;
  scopeLabel: string | null;
  mode: string;
  totalLines: number;
  countedLines: number;
  recountedLines: number;
  discrepancyCount: number;
  createdAt: string;
  updatedAt: string;
}

interface InventoryCountStoreState {
  activeSession: InventoryCountSummary | null;
  recentSessions: InventoryCountSummary[];
  isLoading: boolean;
  setActiveSession: (s: InventoryCountSummary | null) => void;
  setRecentSessions: (list: InventoryCountSummary[]) => void;
  setLoading: (v: boolean) => void;
  clear: () => void;
}

export const useInventoryCountStore = create<InventoryCountStoreState>((set) => ({
  activeSession: null,
  recentSessions: [],
  isLoading: false,
  setActiveSession: (activeSession) => set({ activeSession }),
  setRecentSessions: (recentSessions) => set({ recentSessions }),
  setLoading: (isLoading) => set({ isLoading }),
  clear: () => set({ activeSession: null, recentSessions: [], isLoading: false }),
}));
