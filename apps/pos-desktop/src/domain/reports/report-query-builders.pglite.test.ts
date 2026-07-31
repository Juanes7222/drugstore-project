/**
 * PGlite integration test for the daily sales summary query builder.
 *
 * Executes `buildSalesDailySummaryQuery` against a real in-memory PGlite
 * seeded with confirmed and annulled sales.  Catches schema mismatches
 * (missing columns, type coercion) that SQL-shape assertions cannot, and
 * proves the correlated `"SaleItem"` subquery sums commissions without
 * inflating the Sale-level aggregates.
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { LOCAL_SCHEMA_SQL } from '@pharmacy/database/local-schema';
import { buildSalesDailySummaryQuery } from './report-query-builders';
import { ReportDatePreset } from './report-types';
import type { DateRangeFilter } from './report-types';

const DAY = '2026-07-15';

interface Seeds {
  productId: string;
  cashShiftId: string;
  userId: string;
  workstationId: string;
}

const rangeFor = (day: string): DateRangeFilter => ({
  preset: ReportDatePreset.CUSTOM,
  dateFrom: day,
  dateTo: day,
  comparePrevious: false,
});

async function seedBase(pg: PGlite): Promise<Seeds> {
  const productId = crypto.randomUUID();
  const cashShiftId = crypto.randomUUID();
  const userId = 'user-cashier-01';
  const workstationId = 'ws-001';
  const now = new Date().toISOString();

  await pg.exec(`
    INSERT INTO "Product" (id, "internalCode", "commercialName", "laboratory", "saleType", "isActive", "createdById", "createdAt", "updatedAt")
    VALUES ('${productId}', 'P001', 'Acetaminofén 500mg', 'Laboratorio Genérico', 'FREE_SALE', true, '${userId}', '${now}', '${now}');
  `);

  await pg.exec(`
    INSERT INTO "CashShift" (id, "userId", "workstationId", "state", "openedAt", "createdAt", "updatedAt")
    VALUES ('${cashShiftId}', '${userId}', '${workstationId}', 'OPEN', '${now}', '${now}', '${now}');
  `);

  return { productId, cashShiftId, userId, workstationId };
}

async function insertSale(
  pg: PGlite,
  seeds: Seeds,
  sale: {
    localNumber: number;
    operationalState: 'CONFIRMED' | 'ANNULLED';
    confirmedAt: string;
    annulledAt?: string;
    commissions: string[];
  },
): Promise<void> {
  const saleId = crypto.randomUUID();
  const annulledAt = sale.annulledAt ? `'${sale.annulledAt}'` : 'NULL';

  await pg.exec(`
    INSERT INTO "Sale" (id, "localNumber", "operationalState", "startedAt", "confirmedAt",
      "annulledAt", "lastModifiedAt", "cashShiftId", "workstationId", "sourceWorkstationId",
      "userId", "subtotal", "totalTax", "totalAmount")
    VALUES ('${saleId}', ${sale.localNumber}, '${sale.operationalState}',
      '${sale.confirmedAt}', '${sale.confirmedAt}', ${annulledAt},
      '${sale.confirmedAt}', '${seeds.cashShiftId}', '${seeds.workstationId}',
      '${seeds.workstationId}', '${seeds.userId}', 1000.00, 190.00, 1190.00);
  `);

  for (const commission of sale.commissions) {
    await pg.exec(`
      INSERT INTO "SaleItem" (id, "saleId", "productId",
        "productInternalCodeSnapshot", "productCommercialNameSnapshot",
        "quantity", "unitPrice", "taxRate", "taxAmount", "subtotal", "total",
        "commissionAmount")
      VALUES ('${crypto.randomUUID()}', '${saleId}', '${seeds.productId}',
        'P001', 'Acetaminofén 500mg',
        1, 1000.00, 19, 190.00, 1000.00, 1190.00, ${commission});
    `);
  }
}

describe('buildSalesDailySummaryQuery (PGlite)', () => {
  let pg: PGlite;
  let seeds: Seeds;

  beforeEach(async () => {
    pg = new PGlite('memory://');
    await pg.exec(LOCAL_SCHEMA_SQL);
    seeds = await seedBase(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('sums commissionAmount across confirmed sale items and excludes annulled sales', async () => {
    await insertSale(pg, seeds, {
      localNumber: 1,
      operationalState: 'CONFIRMED',
      confirmedAt: `${DAY}T10:00:00.000Z`,
      commissions: ['100.00', '250.50'],
    });
    await insertSale(pg, seeds, {
      localNumber: 2,
      operationalState: 'ANNULLED',
      confirmedAt: `${DAY}T11:00:00.000Z`,
      annulledAt: `${DAY}T12:00:00.000Z`,
      commissions: ['999.00'],
    });

    const fragment = buildSalesDailySummaryQuery(
      rangeFor(DAY),
      {},
      { limit: 100, offset: 0 },
    );
    const result = await pg.query(fragment.sql, fragment.params);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      total_commission: '350.50',
      transaction_count: 1,
      annulled: 1,
    });
  });
});
