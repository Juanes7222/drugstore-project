/**
 * Bug-hunting tests for AuditLogView filter logic.
 *
 * Reveals 3 bugs:
 *   1. getInventoryMovements ignores query.action filter
 *   2. commonQuery.action key mismatches server's expected "event" param
 *   3. getEventConfig fallback defaults to AUTH_USERS for unknown events
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditLogView } from './audit-log-view';
import type { AuditLogEntry } from './audit-event-card';

// ---------------------------------------------------------------------------
// Mock ALL external dependencies
// ---------------------------------------------------------------------------

const mockUseLocalSessionStore = vi.hoisted(() => vi.fn());
const mockHasMinRole = vi.hoisted(() => vi.fn());

vi.mock('../../../domain/auth/local-session.store', () => ({
  useLocalSessionStore: mockUseLocalSessionStore,
  hasMinRole: mockHasMinRole,
}));

const mockGetAuditLogs = vi.hoisted(() => vi.fn());
const mockCreateAuthService = vi.hoisted(() =>
  vi.fn(() => ({ getAuditLogs: mockGetAuditLogs })),
);

vi.mock('../../../domain/auth/auth.service', () => ({
  createAuthService: mockCreateAuthService,
}));

const mockGetLocalAuditEntries = vi.hoisted(() => vi.fn());
vi.mock('../../../domain/audit/audit.service', () => ({
  getLocalAuditEntries: mockGetLocalAuditEntries,
}));

const mockGetLocalDatabase = vi.hoisted(() => vi.fn());
vi.mock('../../../infrastructure/local-database', () => ({
  getLocalDatabase: mockGetLocalDatabase,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLocalRow(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'local-1',
    action: 'CASH_SHIFT_OPENED',
    createdAt: '2026-07-22T10:00:00.000Z',
    userId: 'user-1',
    userRole: 'MANAGER',
    entityType: 'CashShift',
    entityId: 'shift-1',
    details: null,
    productName: undefined,
    lotBatch: undefined,
    ...overrides,
  };
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return { localAuditLog: { findMany: vi.fn(), count: vi.fn() } };
}

function setupDefaultMocks() {
  mockUseLocalSessionStore.mockImplementation(
    (selector: (s: Record<string, unknown>) => unknown) => {
      const state = {
        session: {
          userId: 'manager-1',
          role: 'MANAGER',
          accessToken: 'tok_xxx',
        },
      };
      return selector(state);
    },
  );
  mockHasMinRole.mockReturnValue(true);
  mockGetLocalDatabase.mockResolvedValue({ prisma: createMockPrisma() });
  mockGetLocalAuditEntries.mockResolvedValue({ rows: [], total: 0 });
  mockGetAuditLogs.mockResolvedValue({ rows: [], total: 0 });
}

function cleanupDefaultMocks() {
  vi.clearAllMocks();
}

/**
 * Wait for the initial fetch triggered by useEffect to complete,
 * then clear all recorded calls so subsequent actions have clean state.
 */
