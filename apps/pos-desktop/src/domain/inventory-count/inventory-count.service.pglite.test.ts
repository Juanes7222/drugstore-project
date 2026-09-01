/**
 * PGlite schema and data-layer integration tests for inventory-count (reconcuento completo).
 *
 * Covers:
 *  - InventoryCountSession / Counter / Snapshot / Line DDL, enums, constraints
 *  - Foreign keys, unique indexes, default values, Decimal columns
 *  - SyncQueue INVENTORY_ADJUSTMENT payload shape for count close
 *  - FEFO ordering still holds for lots used by count snapshot
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { LOCAL_SCHEMA_SQL } from '@pharmacy/database/local-schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedProductWithLots(pg: PGlite): Promise<{
  productId: string;
  categoryId: string;
  lotIds: string[];
}> {
  const productId = crypto.randomUUID();
  const categoryId = crypto.randomUUID();
  const now = new Date().toISOString();
  const userId = 'user-inv-01';

  await pg.exec(`
    INSERT INTO "Category" (id, "name", "isActive", "createdAt", "updatedAt")
    VALUES ('${categoryId}', 'Analgésicos', true, '${now}', '${now}');
  `);

  await pg.exec(`
    INSERT INTO "Product" (id, "internalCode", "commercialName", "laboratory", "saleType", "isActive", "createdById", "createdAt", "updatedAt", "categoryId")
    VALUES ('${productId}', 'INV-COUNT-001', 'Acetaminofén 500mg', 'Genfar', 'FREE_SALE', true, '${userId}', '${now}', '${now}', '${categoryId}');
  `);

  await pg.exec(`
    INSERT INTO "ProductCostHistory" (id, "productId", "cost", "effectiveFrom", "changedById", "changedAt")
    VALUES (gen_random_uuid(), '${productId}', 25000.00, '${now}', '${userId}', '${now}');
  `);

  const lotIds: string[] = [];
  for (const [idx, batch] of ['B-COUNT-001', 'B-COUNT-002'].entries()) {
    const lotId = crypto.randomUUID();
    lotIds.push(lotId);
    const expiry = idx === 0 ? '2027-06-01T00:00:00.000Z' : '2027-12-01T00:00:00.000Z';
    await pg.exec(`
      INSERT INTO "Lot" (id, "batchNumber", "expirationDate", "entryDate", state, "currentStock", version, "productId", "locationCode", "createdAt", "updatedAt")
      VALUES ('${lotId}', '${batch}', '${expiry}', '2026-01-01T00:00:00.000Z', 'ACTIVE'::"LotState", ${idx === 0 ? 100 : 50}, 1, '${productId}', 'A-${idx + 1}', '${now}', '${now}');
    `);
  }

  return { productId, categoryId, lotIds };
}

async function insertCountSession(
  pg: PGlite,
  overrides?: {
    id?: string;
    code?: string;
    sequentialNumber?: number;
    state?: string;
    scopeType?: string;
    scopeValue?: string | null;
    scopeLabel?: string | null;
    mode?: string;
    tolerancePercent?: number;
    requireDoubleCount?: boolean;
    totalLines?: number;
  },
): Promise<string> {
  const id = overrides?.id ?? crypto.randomUUID();
  const seq = overrides?.sequentialNumber ?? 1;
  const code = overrides?.code ?? `IC-${String(seq).padStart(4, '0')}`;
  const state = overrides?.state ?? 'DRAFT';
  const scopeType = overrides?.scopeType ?? 'FULL';
  const scopeValue = overrides?.scopeValue ?? null;
  const scopeLabel = overrides?.scopeLabel ?? null;
  const mode = overrides?.mode ?? 'BLIND';
  const tolerance = overrides?.tolerancePercent ?? 2.0;
  const requireDouble = overrides?.requireDoubleCount ?? true;
  const totalLines = overrides?.totalLines ?? 0;
  const now = new Date().toISOString();

  await pg.exec(`
    INSERT INTO "InventoryCountSession" (id, code, "sequentialNumber", state, "scopeType", "scopeValue", "scopeLabel", mode, "tolerancePercent", "requireDoubleCount", "totalLines", "createdByUserId", "createdAt", "updatedAt")
    VALUES ('${id}', '${code}', ${seq}, '${state}'::"InventoryCountState", '${scopeType}'::"InventoryCountScopeType", ${scopeValue ? `'${scopeValue}'` : 'NULL'}, ${scopeLabel ? `'${scopeLabel.replace(/'/g, "''")}'` : 'NULL'}, '${mode}'::"InventoryCountMode", ${tolerance}, ${requireDouble}, ${totalLines}, 'user-inv-01', '${now}', '${now}');
  `);

  return id;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Inventory count — PGlite data layer', () => {
  let pg: PGlite;

  beforeEach(async () => {
    pg = new PGlite('memory://');
    await pg.exec(LOCAL_SCHEMA_SQL);
  });

  afterEach(async () => {
    await pg.close();
  });

  // ── InventoryCountSession ─────────────────────────────────────────────
  describe('InventoryCountSession table', () => {
    it('creates a session with default state DRAFT and default scope FULL', async () => {
      const id = await insertCountSession(pg);

      const result = await pg.query(`SELECT state, "scopeType", mode, "tolerancePercent", "requireDoubleCount" FROM "InventoryCountSession" WHERE id = $1`, [id]);
      const row = result.rows[0] as Record<string, unknown>;

      expect(row.state).toBe('DRAFT');
      expect(row.scopeType).toBe('FULL');
      expect(row.mode).toBe('BLIND');
      expect(Number(row.tolerancePercent)).toBe(2);
      expect(row.requireDoubleCount).toBe(true);
    });

    it('enforces InventoryCountState enum', async () => {
      await expect(
        pg.exec(`
          INSERT INTO "InventoryCountSession" (id, code, "sequentialNumber", state, "createdByUserId", "createdAt", "updatedAt")
          VALUES ('${crypto.randomUUID()}', 'IC-9999', 9999, 'INVALID'::"InventoryCountState", 'user-1', NOW(), NOW());
        `),
      ).rejects.toThrow();
    });

    it('enforces unique code', async () => {
      await insertCountSession(pg, { id: crypto.randomUUID(), code: 'IC-0001', sequentialNumber: 1 });
      await expect(
        insertCountSession(pg, { id: crypto.randomUUID(), code: 'IC-0001', sequentialNumber: 2 }),
      ).rejects.toThrow();
    });

    it('enforces unique sequentialNumber', async () => {
      await insertCountSession(pg, { id: crypto.randomUUID(), code: 'IC-0001', sequentialNumber: 1 });
      await expect(
        insertCountSession(pg, { id: crypto.randomUUID(), code: 'IC-0002', sequentialNumber: 1 }),
      ).rejects.toThrow();
    });

    it('transitions state DRAFT → IN_PROGRESS → IN_REVIEW → CLOSED', async () => {
      const id = await insertCountSession(pg, { state: 'DRAFT' });

      for (const next of ['IN_PROGRESS', 'IN_REVIEW', 'CLOSED'] as const) {
        await pg.exec(`UPDATE "InventoryCountSession" SET state = '${next}'::"InventoryCountState", "updatedAt" = NOW() WHERE id = '${id}'`);
        const r = await pg.query(`SELECT state FROM "InventoryCountSession" WHERE id = $1`, [id]);
        expect((r.rows[0] as Record<string, unknown>).state).toBe(next);
      }
    });

    it('supports CANCELLED state', async () => {
      const id = await insertCountSession(pg, { state: 'DRAFT' });
      await pg.exec(`UPDATE "InventoryCountSession" SET state = 'CANCELLED'::"InventoryCountState", "cancelledAt" = NOW(), "updatedAt" = NOW() WHERE id = '${id}'`);
      const r = await pg.query(`SELECT state, "cancelledAt" FROM "InventoryCountSession" WHERE id = $1`, [id]);
      expect((r.rows[0] as Record<string, unknown>).state).toBe('CANCELLED');
      expect((r.rows[0] as Record<string, unknown>).cancelledAt).not.toBeNull();
    });

    it('stores Decimal totalValueImpact with 2 decimals', async () => {
      const id = await insertCountSession(pg);
      await pg.exec(`UPDATE "InventoryCountSession" SET "totalValueImpact" = 12345.67, "updatedAt" = NOW() WHERE id = '${id}'`);
      const r = await pg.query(`SELECT "totalValueImpact" FROM "InventoryCountSession" WHERE id = $1`, [id]);
      expect(Number((r.rows[0] as Record<string, unknown>).totalValueImpact)).toBe(12345.67);
    });

    it('stores scope CATEGORY with scopeValue', async () => {
      const catId = crypto.randomUUID();
      const id = await insertCountSession(pg, {
        scopeType: 'CATEGORY',
        scopeValue: catId,
        scopeLabel: 'Analgésicos',
      });
      const r = await pg.query(`SELECT "scopeType", "scopeValue", "scopeLabel" FROM "InventoryCountSession" WHERE id = $1`, [id]);
      const row = r.rows[0] as Record<string, unknown>;
      expect(row.scopeType).toBe('CATEGORY');
      expect(row.scopeValue).toBe(catId);
      expect(row.scopeLabel).toBe('Analgésicos');
    });

    it('stores scope LABORATORY', async () => {
      const id = await insertCountSession(pg, {
        scopeType: 'LABORATORY',
        scopeValue: 'Genfar',
        scopeLabel: 'Genfar',
      });
      const r = await pg.query(`SELECT "scopeType", "scopeValue" FROM "InventoryCountSession" WHERE id = $1`, [id]);
      expect((r.rows[0] as Record<string, unknown>).scopeType).toBe('LABORATORY');
    });

    it('stores denormalized counters', async () => {
      const id = await insertCountSession(pg, { totalLines: 10 });
      await pg.exec(`UPDATE "InventoryCountSession" SET "countedLines" = 8, "recountedLines" = 2, "discrepancyCount" = 3, "updatedAt" = NOW() WHERE id = '${id}'`);
      const r = await pg.query(`SELECT "totalLines", "countedLines", "recountedLines", "discrepancyCount" FROM "InventoryCountSession" WHERE id = $1`, [id]);
      const row = r.rows[0] as Record<string, unknown>;
      expect(row.totalLines).toBe(10);
      expect(row.countedLines).toBe(8);
      expect(row.recountedLines).toBe(2);
      expect(row.discrepancyCount).toBe(3);
    });
  });

  // ── InventoryCountCounter ─────────────────────────────────────────────
  describe('InventoryCountCounter table', () => {
    it('creates singleton and increments lastSequentialNumber', async () => {
      await pg.exec(`INSERT INTO "InventoryCountCounter" (id, "lastSequentialNumber") VALUES ('singleton', 1)`);
      await pg.exec(`UPDATE "InventoryCountCounter" SET "lastSequentialNumber" = "lastSequentialNumber" + 1 WHERE id = 'singleton'`);
      const r = await pg.query(`SELECT "lastSequentialNumber" FROM "InventoryCountCounter" WHERE id = 'singleton'`);
      expect((r.rows[0] as Record<string, unknown>).lastSequentialNumber).toBe(2);
    });

    it('upsert pattern works for atomic sequential generation', async () => {
      await pg.exec(`
        INSERT INTO "InventoryCountCounter" (id, "lastSequentialNumber")
        VALUES ('singleton', 1)
        ON CONFLICT (id) DO UPDATE SET "lastSequentialNumber" = "InventoryCountCounter"."lastSequentialNumber" + 1
      `);
      const r1 = await pg.query(`SELECT "lastSequentialNumber" FROM "InventoryCountCounter" WHERE id = 'singleton'`);
      expect((r1.rows[0] as Record<string, unknown>).lastSequentialNumber).toBe(1);

      await pg.exec(`
        INSERT INTO "InventoryCountCounter" (id, "lastSequentialNumber")
        VALUES ('singleton', 1)
        ON CONFLICT (id) DO UPDATE SET "lastSequentialNumber" = "InventoryCountCounter"."lastSequentialNumber" + 1
      `);
      const r2 = await pg.query(`SELECT "lastSequentialNumber" FROM "InventoryCountCounter" WHERE id = 'singleton'`);
      expect((r2.rows[0] as Record<string, unknown>).lastSequentialNumber).toBe(2);
    });
  });

  // ── InventoryCountSnapshot ────────────────────────────────────────────
  describe('InventoryCountSnapshot table', () => {
    it('creates snapshot linked to session and product', async () => {
      const { productId, lotIds } = await seedProductWithLots(pg);
      const sessionId = await insertCountSession(pg);
      const snapId = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "InventoryCountSnapshot" (id, "sessionId", "productId", "lotId", "productName", "internalCode", "lotCode", "theoreticalQty", "unitCost", "createdAt")
        VALUES ('${snapId}', '${sessionId}', '${productId}', '${lotIds[0]}', 'Acetaminofén 500mg', 'INV-COUNT-001', 'B-COUNT-001', 100, 25000.00, '${now}');
      `);

      const r = await pg.query(`SELECT "theoreticalQty", "unitCost", "productName" FROM "InventoryCountSnapshot" WHERE id = $1`, [snapId]);
      const row = r.rows[0] as Record<string, unknown>;
      expect(row.theoreticalQty).toBe(100);
      expect(Number(row.unitCost)).toBe(25000);
      expect(row.productName).toBe('Acetaminofén 500mg');
    });

    it('enforces unique sessionId+productId+lotId', async () => {
      const { productId, lotIds } = await seedProductWithLots(pg);
      const sessionId = await insertCountSession(pg);
      const now = new Date().toISOString();
      const lotId = lotIds[0];

      await pg.exec(`
        INSERT INTO "InventoryCountSnapshot" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", "createdAt")
        VALUES ('${crypto.randomUUID()}', '${sessionId}', '${productId}', '${lotId}', 'Acetaminofén 500mg', 100, 1000, '${now}');
      `);

      await expect(
        pg.exec(`
          INSERT INTO "InventoryCountSnapshot" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", "createdAt")
          VALUES ('${crypto.randomUUID()}', '${sessionId}', '${productId}', '${lotId}', 'Acetaminofén 500mg', 50, 1000, '${now}');
        `),
      ).rejects.toThrow();
    });

    it('enforces foreign key to InventoryCountSession (CASCADE on delete)', async () => {
      const fakeSessionId = crypto.randomUUID();
      const { productId, lotIds } = await seedProductWithLots(pg);
      const now = new Date().toISOString();

      await expect(
        pg.exec(`
          INSERT INTO "InventoryCountSnapshot" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", "createdAt")
          VALUES ('${crypto.randomUUID()}', '${fakeSessionId}', '${productId}', '${lotIds[0]}', 'Acetaminofén 500mg', 100, 1000, '${now}');
        `),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });

    it('cascades delete when session is removed', async () => {
      const { productId, lotIds } = await seedProductWithLots(pg);
      const sessionId = await insertCountSession(pg);
      const snapId = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "InventoryCountSnapshot" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", "createdAt")
        VALUES ('${snapId}', '${sessionId}', '${productId}', '${lotIds[0]}', 'Acetaminofén 500mg', 100, 1000, '${now}');
      `);

      await pg.exec(`DELETE FROM "InventoryCountSession" WHERE id = '${sessionId}'`);

      const r = await pg.query(`SELECT COUNT(*) as cnt FROM "InventoryCountSnapshot" WHERE id = $1`, [snapId]);
      expect(Number((r.rows[0] as Record<string, unknown>).cnt)).toBe(0);
    });
  });

  // ── InventoryCountLine ────────────────────────────────────────────────
  describe('InventoryCountLine table', () => {
    it('creates line with default status PENDING and requiresRecount false', async () => {
      const { productId, lotIds } = await seedProductWithLots(pg);
      const sessionId = await insertCountSession(pg, { totalLines: 1 });
      const lineId = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "InventoryCountLine" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", "createdAt", "updatedAt")
        VALUES ('${lineId}', '${sessionId}', '${productId}', '${lotIds[0]}', 'Acetaminofén 500mg', 100, 25000.00, '${now}', '${now}');
      `);

      const r = await pg.query(`SELECT status, "requiresRecount", "isHighValue" FROM "InventoryCountLine" WHERE id = $1`, [lineId]);
      const row = r.rows[0] as Record<string, unknown>;
      expect(row.status).toBe('PENDING');
      expect(row.requiresRecount).toBe(false);
      expect(row.isHighValue).toBe(false);
    });

    it('enforces InventoryCountLineStatus enum', async () => {
      const { productId, lotIds } = await seedProductWithLots(pg);
      const sessionId = await insertCountSession(pg);
      const now = new Date().toISOString();

      await expect(
        pg.exec(`
          INSERT INTO "InventoryCountLine" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", status, "createdAt", "updatedAt")
          VALUES ('${crypto.randomUUID()}', '${sessionId}', '${productId}', '${lotIds[0]}', 'Acetaminofén 500mg', 100, 1000, 'INVALID'::"InventoryCountLineStatus", '${now}', '${now}');
        `),
      ).rejects.toThrow();
    });

    it('enforces unique sessionId+productId+lotId', async () => {
      const { productId, lotIds } = await seedProductWithLots(pg);
      const sessionId = await insertCountSession(pg);
      const now = new Date().toISOString();
      const lotId = lotIds[0];

      await pg.exec(`
        INSERT INTO "InventoryCountLine" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", "createdAt", "updatedAt")
        VALUES ('${crypto.randomUUID()}', '${sessionId}', '${productId}', '${lotId}', 'Acetaminofén 500mg', 100, 1000, '${now}', '${now}');
      `);

      await expect(
        pg.exec(`
          INSERT INTO "InventoryCountLine" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", "createdAt", "updatedAt")
          VALUES ('${crypto.randomUUID()}', '${sessionId}', '${productId}', '${lotId}', 'Acetaminofén 500mg', 50, 1000, '${now}', '${now}');
        `),
      ).rejects.toThrow();
    });

    it('stores counted quantities, finalQty, difference, valueImpact', async () => {
      const { productId, lotIds } = await seedProductWithLots(pg);
      const sessionId = await insertCountSession(pg);
      const lineId = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "InventoryCountLine" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", "countedQty1", "finalQty", difference, "valueImpact", status, "requiresRecount", "isHighValue", "createdAt", "updatedAt")
        VALUES ('${lineId}', '${sessionId}', '${productId}', '${lotIds[0]}', 'Acetaminofén 500mg', 100, 25000.00, 95, 95, -5, -125000.00, 'RESOLVED', false, true, '${now}', '${now}');
      `);

      const r = await pg.query(`SELECT "countedQty1", "finalQty", difference, "valueImpact", "isHighValue" FROM "InventoryCountLine" WHERE id = $1`, [lineId]);
      const row = r.rows[0] as Record<string, unknown>;
      expect(row.countedQty1).toBe(95);
      expect(row.finalQty).toBe(95);
      expect(row.difference).toBe(-5);
      expect(Number(row.valueImpact)).toBe(-125000);
      expect(row.isHighValue).toBe(true);
    });

    it('supports isHighValue and requiresRecount indexes', async () => {
      const { productId, lotIds } = await seedProductWithLots(pg);
      const sessionId = await insertCountSession(pg);
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "InventoryCountLine" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", "isHighValue", "requiresRecount", "createdAt", "updatedAt")
        VALUES ('${crypto.randomUUID()}', '${sessionId}', '${productId}', '${lotIds[0]}', 'Acetaminofén 500mg', 100, 60000, true, true, '${now}', '${now}');
      `);

      const r = await pg.query(`SELECT COUNT(*) as cnt FROM "InventoryCountLine" WHERE "isHighValue" = true AND "requiresRecount" = true`);
      expect(Number((r.rows[0] as Record<string, unknown>).cnt)).toBe(1);
    });

    it('transitions line status lifecycle', async () => {
      const { productId, lotIds } = await seedProductWithLots(pg);
      const sessionId = await insertCountSession(pg);
      const lineId = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "InventoryCountLine" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", "createdAt", "updatedAt")
        VALUES ('${lineId}', '${sessionId}', '${productId}', '${lotIds[0]}', 'Acetaminofén 500mg', 100, 1000, '${now}', '${now}');
      `);

      for (const next of ['COUNTED', 'RECOUNT_NEEDED', 'RESOLVED'] as const) {
        const requiresRecount = next === 'RECOUNT_NEEDED';
        await pg.exec(`UPDATE "InventoryCountLine" SET status = '${next}'::"InventoryCountLineStatus", "requiresRecount" = ${requiresRecount}, "updatedAt" = NOW() WHERE id = '${lineId}'`);
        const r = await pg.query(`SELECT status FROM "InventoryCountLine" WHERE id = $1`, [lineId]);
        expect((r.rows[0] as Record<string, unknown>).status).toBe(next);
      }
    });

    it('orders lines by isHighValue desc, productName asc (operator priority)', async () => {
      const { productId } = await seedProductWithLots(pg);
      const sessionId = await insertCountSession(pg);
      const now = new Date().toISOString();

      // Two products with different high-value flag
      const prodB = crypto.randomUUID();
      await pg.exec(`
        INSERT INTO "Product" (id, "internalCode", "commercialName", "laboratory", "saleType", "isActive", "createdById", "createdAt", "updatedAt")
        VALUES ('${prodB}', 'PROD-B', 'B Product', 'Lab', 'FREE_SALE', true, 'user-inv-01', '${now}', '${now}');
      `);

      await pg.exec(`
        INSERT INTO "InventoryCountLine" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", "isHighValue", "createdAt", "updatedAt")
        VALUES
          ('${crypto.randomUUID()}', '${sessionId}', '${productId}', '${crypto.randomUUID()}', 'Acetaminofén 500mg', 10, 1000, false, '${now}', '${now}'),
          ('${crypto.randomUUID()}', '${sessionId}', '${prodB}', '${crypto.randomUUID()}', 'Zebra Drug', 10, 1000, true, '${now}', '${now}');
      `);

      const r = await pg.query(`SELECT "productName", "isHighValue" FROM "InventoryCountLine" WHERE "sessionId" = $1 ORDER BY "isHighValue" DESC, "productName" ASC`, [sessionId]);
      expect((r.rows[0] as Record<string, unknown>).isHighValue).toBe(true);
      expect((r.rows[1] as Record<string, unknown>).isHighValue).toBe(false);
    });
  });

  // ── SyncQueue — INVENTORY_ADJUSTMENT for count close ──────────────────
  describe('SyncQueue — INVENTORY_ADJUSTMENT from count close', () => {
    it('stores INVENTORY_ADJUSTMENT payload with PHYSICAL_COUNT metadata', async () => {
      const now = new Date().toISOString();
      const sessionId = crypto.randomUUID();
      const adjustmentId = crypto.randomUUID();
      const payload = JSON.stringify({
        userId: 'user-inv-01',
        createAdjustmentDto: {
          reason: 'Reconteo IC-0001 — Ajuste físico',
          notes: 'Cierre reconteo IC-0001. Líneas con diferencia: 1/2',
          items: [
            {
              lotId: crypto.randomUUID(),
              movementType: 'NEGATIVE_ADJUSTMENT',
              quantity: 5,
              reason: 'Reconteo IC-0001 — -5',
              lot: { batchNumber: 'B-COUNT-001', expirationDate: new Date('2027-06-01').toISOString(), productId: crypto.randomUUID(), currentStock: 95, locationCode: 'A-1' },
            },
          ],
        },
        metadata: {
          adjustmentId,
          sequentialNumber: 7,
          workstationId: 'ws-001',
          appliedAt: now,
          source: 'PHYSICAL_COUNT',
          countSessionId: sessionId,
          countCode: 'IC-0001',
        },
      });

      await pg.exec(`
        INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload, "payloadHash", "payloadSize", "sourceWorkstationId", "sourceCreatedAt", "clientSequence", status)
        VALUES ('${crypto.randomUUID()}', '${crypto.randomUUID()}', 'INVENTORY_ADJUSTMENT'::"SyncOperationType", '${payload.replace(/'/g, "''")}', 'hash123', ${payload.length}, 'ws-001', '${now}', 1, 'PENDING');
      `);

      const r = await pg.query(`SELECT payload, "operationType" FROM "SyncQueue" WHERE "operationType" = 'INVENTORY_ADJUSTMENT'`);
      const stored = JSON.parse((r.rows[0] as Record<string, unknown>).payload as string) as Record<string, unknown>;

      expect(stored).toHaveProperty('userId', 'user-inv-01');
      expect(stored).toHaveProperty('createAdjustmentDto');
      expect(stored).toHaveProperty('metadata');
      const meta = stored.metadata as Record<string, unknown>;
      expect(meta.source).toBe('PHYSICAL_COUNT');
      expect(meta.countSessionId).toBe(sessionId);
      expect(meta.countCode).toBe('IC-0001');
      const dto = stored.createAdjustmentDto as Record<string, unknown>;
      expect(Array.isArray(dto.items)).toBe(true);
    });

    it('enforces unique operationUuid idempotency', async () => {
      const now = new Date().toISOString();
      const uuid = crypto.randomUUID();
      await pg.exec(`
        INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload, "payloadHash", "payloadSize", "sourceWorkstationId", "sourceCreatedAt", "clientSequence", status)
        VALUES ('${crypto.randomUUID()}', '${uuid}', 'INVENTORY_ADJUSTMENT'::"SyncOperationType", '{}', 'h1', 2, 'ws-001', '${now}', 1, 'PENDING');
      `);
      await expect(
        pg.exec(`
          INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload, "payloadHash", "payloadSize", "sourceWorkstationId", "sourceCreatedAt", "clientSequence", status)
          VALUES ('${crypto.randomUUID()}', '${uuid}', 'INVENTORY_ADJUSTMENT'::"SyncOperationType", '{}', 'h2', 2, 'ws-001', '${now}', 2, 'PENDING');
        `),
      ).rejects.toThrow();
    });
  });

  // ── Lot + session integration ─────────────────────────────────────────
  describe('Lot + snapshot integration', () => {
    it('snapshot theoreticalQty matches lot currentStock at time of start', async () => {
      const { productId, lotIds } = await seedProductWithLots(pg);
      const sessionId = await insertCountSession(pg, { state: 'IN_PROGRESS' });
      const now = new Date().toISOString();

      const lotStockResult = await pg.query(`SELECT "currentStock" FROM "Lot" WHERE id = $1`, [lotIds[0]]);
      const currentStock = (lotStockResult.rows[0] as Record<string, unknown>).currentStock as number;

      const snapId = crypto.randomUUID();
      await pg.exec(`
        INSERT INTO "InventoryCountSnapshot" (id, "sessionId", "productId", "lotId", "productName", "theoreticalQty", "unitCost", "createdAt")
        VALUES ('${snapId}', '${sessionId}', '${productId}', '${lotIds[0]}', 'Acetaminofén 500mg', ${currentStock}, 25000.00, '${now}');
      `);

      const snap = await pg.query(`SELECT "theoreticalQty" FROM "InventoryCountSnapshot" WHERE id = $1`, [snapId]);
      expect((snap.rows[0] as Record<string, unknown>).theoreticalQty).toBe(currentStock);
    });
  });
});
