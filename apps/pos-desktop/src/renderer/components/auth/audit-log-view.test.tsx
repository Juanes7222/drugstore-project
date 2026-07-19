/**
 * Component tests for AuditLogView (timeline redesign).
 *
 * Covers: role gate (MANAGER+), empty state, timeline cards as <article>
 * elements with aria-labels, day grouping (Hoy/Ayer), detail expand/collapse,
 * target display suppression for unknown:unknown, event filter change,
 * date range inputs, pagination controls, and refresh button.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditLogView } from './audit-log-view';
import { RoleType } from '@pharmacy/shared-types';
import type { LocalSession } from '../../../domain/auth/local-session.store';
import type { AuditLogEntry } from '../audit/audit-event-card';

// ---------------------------------------------------------------------------
// Hoisted mock state (must be before vi.mock calls)
// ---------------------------------------------------------------------------

const { mockSessionState, mockAuthService } = vi.hoisted(() => {
  const state: {
    session: LocalSession | null;
    isInitialized: boolean;
  } = {
    session: null,
    isInitialized: true,
  };
  return {
    mockSessionState: state,
    mockAuthService: {
      login: vi.fn(),
      completeTwoFactor: vi.fn(),
      refreshSession: vi.fn(),
      requestStepUp: vi.fn(),
      approveStepUp: vi.fn(),
      verifyStepUp: vi.fn(),
      changePassword: vi.fn(),
      changePin: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
      getCurrentSession: vi.fn(),
      requireRole: vi.fn(),
      logout: vi.fn(),
      createUser: vi.fn(),
      listUsers: vi.fn(),
      getPendingStepUpRequests: vi.fn(),
      getAuditLogs: vi.fn(),
    },
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../domain/auth/local-session.store', () => ({
  useLocalSessionStore: (
    selector: (s: typeof mockSessionState) => unknown,
  ) => selector(mockSessionState),
  hasMinRole: (
    session: LocalSession | null,
    minRole: RoleType,
  ): boolean => {
    if (!session) return false;
    const hierarchy: Record<string, number> = {
      CASHIER: 0,
      INVENTORY_ASSISTANT: 0,
      MANAGER: 1,
      ACCOUNTANT: 1,
      OWNER: 2,
      ADMIN: 2,
      SAAS_ADMIN: 3,
    };
    const userLevel = hierarchy[session.role as string] ?? -1;
    const requiredLevel = hierarchy[minRole] ?? -1;
    return userLevel >= requiredLevel;
  },
}));

vi.mock('@infra/config', () => ({
  API_BASE_URL: 'http://localhost:3000',
}));

vi.mock('../../../domain/auth/auth.service', () => ({
  createAuthService: vi.fn(() => mockAuthService),
}));

vi.mock('../../../infrastructure/local-database', () => ({
  getLocalDatabase: vi.fn(),
}));

vi.mock('../../../domain/audit/audit.service', () => ({
  getLocalAuditEntries: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const managerSession: LocalSession = {
  userId: 'u-1',
  username: 'maria.garcia',
  fullName: 'María García',
  displayName: 'María García',
  email: 'maria@example.com',
  role: RoleType.MANAGER,
  subscriptionId: null,
  workstationId: 'ws-1',
  accessToken: 'tok-1',
  refreshToken: 'rtok-1',
  expiresAt: new Date('2099-01-01'),
  sessionId: 's-1',
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
};

function makeLogEntry(
  overrides: Partial<AuditLogEntry> & { id: string },
): AuditLogEntry {
  return {
    action: 'AUTH_LOGIN_SUCCESS',
    createdAt: new Date().toISOString(),
    userId: 'u-1',
    userRole: 'MANAGER',
    entityType: 'Session',
    entityId: 's-1',
    details: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AuditLogView', () => {
  beforeEach(() => {
    mockSessionState.session = null;
    vi.clearAllMocks();
  });

  // No afterEach needed — beforeEach resets session + mocks already

  // -----------------------------------------------------------------------
  // Role gate
  // -----------------------------------------------------------------------

  describe('role gate', () => {
    it('shows no permission message when the user is CASHIER', () => {
      mockSessionState.session = {
        ...managerSession,
        role: RoleType.CASHIER,
      };

      render(<AuditLogView />);

      expect(
        screen.getByText('No tiene permisos para ver esta página.'),
      ).toBeInTheDocument();
    });

    it('renders the timeline view for a MANAGER user', async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({ id: 'log-1' }),
        ],
        total: 1,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByText('Registro de auditoría'),
        ).toBeInTheDocument();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Empty and loading states
  // -----------------------------------------------------------------------

  describe('empty state', () => {
    it('shows empty state with icon and hint when no events returned', async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [],
        total: 0,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByText('No se encontraron eventos para los filtros seleccionados'),
        ).toBeInTheDocument();
        expect(
          screen.getByText('Intenta ajustar las fechas o cambiar el tipo de evento'),
        ).toBeInTheDocument();
      });
    });

    it('shows a loading indicator while fetching logs', () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockReturnValue(
        new Promise(() => { /* never resolves */ }),
      );

      render(<AuditLogView />);

      expect(screen.getByText('Cargando...')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Timeline cards
  // -----------------------------------------------------------------------

  describe('timeline cards', () => {
    it('renders each event as an article with aria-label containing name and time', async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({
            id: 'log-1',
            action: 'AUTH_LOGIN_SUCCESS',
            createdAt: '2026-07-18T08:00:00Z',
          }),
          makeLogEntry({
            id: 'log-2',
            action: 'STEP_UP_AUTHORIZED',
            createdAt: '2026-07-18T09:30:00Z',
          }),
        ],
        total: 2,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        const articles = screen.getAllByRole('article');
        expect(articles).toHaveLength(2);
      });

      expect(
        screen.getByRole('article', { name: /Inicio de sesión/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('article', { name: /Autorización step-up/ }),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Day grouping
  // -----------------------------------------------------------------------

  describe('day grouping', () => {
    it('groups today events under Hoy and yesterday events under Ayer', async () => {
      const now = new Date();
      const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({
            id: 'log-today',
            action: 'AUTH_LOGIN_SUCCESS',
            createdAt: `${todayDate}T08:00:00.000Z`,
          }),
          makeLogEntry({
            id: 'log-yesterday',
            action: 'AUTH_LOGOUT',
            createdAt: `${yesterdayDate}T17:30:00.000Z`,
          }),
        ],
        total: 2,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 2, name: 'Hoy' }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('heading', { level: 2, name: 'Ayer' }),
        ).toBeInTheDocument();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Detail expand / collapse
  // -----------------------------------------------------------------------

  describe('detail expand', () => {
    it('shows Ver detalles button, click expands human-readable detail fragments, toggle hides it', async () => {
      const user = userEvent.setup();

      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({
            id: 'log-detail',
            details: '{"method":"PIN","reason":"bloqueo por inactividad"}',
          }),
        ],
        total: 1,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByRole('article'),
        ).toBeInTheDocument();
      });

      const expandButton = screen.getByRole('button', {
        name: 'Ver detalles',
      });
      expect(expandButton).toBeInTheDocument();
      expect(expandButton).toHaveAttribute('aria-expanded', 'false');

      await user.click(expandButton);

      await waitFor(() => {
        // Unknown field rendered as generic "key: value" pair (expanded only)
        expect(screen.getByText('method: PIN')).toBeInTheDocument();
        // Known "reason" field rendered via translated template — appears
        // once in the summary paragraph and once in the expanded detail panel
        expect(screen.getAllByText('Motivo: bloqueo por inactividad')).toHaveLength(2);
      });

      const collapseButton = screen.getByRole('button', {
        name: 'Ocultar detalles',
      });
      expect(collapseButton).toHaveAttribute('aria-expanded', 'true');

      await user.click(collapseButton);

      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Ocultar detalles' }),
        ).not.toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Ver detalles' }),
        ).toBeInTheDocument();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Target display
  // -----------------------------------------------------------------------

  describe('target display', () => {
    it('hides target line when entityType and entityId are both unknown', async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({
            id: 'log-unknown',
            entityType: 'unknown',
            entityId: 'unknown',
            productName: undefined,
          }),
        ],
        total: 1,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByRole('article'),
        ).toBeInTheDocument();
      });

      // The card renders, but no "Producto:" or entity type text appears.
      expect(screen.queryByText(/Producto/i)).not.toBeInTheDocument();
    });

    it('shows target line with productName when present', async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({
            id: 'log-product',
            entityType: 'InventoryMovement',
            entityId: 'lot-1',
            productName: 'Paracetamol 500mg',
            lotBatch: 'LOT-123',
          }),
        ],
        total: 1,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByText(/Paracetamol 500mg/),
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Lote: LOT-123/),
        ).toBeInTheDocument();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Filters — event type
  // -----------------------------------------------------------------------

  describe('event filter', () => {
    it('calls getAuditLogs with the selected event value on change', async () => {
      const user = userEvent.setup();

      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({ id: 'log-1' }),
          makeLogEntry({ id: 'log-2' }),
        ],
        total: 2,
      });

      render(<AuditLogView />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockAuthService.getAuditLogs).toHaveBeenCalledTimes(1);
      });

      const eventSelect = screen.getByLabelText('Evento');
      await user.selectOptions(eventSelect, 'AUTH_LOGIN_SUCCESS');

      await waitFor(() => {
        expect(mockAuthService.getAuditLogs).toHaveBeenCalledTimes(2);
        expect(mockAuthService.getAuditLogs).toHaveBeenLastCalledWith(
          expect.objectContaining({ event: 'AUTH_LOGIN_SUCCESS' }),
        );
      });
    });
  });

  // -----------------------------------------------------------------------
  // Filters — date range
  // -----------------------------------------------------------------------

  describe('date range', () => {
    it('calls getAuditLogs with new fromDate when changed', async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({ id: 'log-1' }),
        ],
        total: 1,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(mockAuthService.getAuditLogs).toHaveBeenCalledTimes(1);
      });

      const fromDateInput = screen.getByLabelText('Desde');
      fireEvent.change(fromDateInput, { target: { value: '2026-07-01' } });

      await waitFor(() => {
        expect(mockAuthService.getAuditLogs).toHaveBeenCalledTimes(2);
        expect(mockAuthService.getAuditLogs).toHaveBeenLastCalledWith(
          expect.objectContaining({ fromDate: '2026-07-01' }),
        );
      });
    });

    it('calls getAuditLogs with new toDate when changed', async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({ id: 'log-1' }),
        ],
        total: 1,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(mockAuthService.getAuditLogs).toHaveBeenCalledTimes(1);
      });

      const toDateInput = screen.getByLabelText('Hasta');
      fireEvent.change(toDateInput, { target: { value: '2026-07-31' } });

      await waitFor(() => {
        expect(mockAuthService.getAuditLogs).toHaveBeenCalledTimes(2);
        expect(mockAuthService.getAuditLogs).toHaveBeenLastCalledWith(
          expect.objectContaining({ toDate: '2026-07-31' }),
        );
      });
    });
  });

  // -----------------------------------------------------------------------
  // Pagination
  // -----------------------------------------------------------------------

  describe('pagination', () => {
    it('shows Anterior / Siguiente buttons when total > pageSize (50)', async () => {
      mockSessionState.session = managerSession;
      // Return fewer rows than total to simulate current page being a partial slice
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({ id: 'log-1' }),
        ],
        total: 100,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Anterior' }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Siguiente' }),
        ).toBeInTheDocument();
      });
    });

    it('disables the Anterior button on the first page', async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({ id: 'log-1' }),
        ],
        total: 100,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Anterior' }),
        ).toBeDisabled();
      });
    });

    it('shows page indicator with correct page count', async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({ id: 'log-1' }),
        ],
        total: 100,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByText('1 de 2'),
        ).toBeInTheDocument();
      });
    });

    it('does not render pagination when total <= pageSize', async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({ id: 'log-1' }),
        ],
        total: 50,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Anterior' }),
        ).not.toBeInTheDocument();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Refresh button
  // -----------------------------------------------------------------------

  describe('refresh button', () => {
    it('calls fetchLogs again when the refresh button is clicked', async () => {
      const user = userEvent.setup();

      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs.mockResolvedValue({
        rows: [
          makeLogEntry({ id: 'log-1' }),
        ],
        total: 1,
      });

      render(<AuditLogView />);

      // Initial fetchLogs fires on mount
      await waitFor(() => {
        expect(mockAuthService.getAuditLogs).toHaveBeenCalledTimes(1);
      });

      const refreshButton = screen.getByRole('button', {
        name: 'Actualizar',
      });
      await user.click(refreshButton);

      await waitFor(() => {
        expect(mockAuthService.getAuditLogs).toHaveBeenCalledTimes(2);
      });
    });
  });
});
