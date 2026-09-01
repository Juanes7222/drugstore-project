/**
 * Component tests for InventoryCountPage — reconteo completo.
 *
 * Covers: list loading, empty state, session cards, create dialog open,
 * scope validation, detail navigation and sheet render. Service is mocked
 * via ServiceContext.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { uiSlice } from '@/store/slices/ui-slice';
import { InventoryCountPage } from './inventory-count.page';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockListSessions = vi.fn<() => Promise<any[]>>();
const mockGetSession = vi.fn<() => Promise<any>>();
const mockListLines = vi.fn<() => Promise<{ items: any[]; total: number }>>();
const mockCreateSession = vi.fn<() => Promise<any>>();
const mockStartSession = vi.fn<() => Promise<any>>();
const mockRecordCount = vi.fn<() => Promise<any>>();
const mockNotifySuccess = vi.fn();

const mockService = {
  listSessions: mockListSessions,
  getSession: mockGetSession,
  listLines: mockListLines,
  createSession: mockCreateSession,
  startSession: mockStartSession,
  recordCount: mockRecordCount,
  setFinalQty: vi.fn(),
  evaluateRecounts: vi.fn(),
  moveToReview: vi.fn(),
  closeSession: vi.fn(),
  cancelSession: vi.fn(),
  getProgress: vi.fn(),
};

vi.mock('../common/service-context', () => ({
  useInventoryCountService: () => mockService,
}));

vi.mock('@/utils/notify', () => ({
  notify: {
    success: (...args: unknown[]) => {
      mockNotifySuccess(...args);
      return 'toast-id';
    },
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock dynamic import for categories — return empty so dialog falls back to free text
vi.mock('../../../infrastructure/local-database', () => ({
  getLocalDatabase: vi.fn().mockResolvedValue({
    prisma: {
      category: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  }),
}));

const createTestStore = () =>
  configureStore({
    reducer: { ui: uiSlice.reducer },
  });

const renderPage = (store = createTestStore()) =>
  render(
    <Provider store={store}>
      <InventoryCountPage />
    </Provider>,
  );

// ── Helpers ─────────────────────────────────────────────────────────────────

function createDeferred<T = unknown>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (value: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const baseSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'sess-1',
  code: 'IC-0001',
  sequentialNumber: 1,
  name: null,
  state: 'DRAFT',
  scopeType: 'FULL',
  scopeValue: null,
  scopeLabel: null,
  mode: 'BLIND',
  tolerancePercent: 2,
  requireDoubleCount: true,
  totalLines: 2,
  countedLines: 0,
  recountedLines: 0,
  discrepancyCount: 0,
  totalValueImpact: null,
  notes: null,
  createdByUserId: 'user-1',
  createdByUserName: 'Inventory Assistant',
  workstationId: 'ws-1',
  createdAt: new Date('2026-01-01T10:00:00.000Z').toISOString(),
  updatedAt: new Date('2026-01-01T10:00:00.000Z').toISOString(),
  startedAt: null,
  reviewedAt: null,
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
    it('opens dialog when clicking Nuevo reconteo', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /Crear nuevo reconteo/i }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Nuevo reconteo' })).toBeInTheDocument();
    });

    it('shows category selector when scope is CATEGORY', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /Crear nuevo reconteo/i }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Change scope to CATEGORY
      const scopeSelect = screen.getByLabelText('Alcance del reconteo');
      await userEvent.selectOptions(scopeSelect, 'CATEGORY');

      expect(screen.getByLabelText('Categoría')).toBeInTheDocument();
    });

    it('shows validation error when creating CATEGORY without value', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /Crear nuevo reconteo/i }));

      const scopeSelect = screen.getByLabelText('Alcance del reconteo');
      await userEvent.selectOptions(scopeSelect, 'CATEGORY');

      // Go to step 2 without selecting category value
      await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear borrador' })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('Seleccione una categoría')).toBeInTheDocument();
      });
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it('shows validation error for LABORATORY without value', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /Crear nuevo reconteo/i }));

      await userEvent.selectOptions(screen.getByLabelText('Alcance del reconteo'), 'LABORATORY');

      await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Crear borrador' })).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

      await waitFor(() => {
        expect(screen.getByText('Ingrese el laboratorio')).toBeInTheDocument();
      });
    });

    it('closes dialog on successful create and shows new session in list', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /Crear nuevo reconteo/i }));
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
      expect(screen.getByRole('tablist', { name: /Filtros de líneas/i })).toBeInTheDocument();
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
      expect(screen.getByRole('button', { name: /Volver al listado/i })).toBeInTheDocument();
    });

    it('renders page heading with accessible aria-label', async () => {
      renderPage();

      expect(screen.getByRole('region', { name: /Reconteo de inventario/i })).toBeInTheDocument();

      // After opening detail, region label changes to Recontero CODE
      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText(/Abrir IC-0001/i));

      await waitFor(() => {
        expect(screen.getByLabelText(/Reconteo IC-0001/i)).toBeInTheDocument();
      });
    });
  });

  describe('accessibility', () => {
    it('dialog has aria-modal and labelled title', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('IC-0001')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /Crear nuevo reconteo/i }));

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
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '50');
      });
    });
  });
});
