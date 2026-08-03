/**
 * Tests for getInventoryMovements (INVENTORY module of getLocalAuditEntries).
 *
 * The INVENTORY reader runs raw SQL against the PGlite client passed by the
 * caller (third argument). It:
 *   - maps an `action` filter (e.g. INVENTORY_SALE) back to the
 *     InventoryMovement `movementType` and adds it to the WHERE clause,
 *   - includes date-range filters as positional parameters,
 *   - runs two statements: COUNT then SELECT (with LIMIT/OFFSET),
 *   - throws when no PGlite client is provided.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getLocalAuditEntries } from './audit.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakePrisma() {
  return { localAuditLog: { findMany: vi.fn(), count: vi.fn() } } as any;
}

/** PGlite-like client whose query() is fully mocked. */
function makeMockClient() {
  return { query: vi.fn() };
}

describe('getInventoryMovements (getLocalAuditEntries with module=INVENTORY)', () => {
  let prisma: ReturnType<typeof makeFakePrisma>;

  beforeEach(() => {
    prisma = makeFakePrisma();
  });

  // ── Action filter ────────────────────────────────────────────────────

  describe('action filter', () => {
    it('includes the movementType filter in WHERE when an action is provided', async () => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })   // COUNT
        .mockResolvedValueOnce({ rows: [] });               // DATA

      await getLocalAuditEntries(prisma, {
        module: 'INVENTORY',
        action: 'INVENTORY_SALE',
      }, client as any);

      const sql = client.query.mock.calls[0][0] as string;
      expect(sql).toContain('"movementType"');
      expect(sql).toContain('= $1');
    });

    it('maps the action label back to the movementType in the parameters', async () => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getLocalAuditEntries(prisma, {
        module: 'INVENTORY',
        action: 'INVENTORY_PURCHASE_RECEIPT',
      }, client as any);

      const params = client.query.mock.calls[0][1] as unknown[];
      expect(params).toContain('PURCHASE_RECEIPT');
    });

    it('does not add a movementType condition for an unknown action label', async () => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getLocalAuditEntries(prisma, {
        module: 'INVENTORY',
        action: 'UNKNOWN_LABEL',
      }, client as any);

      const sql = client.query.mock.calls[0][0] as string;
      expect(sql).not.toContain('movementType');
    });

    it('builds WHERE from both date filters and the action filter', async () => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getLocalAuditEntries(prisma, {
        module: 'INVENTORY',
        fromDate: '2026-01-01',
        toDate: '2026-01-31',
        action: 'INVENTORY_ADJUSTMENT_POSITIVE',
      }, client as any);

      const sql = client.query.mock.calls[0][0] as string;
      expect(sql).toContain('"createdAt"');
      expect(sql).toContain('"movementType"');
    });
  });

  // ── Client usage ─────────────────────────────────────────────────────

  describe('PGlite client usage', () => {
    it('queries through the passed client (COUNT then SELECT)', async () => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getLocalAuditEntries(prisma, { module: 'INVENTORY' }, client as any);

      expect(client.query).toHaveBeenCalledTimes(2);
      expect(client.query.mock.calls[0][0]).toMatch(/COUNT/i);
      const dataSQL = client.query.mock.calls[1][0] as string;
      expect(dataSQL).toContain('SELECT');
      expect(dataSQL).toContain('FROM "InventoryMovement"');
    });

    it('throws when INVENTORY is queried without a PGlite client', async () => {
      await expect(
        getLocalAuditEntries(prisma, { module: 'INVENTORY' }),
      ).rejects.toThrow('PGlite client is required for INVENTORY module');
    });
  });

  // ── Parameter interpolation ──────────────────────────────────────────

  describe('parameterised SQL', () => {
    it('passes date range as positional parameters', async () => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getLocalAuditEntries(prisma, {
        module: 'INVENTORY',
        fromDate: '2026-06-01',
        toDate: '2026-06-30',
      }, client as any);

      const params = client.query.mock.calls[0][1] as unknown[];
      expect(params).toContain('2026-06-01');
      expect(params).toContain('2026-06-30T23:59:59.999Z');
    });

    it('uses LIMIT and OFFSET in the data query', async () => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getLocalAuditEntries(prisma, {
        module: 'INVENTORY',
        limit: 25,
        offset: 10,
      }, client as any);

      // Second call = data query
      const dataSQL = client.query.mock.calls[1][0] as string;
      const dataParams = client.query.mock.calls[1][1] as unknown[];
      expect(dataSQL).toMatch(/LIMIT\s+\$\d+/i);
      expect(dataSQL).toMatch(/OFFSET\s+\$\d+/i);
      expect(dataParams).toContain(25);
      expect(dataParams).toContain(10);
    });
  });

  // ── Edge: empty results ──────────────────────────────────────────────

  it('returns empty rows when no movements match', async () => {
    const client = makeMockClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getLocalAuditEntries(prisma, {
      module: 'INVENTORY',
      fromDate: '2020-01-01',
      toDate: '2020-01-02',
    }, client as any);

    expect(result.total).toBe(0);
    expect(result.rows).toHaveLength(0);
  });
});
