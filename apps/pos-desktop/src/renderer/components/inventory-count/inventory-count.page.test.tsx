/**
 * Component tests for InventoryCountPage — reconteo completo.
 *
 * Covers: list loading, empty state, session cards, create dialog open,
 * scope validation, detail navigation and sheet render. Service is mocked
 * via ServiceContext.
 *
 * NOTE: assertions use the current es.json copy (e.g. "Nuevo reconteo",
 * "Volver") — keep them in sync with the locale files.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { uiSlice } from '@/store/slices/ui-slice';
import { InventoryCountPage } from './inventory-count.page';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const fns = {
    listSessions: vi.fn(),
    getSession: vi.fn(),
    listLines: vi.fn(),
    createSession: vi.fn(),
    startSession: vi.fn(),
    recordCount: vi.fn(),
    notifySuccess: vi.fn(),
    syncNow: vi.fn().mockResolvedValue(undefined),
  };
  const service = {
    ...fns,
    setFinalQty: vi.fn(),
    evaluateRecounts: vi.fn(),
    moveToReview: vi.fn(),
    closeSession: vi.fn(),
    cancelSession: vi.fn(),
    getProgress: vi.fn(),
  };
  return { ...fns, service };
});

const mockListSessions = mocks.listSessions;
const mockGetSession = mocks.getSession;
const mockListLines = mocks.listLines;
const mockCreateSession = mocks.createSession;
const mockStartSession = mocks.startSession;

vi.mock('../common/service-context', () => ({
  useInventoryCountService: () => mocks.service,
  // The page also pulls syncScheduler via useServiceContext for syncNow()
  useServiceContext: () => ({ syncScheduler: { syncNow: mocks.syncNow } }),
}));

vi.mock('@/utils/notify', () => ({
  notify: {
    success: mocks.notifySuccess,
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../infrastructure/local-database', () => ({
  localDatabase: {
    syncNow: mocks.syncNow,
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderPage() {
  const store = configureStore({
    reducer: { ui: uiSlice.reducer },
  });
  return render(
    <Provider store={store}>
      <InventoryCountPage />
    </Provider>,
  );
}

const createDeferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const baseSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'sess-1',
  code: 'IC-0001',
  state: 'IN_PROGRESS',
  scopeType: 'FULL',
  scopeValue: null,
  scopeLabel: null,
  mode: 'BLIND',
  totalLines: 2,
  countedLines: 0,
  discrepancyCount: 0,
  createdAt: '2024-01-01T10:00:00Z',
  startedAt: null,
  closedAt: null,
  cancelledAt: null,
  adjustmentDocumentId: null,
  ...overrides,
});

const baseLine = (overrides: Record<string, unknown> = {}) => ({
  id: 'line-1',
  sessionId: 'sess-1',
  productId: 'prod-1',
  lotId: 'lot-1',
  productName: 'Acetaminofén 500mg',
  internalCode: 'ACET-500',
  lotCode: 'B001',
  locationCode: 'A-1',
  barcode: '7701234567890',
  theoreticalQty: 100,
  unitCost: '1000',
  countedQty1: null,
  countedQty2: null,
  finalQty: null,
  difference: null,
  valueImpact: null,
  status: 'PENDING',
  requiresRecount: false,
  isHighValue: false,
  notes: null,
  ...overrides,
});

// ── Suite ───────────────────────────────────────────────────────────────────

describe('InventoryCountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSessions.mockResolvedValue([baseSession()]);
    mockGetSession.mockResolvedValue(baseSession({ state: 'IN_PROGRESS' }));
    mockListLines.mockResolvedValue({ items: [baseLine()], total: 1 });
    mockCreateSession.mockResolvedValue(baseSession({ id: 'sess-new', code: 'IC-0002' }));
    mockStartSession.mockResolvedValue(baseSession({ state: 'IN_PROGRESS', totalLines: 2 }));
  });

  describe('loading & mount', () => {
    it('calls listSessions on mount', async () => {
      renderPage();

      await waitFor(() => {
        expect(mockListSessions).toHaveBeenCalledWith(30);
      });
    });

    it('shows loading skeleton while sessions are pending', async () => {
      const deferred = createDeferred<any[]>();
      mockListSessions.mockReturnValue(deferred.promise);

      renderPage();

      // Skeleton cards are animating pulse elements; check that page heading still exists but no session yet
      expect(screen.getByText(/Reconteo de inventario/i)).toBeInTheDocument();
      // No session code yet
      expect(screen.queryByText('IC-0001')).not.toBeInTheDocument();

      deferred.resolve([baseSession()]);
      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });
    });

    it('hides loading after resolve', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });
    });
  });

  describe('inventory display', () => {
    it('renders session card with code and status', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });
      expect(screen.getByLabelText(/Abrir IC-0001/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Estado:/i)).toBeInTheDocument();
    });

    it('shows empty placeholder when no sessions', async () => {
      mockListSessions.mockResolvedValue([]);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Aún no hay reconteos/i)).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /Crear reconteo completo/i })).toBeInTheDocument();
    });

    it('shows error alert when listSessions fails', async () => {
      mockListSessions.mockRejectedValue(new Error('network failure'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('network failure')).toBeInTheDocument();
      });
    });
  });

  describe('create dialog', () => {
    // The list header button label is inventory_count.list.new_recount.
    const openDialog = async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /Nuevo reconteo/i }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    };

    it('opens dialog when clicking Nuevo reconteo', async () => {
      await openDialog();
      expect(screen.getByRole('heading', { name: 'Nuevo reconteo' })).toBeInTheDocument();
    });

    it('shows category selector when scope is CATEGORY', async () => {
      await openDialog();

      // Change scope to CATEGORY (dialog.scope copy is "Alcance")
      const scopeSelect = screen.getByLabelText('Alcance');
      await userEvent.selectOptions(scopeSelect, 'CATEGORY');

      expect(screen.getByLabelText('Categoría')).toBeInTheDocument();
    });

    it('shows validation error when creating CATEGORY without value', async () => {
      await openDialog();

      const scopeSelect = screen.getByLabelText('Alcance');
      await userEvent.selectOptions(scopeSelect, 'CATEGORY');

      // Go to step 2 without selecting category value
      await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear borrador' })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        // Dialog validation surfaces the generic create error
        expect(screen.getByText('Error al crear reconteo')).toBeInTheDocument();
      });
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it('shows validation error for LABORATORY without value', async () => {
      await openDialog();

      await userEvent.selectOptions(screen.getByLabelText('Alcance'), 'LABORATORY');

      await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear borrador' })).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

      await waitFor(() => {
        expect(screen.getByText('Error al crear reconteo')).toBeInTheDocument();
      });
    });

    it('closes dialog on successful create and shows new session in list', async () => {
      await openDialog();

      await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear borrador' })).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

      await waitFor(() => {
        expect(mockCreateSession).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });
  });

  describe('detail navigation', () => {
    it('opens detail sheet when clicking a session card', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText(/Abrir IC-0001/i));

      await waitFor(() => {
        expect(mockGetSession).toHaveBeenCalledWith('sess-1');
      });
      await waitFor(() => {
        expect(mockListLines).toHaveBeenCalled();
      });
    });

    it('renders CountSheet with search and filters after opening detail for IN_PROGRESS session', async () => {
      // Make session IN_PROGRESS so sheet renders (DRAFT shows placeholder)
      mockGetSession.mockResolvedValue(baseSession({ state: 'IN_PROGRESS', totalLines: 1 }));
      mockListLines.mockResolvedValue({ items: [baseLine()], total: 1 });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText(/Abrir IC-0001/i));

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Buscar producto/i)).toBeInTheDocument();
      });
      // sheet.filter_all copy is "Todos" (the tablist label)
      expect(screen.getByRole('tablist', { name: 'Todos' })).toBeInTheDocument();
      expect(screen.getAllByText('Acetaminofén 500mg').length).toBeGreaterThan(0);
    });

    it('shows DRAFT placeholder when detail is DRAFT with Volver button', async () => {
      mockGetSession.mockResolvedValue(baseSession({ state: 'DRAFT' }));
      mockListLines.mockResolvedValue({ items: [], total: 0 });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText(/Abrir IC-0001/i));

      // DraftPlaceholder contains Borrador bold + frozen snapshot hint
      await waitFor(() => {
        expect(screen.getAllByText(/Borrador/i).length).toBeGreaterThan(0);
      });
      expect(screen.getAllByText(/offline/i).length).toBeGreaterThan(0);
      // detail.back_to_list copy is "Volver"
      expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
    });

    it('renders page heading with accessible aria-label', async () => {
      renderPage();

      expect(screen.getByRole('region', { name: /Reconteo de inventario/i })).toBeInTheDocument();

      // After opening detail, region label changes to "Reconteo de inventario IC-0001"
      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText(/Abrir IC-0001/i));

      await waitFor(() => {
        expect(
          screen.getByRole('region', { name: 'Reconteo de inventario IC-0001' }),
        ).toBeInTheDocument();
      });
    });
  });

  describe('accessibility', () => {
    it('dialog has aria-modal and labelled title', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /Nuevo reconteo/i }));

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByRole('heading', { name: 'Nuevo reconteo' })).toHaveAttribute('id', 'create-count-title');
    });

    it('progressbar has correct aria-valuenow in detail header', async () => {
      mockGetSession.mockResolvedValue(
        baseSession({ state: 'IN_PROGRESS', totalLines: 10, countedLines: 5 }),
      );
      mockListLines.mockResolvedValue({ items: [], total: 0 });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText(/Abrir IC-0001/i));

      await waitFor(() => {
        const progressbar = screen.getByRole('progressbar');
        expect(progressbar).toHaveAttribute('aria-valuenow', '50');
      });
    });
  });
});