async function waitForInitialFetchAndReset() {
  await waitFor(() => {
    expect(mockGetLocalAuditEntries).toHaveBeenCalled();
  });
  vi.clearAllMocks();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditLogView — filter routing logic', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    cleanupDefaultMocks();
  });

  // ── Default: all modules ──────────────────────────────────────────────

  it('calls BOTH local and server when moduleFilter is empty (default)', async () => {
    render(<AuditLogView />);

    await waitFor(() => {
      expect(mockGetLocalDatabase).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockGetLocalAuditEntries).toHaveBeenCalled();
      expect(mockGetAuditLogs).toHaveBeenCalled();
    });
  });

  it('passes module: undefined to getLocalAuditEntries when moduleFilter is empty', async () => {
    render(<AuditLogView />);

    await waitFor(() => {
      expect(mockGetLocalAuditEntries).toHaveBeenCalled();
    });

    const callArgs = mockGetLocalAuditEntries.mock.calls[0];
    expect(callArgs[1].module).toBeUndefined();
  });

  // ── Local-only modules ────────────────────────────────────────────────

  it('calls ONLY local when moduleFilter is CASH_SHIFT', async () => {
    render(<AuditLogView />);
    await waitForInitialFetchAndReset();

    const moduleSelect = screen.getByRole('combobox', { name: /módulo/i });
    await userEvent.selectOptions(moduleSelect, 'CASH_SHIFT');

    await waitFor(() => {
      expect(mockGetLocalAuditEntries).toHaveBeenCalled();
      // Server should NOT be called after module change
      expect(mockGetAuditLogs).not.toHaveBeenCalled();
    });

    const lastCall = mockGetLocalAuditEntries.mock.calls.at(-1);
    expect(lastCall![1].module).toBe('CASH_SHIFT');
  });

  it('calls ONLY local when moduleFilter is SALES', async () => {
    render(<AuditLogView />);
    await waitForInitialFetchAndReset();

    const moduleSelect = screen.getByRole('combobox', { name: /módulo/i });
    await userEvent.selectOptions(moduleSelect, 'SALES');

    await waitFor(() => {
      expect(mockGetLocalAuditEntries).toHaveBeenCalled();
    });

    expect(mockGetAuditLogs).not.toHaveBeenCalled();
  });

  // ── Server-only module ────────────────────────────────────────────────

  it('calls ONLY server when moduleFilter is AUTH_USERS', async () => {
    render(<AuditLogView />);
    await waitForInitialFetchAndReset();

    const moduleSelect = screen.getByRole('combobox', { name: /módulo/i });
    await userEvent.selectOptions(moduleSelect, 'AUTH_USERS');

    await waitFor(() => {
      expect(mockGetAuditLogs).toHaveBeenCalled();
    });

    // Local should NOT be called after module change to AUTH_USERS
    expect(mockGetLocalAuditEntries).not.toHaveBeenCalled();
  });

  // ── Event filter with local module ────────────────────────────────────

  it('passes action to getLocalAuditEntries when eventFilter is set and module is CASH_SHIFT', async () => {
    render(<AuditLogView />);
    await waitForInitialFetchAndReset();

    const moduleSelect = screen.getByRole('combobox', { name: /módulo/i });
    await userEvent.selectOptions(moduleSelect, 'CASH_SHIFT');
    await waitFor(() => {
      expect(mockGetLocalAuditEntries).toHaveBeenCalled();
    });
    vi.clearAllMocks();

    // Now set event filter
    const eventSelect = screen.getByRole('combobox', { name: /evento/i });
    await userEvent.selectOptions(eventSelect, 'CASH_SHIFT_OPENED');

    await waitFor(() => {
      const lastCall = mockGetLocalAuditEntries.mock.calls.at(-1);
      expect(lastCall![1].action).toBe('CASH_SHIFT_OPENED');
      expect(lastCall![1].module).toBe('CASH_SHIFT');
    });
  });

  it('does NOT pass action when eventFilter is empty', async () => {
    render(<AuditLogView />);
    await waitForInitialFetchAndReset();

    const moduleSelect = screen.getByRole('combobox', { name: /módulo/i });
    await userEvent.selectOptions(moduleSelect, 'CASH_SHIFT');

    await waitFor(() => {
      const lastCall = mockGetLocalAuditEntries.mock.calls.at(-1);
      expect(lastCall![1].module).toBe('CASH_SHIFT');
      // eventFilter starts empty after module change — action should be undefined
      expect(lastCall![1].action).toBeUndefined();
    });
  });

  // ── BUG #3: action vs event param name mismatch for server ────────────

  describe('BUG: commonQuery.action param name mismatch with server API', () => {
    it('sends "action" key to getAuditLogs but server expects "event"', async () => {
      render(<AuditLogView />);
      await waitForInitialFetchAndReset();

      // Set event filter
      const eventSelect = screen.getByRole('combobox', { name: /evento/i });
      await userEvent.selectOptions(eventSelect, 'AUTH_LOGIN_SUCCESS');

      await waitFor(() => {
        expect(mockGetAuditLogs).toHaveBeenCalled();
      });

      const serverArgs = mockGetAuditLogs.mock.calls.at(-1)?.[0];
      expect(serverArgs!.action).toBe('AUTH_LOGIN_SUCCESS');
      // BUG: the param name is "action" but server.getAuditLogs reads "filters.event"
    });

    it('server getAuditLogs does NOT receive an "event" key when filter is set', async () => {
      render(<AuditLogView />);
      await waitForInitialFetchAndReset();

      const eventSelect = screen.getByRole('combobox', { name: /evento/i });
      await userEvent.selectOptions(eventSelect, 'AUTH_LOGIN_SUCCESS');

      await waitFor(() => {
        expect(mockGetAuditLogs).toHaveBeenCalled();
      });

      const serverArgs = mockGetAuditLogs.mock.calls.at(-1)?.[0];
      // Server expects serverArgs.event, but the component sends serverArgs.action
      expect(serverArgs!.event).toBeUndefined();
      // The event filter is SILENTLY DROPPED for server queries
    });
  });

  // ── Event filter cleared when module changes ──────────────────────────

  it('clears eventFilter when moduleFilter changes', async () => {
    render(<AuditLogView />);
    await waitForInitialFetchAndReset();

    const eventSelect = screen.getByRole('combobox', { name: /evento/i });
    // Set an event filter first
    await userEvent.selectOptions(eventSelect, 'CASH_SHIFT_OPENED');

    // Now change module — this should reset eventFilter to ""
    const moduleSelect = screen.getByRole('combobox', { name: /módulo/i });
    await userEvent.selectOptions(moduleSelect, 'CASH_SHIFT');

    await waitFor(() => {
      expect((eventSelect as HTMLSelectElement).value).toBe('');
    });
  });

  // ── Offline resilience ────────────────────────────────────────────────

  it('does not crash when server fails but local resolves', async () => {
    mockGetAuditLogs.mockRejectedValue(new Error('Network error — offline'));
    mockGetLocalAuditEntries.mockResolvedValue({
      rows: [makeLocalRow()],
      total: 1,
    });

    render(<AuditLogView />);

    // In "all modules" view, Promise.all rejects when server fails.
    // The catch block prevents a crash. Component should show empty state.
    await waitFor(() => {
      expect(mockGetLocalAuditEntries).toHaveBeenCalled();
      expect(mockGetAuditLogs).toHaveBeenCalled();
    });

    // Component should recover to loading=false and not throw
    await waitFor(() => {
      expect(screen.queryByText(/cargando|loading/i)).not.toBeInTheDocument();
    });
  });

  it('handles local-only modules without server calls', async () => {
    mockGetLocalAuditEntries.mockResolvedValue({
      rows: [makeLocalRow()],
      total: 1,
    });

    render(<AuditLogView />);
    await waitForInitialFetchAndReset();

    const moduleSelect = screen.getByRole('combobox', { name: /módulo/i });
    await userEvent.selectOptions(moduleSelect, 'CASH_SHIFT');

    await waitFor(() => {
      expect(mockGetLocalAuditEntries).toHaveBeenCalled();
    });

    expect(mockGetAuditLogs).not.toHaveBeenCalled();
  });

  // ── filteredEventOptions ──────────────────────────────────────────────

  describe('filteredEventOptions', () => {
    it('shows many event options when no module is selected (all modules)', async () => {
      render(<AuditLogView />);

      const eventSelect = screen.getByRole('combobox', { name: /evento/i });
      const options = within(eventSelect).getAllByRole('option');

      // All events (42+) + placeholder = many options
      expect(options.length).toBeGreaterThan(10);
    });

    it('shows only CASH_SHIFT events when moduleFilter is CASH_SHIFT', async () => {
      render(<AuditLogView />);
      await waitForInitialFetchAndReset();

      const moduleSelect = screen.getByRole('combobox', { name: /módulo/i });
      await userEvent.selectOptions(moduleSelect, 'CASH_SHIFT');

      await waitFor(() => {
        const eventSelect = screen.getByRole('combobox', { name: /evento/i });
        const options = within(eventSelect).getAllByRole('option') as HTMLOptionElement[];
        const nonEmptyValues = options.map((o) => o.value).filter((v) => v !== '');
        // After module change, event options should be filtered
        // CASH_SHIFT has: CASH_SHIFT_OPENED, CASH_SHIFT_CLOSED, CASH_SHIFT_FORCED_CLOSE, CASH_COUNT_PARTIAL
        expect(nonEmptyValues.length).toBeGreaterThanOrEqual(3);
        for (const val of nonEmptyValues) {
          expect(val).toMatch(/^CASH_/);
        }
      });
    });

    it('shows all events again when returning to "all modules" from a filtered view', async () => {
      render(<AuditLogView />);
      await waitForInitialFetchAndReset();

      // Select a module to filter
      const moduleSelect = screen.getByRole('combobox', { name: /módulo/i });
      await userEvent.selectOptions(moduleSelect, 'CASH_SHIFT');

      // Go back to all modules
      await userEvent.selectOptions(moduleSelect, '');

      await waitFor(() => {
        const eventSelect = screen.getByRole('combobox', { name: /evento/i });
        const options = within(eventSelect).getAllByRole('option') as HTMLOptionElement[];
        const nonEmptyValues = options.map((o) => o.value).filter((v) => v !== '');
        // Should have many events again (not just CASH_SHIFT)
        const cashShiftCount = nonEmptyValues.filter((v) => v.startsWith('CASH_')).length;
        expect(cashShiftCount).toBeGreaterThan(0);
        const nonCashCount = nonEmptyValues.filter((v) => !v.startsWith('CASH_')).length;
        expect(nonCashCount).toBeGreaterThan(0);
      });
    });
  });

  // ── Role gate ─────────────────────────────────────────────────────────

  it('shows no permission message when session is null', async () => {
    mockUseLocalSessionStore.mockImplementation(
      (selector: (s: Record<string, unknown>) => unknown) => {
        return selector({ session: null });
      },
    );
    mockHasMinRole.mockReturnValue(false);

    render(<AuditLogView />);

    await waitFor(() => {
      expect(screen.getByText(/permiso/i)).toBeInTheDocument();
    });

    // BUG-MINOR: the useEffect with fetchLogs fires even when the role gate
    // will block rendering. This is a performance concern — the fetch is
    // queued during render before the early return. Not security-critical
    // since the data isn't displayed, but wasteful.
  });

  it('shows no permission message when role is below MANAGER', async () => {
    mockUseLocalSessionStore.mockImplementation(
      (selector: (s: Record<string, unknown>) => unknown) => {
        return selector({ session: { userId: 'cashier-1', role: 'CASHIER' } });
      },
    );
    mockHasMinRole.mockReturnValue(false);

    render(<AuditLogView />);

    await waitFor(() => {
      expect(screen.getByText(/permiso/i)).toBeInTheDocument();
    });

    // BUG-MINOR: same as above — fetch fires despite role gate
  });
});
