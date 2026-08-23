/**
 * Company-setup reactive store (module-scoped Zustand, same pattern as
 * `local-config.store` / `local-session.store`).
 *
 * Holds the wizard's draft state and the setup lifecycle status. The
 * server is the source of truth once a profile is submitted; this store
 * only mirrors it locally so the wizard can be re-entered without
 * re-parsing the RUT and so the cash-shift gate can react instantly.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CompanyDraft, CompanySetupStatus } from './company-types';

export interface CompanySetupState {
  status: CompanySetupStatus;
  /** Last complete draft (parsed from RUT or entered manually). */
  draft: CompanyDraft | null;
  /** Draft currently being reviewed after a RUT parse. */
  parsedFromRut: CompanyDraft | null;
  /** ISO timestamp of the last successful server submit. */
  lastSavedAt: string | null;

  setStatus(status: CompanySetupStatus): void;
  setDraft(draft: CompanyDraft | null): void;
  setParsedFromRut(draft: CompanyDraft | null): void;
  markComplete(draft: CompanyDraft): void;
  reset(): void;
}

const STORAGE_KEY = 'pharmacy_company_setup';

export const useCompanySetupStore: StoreApi<CompanySetupState> =
  createStore<CompanySetupState>()(
    persist(
      (set) => ({
        status: 'idle',
        draft: null,
        parsedFromRut: null,
        lastSavedAt: null,

        setStatus(status) {
          set({ status });
        },

        setDraft(draft) {
          set({ draft });
        },

        setParsedFromRut(draft) {
          set({ parsedFromRut: draft, draft });
        },

        markComplete(draft) {
          set({
            status: 'complete',
            draft,
            lastSavedAt: new Date().toISOString(),
          });
        },

        reset() {
          set({
            status: 'idle',
            draft: null,
            parsedFromRut: null,
            lastSavedAt: null,
          });
        },
      }),
      {
        name: STORAGE_KEY,
        storage: createJSONStorage(() => localStorage),
      },
    ),
  );