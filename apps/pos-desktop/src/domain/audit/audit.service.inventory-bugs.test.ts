/**
 * Bug-hunting tests for getInventoryMovements.
 *
 * The real getInventoryMovements IGNORES the _prisma parameter and uses
 * getLocalDatabase() directly (PGlite raw SQL). It ALSO ignores query.action
 * — the WHERE clause only includes date range, never movement type.
 *
 * These tests expose both bugs by mocking getLocalDatabase and inspecting
 * the SQL that would be sent to PGlite.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getLocalAuditEntries } from './audit.service';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock is hoisted to top of file, so we need vi.hoisted
// for references shared between factory and test bodies.
// ---------------------------------------------------------------------------

const mockQuery = vi.hoisted(() => vi.fn());
const mockGetLocalDatabase = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ client: { query: mockQuery } })),
);

vi.mock('../../infrastructure/local-database', () => ({
  getLocalDatabase: mockGetLocalDatabase,
}));

// ---------------------------------------------------------------------------
// Fake Prisma — still needed as first argument, even though getInventoryMovements
// IGNORES it.  That's part of the bug.
// ---------------------------------------------------------------------------

function makeFakePrisma() {
  return { localAuditLog: { findMany: vi.fn(), count: vi.fn() } } as any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the SQL string from the first client.query() call. */
function capturedSQL(): string {
  return mockQuery.mock.calls[0]?.[0] ?? '';
}

/** Extract the params array from the first client.query() call. */
function capturedParams(): unknown[] {
  return mockQuery.mock.calls[0]?.[1] ?? [];
}

describe('getInventoryMovements (getLocalAuditEntries with module=INVENTORY)', () => {
  let prisma: ReturnType<typeof makeFakePrisma>;

  beforeEach(() => {
    prisma = makeFakePrisma();
    mockQuery.mockReset();
    mockGetLocalDatabase.mockClear();
  });

  // ── BUG #1: action filter silently dropped ────────────────────────────

  describe('BUG: action filter is ignored', () => {
    it('does NOT include "movementType" or "action" in WHERE when action filter is provided', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })   // COUNT
        .mockResolvedValueOnce({ rows: [] });                // DATA

      await getLocalAuditEntries(prisma, {
        module: 'INVENTORY',
        action: 'INVENTORY_SALE',
      });

      const sql = capturedSQL();
      expect(sql).not.toContain('movementType');
      expect(sql).not.toContain('movement_type');
      expect(sql).not.toContain('action');
      expect(sql).not.toContain('INVENTORY_SALE');
    });

    it('returns all movements regardless of action filter value', async () => {
      const rows = [
        { id: 'm1', movement_type: 'SALE', quantity: 1, previous_stock: 10, resulting_stock: 9, created_by_id: 'u1', created_at: new Date(), lot_id: 'l1', reason: null, batch_number: null, product_name: null },
        { id: 'm2', movement_type: 'PURCHASE_RECEIPT', quantity: 5, previous_stock: 9, resulting_stock: 14, created_by_id: 'u2', created_at: new Date(), lot_id: 'l2', reason: null, batch_number: null, product_name: null },
      ];
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: rows.length }] })
        .mockResolvedValueOnce({ rows });

      const resultActionFiltered = await getLocalAuditEntries(prisma, {
        module: 'INVENTORY',
        action: 'INVENTORY_SALE',
      });

      // Both movement types returned despite action=INVENTORY_SALE
      expect(resultActionFiltered.rows).toHaveLength(2);
      expect(resultActionFiltered.rows[0].action).toBe('INVENTORY_SALE');
      expect(resultActionFiltered.rows[1].action).toBe('INVENTORY_PURCHASE_RECEIPT');
    });

    it('builds WHERE only from date filters, never from action', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getLocalAuditEntries(prisma, {
        module: 'INVENTORY',
        fromDate: '2026-01-01',
        toDate: '2026-01-31',
        action: 'INVENTORY_ADJUSTMENT_POSITIVE',
      });

      const sql = capturedSQL();
      // Date filter present
      expect(sql).toContain('"createdAt"');
      // No action filter
      expect(sql).not.toContain('movementType');
      expect(sql).not.toContain('movement_type');
    });
  });

  // ── BUG #2: _prisma parameter is ignored; uses getLocalDatabase() ─────

  describe('BUG: _prisma parameter is ignored (uses getLocalDatabase instead)', () => {
    it('calls getLocalDatabase() even though prisma was passed', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getLocalAuditEntries(prisma, { module: 'INVENTORY' });

      expect(mockGetLocalDatabase).toHaveBeenCalledTimes(1);
    });

    it('calls getLocalDatabase() instead of using _prisma parameter', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getLocalAuditEntries(prisma, { module: 'INVENTORY' });

      // BUG: _prisma is marked with underscore (unused) — the function
      // bypasses it entirely and goes straight to PGlite via getLocalDatabase()
      expect(mockGetLocalDatabase).toHaveBeenCalledTimes(1);
    });

    it('sends two SQL statements via client.query(): COUNT then SELECT', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getLocalAuditEntries(prisma, { module: 'INVENTORY' });

      expect(mockQuery).toHaveBeenCalledTimes(2);
      // First call: COUNT
      expect(capturedSQL()).toMatch(/COUNT/i);
      // Verify data query (second call) — multiline SQL, use toContain
      const dataSQL = mockQuery.mock.calls[1][0] as string;
      expect(dataSQL).toContain('SELECT');
      expect(dataSQL).toContain('FROM "InventoryMovement"');
    });
  });

  // ── Parameter interpolation ──────────────────────────────────────────

  describe('parameterised SQL', () => {
    it('passes date range as positional parameters', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getLocalAuditEntries(prisma, {
        module: 'INVENTORY',
        fromDate: '2026-06-01',
        toDate: '2026-06-30',
      });

      const params = capturedParams();
      expect(params).toContain('2026-06-01');
      expect(params).toContain('2026-06-30T23:59:59.999Z');
    });

    it('uses LIMIT and OFFSET in data query', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getLocalAuditEntries(prisma, {
        module: 'INVENTORY',
        limit: 25,
        offset: 10,
      });

      // Second call = data query
      const dataSQL = mockQuery.mock.calls[1][0];
      const dataParams = mockQuery.mock.calls[1][1];
      expect(dataSQL).toMatch(/LIMIT\s+\$\d+/i);
      expect(dataSQL).toMatch(/OFFSET\s+\$\d+/i);
      expect(dataParams).toContain(25);
      expect(dataParams).toContain(10);
    });
  });

  // ── Edge: empty results ──────────────────────────────────────────────

  it('returns empty rows when no movements match', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getLocalAuditEntries(prisma, {
      module: 'INVENTORY',
      fromDate: '2020-01-01',
      toDate: '2020-01-02',
    });

    expect(result.total).toBe(0);
    expect(result.rows).toHaveLength(0);
  });
});
