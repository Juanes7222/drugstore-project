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
import {
  buildCashShiftCloseQuery,
  buildCountQuery,
  buildSalesDailySummaryQuery,
} from './report-query-builders';
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

describe('buildCashShiftCloseQuery (PGlite)', () => {
  const SHIFT_ID = 'shift-0001';
  let pg: PGlite;

  beforeEach(async () => {
    pg = new PGlite('memory://');
    await pg.exec(LOCAL_SCHEMA_SQL);

    const now = new Date().toISOString();
    const userId = 'user-cashier-01';
    const workstationId = 'ws-001';

    await pg.exec(`
      INSERT INTO "CashShift" (id, "workstationId", "userId", "state", "openedAt", "createdAt", "updatedAt")
      VALUES ('${SHIFT_ID}', '${workstationId}', '${userId}', 'CLOSED', '${now}', '${now}', '${now}');
    `);

    for (const [id, code, name, category, isCash] of [
      ['pm-cash', 'CASH-01', 'Efectivo', 'CASH', 'true'],
      ['pm-card', 'CARD-01', 'Tarjeta', 'DEBIT_CARD', 'false'],
    ] as const) {
      await pg.exec(`
        INSERT INTO "PaymentMethod" (id, "internalCode", "name", "category", "isCash", "createdAt", "updatedAt")
        VALUES ('${id}', '${code}', '${name}', '${category}', ${isCash}, '${now}', '${now}');
      `);
      await pg.exec(`
        INSERT INTO "ShiftCashCount" (id, "cashShiftId", "countType", "paymentMethodId",
          "paymentMethodIsCash", "expectedAmount", "declaredAmount", "difference", "createdById")
        VALUES ('scc-${id}', '${SHIFT_ID}', 'CLOSING', '${id}',
          ${isCash}, 1000.00, 1000.00, 0.00, '${userId}');
      `);
    }
  });

  afterEach(async () => {
    await pg.close();
  });

  it('returns one CLOSING count row per payment method and a matching total', async () => {
    const fragment = buildCashShiftCloseQuery(SHIFT_ID);
    const countFragment = buildCountQuery(fragment, 'COUNT(*)', fragment.params);

    const result = await pg.query(fragment.sql, fragment.params);
    const countResult = await pg.query(countFragment.sql, countFragment.params);
    const rows = result.rows as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.payment_method_name).sort()).toEqual(['Efectivo', 'Tarjeta']);
    expect(Number((countResult.rows[0] as Record<string, unknown>).total)).toBe(2);
  });

  it('returns zero rows and a zero total for an unknown shift id', async () => {
    const fragment = buildCashShiftCloseQuery('shift-unknown');
    const countFragment = buildCountQuery(fragment, 'COUNT(*)', fragment.params);

    const result = await pg.query(fragment.sql, fragment.params);
    const countResult = await pg.query(countFragment.sql, countFragment.params);

    expect(result.rows).toHaveLength(0);
    expect(Number((countResult.rows[0] as Record<string, unknown>).total)).toBe(0);
  });
});
