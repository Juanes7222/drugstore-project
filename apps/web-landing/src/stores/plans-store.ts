import { create } from 'zustand';
import { SEED_PLANS, type PlanView } from '../data/plans';
import { fetchPublicPlans } from '../lib/public-plans-api';

type PlansSource = 'seed' | 'server';

interface PlansState {
  /** Catalog in effect. Starts as the seed so first paint never waits. */
  plans: PlanView[];
  source: PlansSource;
  /** Epoch ms of the last successful server check; null while on seed. */
  checkedAt: number | null;
  /**
   * Fetches `GET /public/plans` once and swaps the catalog in place when the
   * response validates. Every failure is silent by design: a marketing page
   * keeps showing reference prices rather than an error state.
   */
  loadFromServer: () => Promise<void>;
}

export const usePlansStore = create<PlansState>((set) => ({
  plans: SEED_PLANS,
  source: 'seed',
  checkedAt: null,
  loadFromServer: async () => {
    const apiBaseUrl = import.meta.env.VITE_API_URL as string | undefined;
    if (!apiBaseUrl) return;

    try {
      const plans = await fetchPublicPlans(apiBaseUrl);
      // An empty catalog would blank the pricing section — keep the seed.
      if (plans.length > 0) {
        set({ plans, source: 'server', checkedAt: Date.now() });
      }
    } catch {
      // Seed stays; the UI's status line explains it is reference data.
    }
  },
}));
