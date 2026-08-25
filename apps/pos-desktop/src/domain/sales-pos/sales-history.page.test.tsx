/**
 * Component tests for SalesHistoryPage — the thin wiring container.
 *
 * Focus: the auto-load effect keys on serialized filters (not loadSales
 * identity), so transient churn — a fresh `t` reference from i18next, a
 * re-provisioned service context — must not re-fetch the list; only actual
 * filter changes may. All collaborators are stubbed at their module
 * boundaries; the dev-only loadSales diagnostic logging is asserted too.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoleType } from '@pharmacy/shared-types';
import { SalesHistoryPage } from './sales-history.page';
import type { SaleHistoryFilters, SaleHistoryListResult } from './sales-history.service';
import type { LocalSession } from '../auth/local-session.store';

// ---------------------------------------------------------------------------
// Hoisted mutable state shared with the vi.mock factories below
// ---------------------------------------------------------------------------

const harness = vi.hoisted(() => {
  const listConfirmedSales =
    vi.fn<(filters?: SaleHistoryFilters) => Promise<SaleHistoryListResult>>();

  return {
    listConfirmedSales,
    salesHistoryService: { listConfirmedSales, getSaleHistoryDetail: vi.fn() },
    localAdjustmentService: {},
    invoiceService: {},
    session: { current: null as LocalSession | null },
    t: (key: string) => key,
  };
});

// ---------------------------------------------------------------------------
// Module-boundary mocks
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: harness.t }),
}));

vi.mock('../auth/local-session.store', () => ({
  useLocalSessionStore: (
    selector: (slice: { session: LocalSession | null }) => unknown,
  ) => selector({ session: harness.session.current }),
}));

vi.mock('../../renderer/components/common/service-context', () => ({
  useSalesHistoryService: () => harness.salesHistoryService,
  useLocalAdjustmentService: () => harness.localAdjustmentService,
  useInvoiceService: () => harness.invoiceService,
}));

interface FakeSalesHistoryListProps {
  onFiltersChange?: (filters: Partial<SaleHistoryFilters>) => void;
  [key: string]: unknown;
}

function FakeSalesHistoryList(props: FakeSalesHistoryListProps) {
  return (
    <button
      type="button"
      data-testid="fake-sales-history-list"
      onClick={() => props.onFiltersChange?.({ limit: 50, query: 'abc' })}
    >
      fake sales history list
    </button>
  );
}

vi.mock('../../renderer/components/sales-history/sales-history-list', () => ({
  SalesHistoryList: FakeSalesHistoryList,
}));

vi.mock('../../renderer/components/sales-history/sales-history-detail', () => ({
  SalesHistoryDetail: () => null,
}));

vi.mock('../../renderer/components/sales-history/sales-history-adjustment-modal', () => ({
  SalesHistoryAdjustmentModal: () => null,
}));

vi.mock('../../renderer/components/ui/resize-handle', () => ({
  ResizeHandle: () => null,
}));

vi.mock('../../renderer/hooks/use-resizable-width', () => ({
  useResizableWidth: () => ({ width: 400, isResizing: false, handleProps: {} }),
}));

vi.mock('../../renderer/hooks/use-data-export', () => ({
  useDataExport: () => ({ exportTo: vi.fn(), isExporting: false, error: null }),
}));

// Keeps the heavy export.service graph (Tauri pipeline) out of this suite;
// the page only threads the definition through the mocked useDataExport.
vi.mock('../export', () => ({
  SALES_HISTORY_EXPORT: { key: 'sales-history' },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createSession(role: RoleType): LocalSession {
  return {
    userId: 'user-1',
    username: 'manager',
    fullName: 'Manager User',
    displayName: 'Manager',
    email: null,
    role,
    subscriptionId: null,
    workstationId: 'ws-1',
    accessToken: '',
    refreshToken: '',
    sessionId: 'session-1',
    sessionTrust: 'LOCAL_UNVERIFIED',
  };
}

const EMPTY_RESULT: SaleHistoryListResult = { items: [], total: 0 };

// Mirrors the unexported PAGE_SIZE constant in sales-history.page.tsx.
const INITIAL_FILTERS: SaleHistoryFilters = { limit: 50 };

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SalesHistoryPage', () => {
  let consoleInfoSpy: MockInstance;

  beforeEach(() => {
    vi.stubEnv('DEV', true);
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    harness.listConfirmedSales.mockReset();
    harness.listConfirmedSales.mockResolvedValue(EMPTY_RESULT);
    harness.session.current = createSession(RoleType.MANAGER);
    harness.t = (key: string) => key;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    consoleInfoSpy.mockRestore();
  });

  describe('auto-load effect', () => {
    it('loads confirmed sales exactly once on mount', async () => {
      render(<SalesHistoryPage />);

      await screen.findByRole('button', { name: /fake sales history list/i });

      expect(harness.listConfirmedSales).toHaveBeenCalledTimes(1);
      expect(harness.listConfirmedSales).toHaveBeenCalledWith(INITIAL_FILTERS);
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[SalesHistoryPage\] loadSales #1$/),
        JSON.stringify(INITIAL_FILTERS),
      );
    });

    it('does not reload when only the translator identity changes', async () => {
      const { rerender } = render(<SalesHistoryPage />);
      await screen.findByRole('button', { name: /fake sales history list/i });

      harness.t = (key: string) => key;

      rerender(<SalesHistoryPage />);

      await waitFor(() => {
        expect(harness.listConfirmedSales).toHaveBeenCalledTimes(1);
      });
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    });

    it('reloads with updated filters when the list changes filters', async () => {
      const user = userEvent.setup();
      render(<SalesHistoryPage />);
      await screen.findByRole('button', { name: /fake sales history list/i });

      await user.click(screen.getByTestId('fake-sales-history-list'));

      await waitFor(() => {
        expect(harness.listConfirmedSales).toHaveBeenCalledTimes(2);
      });
      expect(harness.listConfirmedSales).toHaveBeenLastCalledWith({
        limit: 50,
        query: 'abc',
        offset: 0,
        cursor: undefined,
      });
      expect(consoleInfoSpy).toHaveBeenLastCalledWith(
        expect.stringMatching(/\[SalesHistoryPage\] loadSales #2$/),
        JSON.stringify({ limit: 50, query: 'abc', offset: 0 }),
      );
    });
  });
});
