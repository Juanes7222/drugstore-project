// E2E verification of every raw-SQL report in ReportsService against a real
// PostgreSQL 16 instance. The unit specs mock $queryRaw, so this is the only
// place where syntax errors, wrong column names, or numeric mapping issues
// (Decimal/BigInt) can surface before production.
//
// Infrastructure: a throwaway postgres:16-alpine container is started with
// @testcontainers/postgresql, migrations from packages/database/prisma/
// migrations are applied with `prisma migrate deploy --config
// packages/database/prisma.full.config.ts`, and a real PrismaService is
// constructed against the container URL.
//
// RLS note: all tenant tables are FORCE ROW LEVEL SECURITY keyed on
// app.current_tenant. The container's login user is a superuser, which
// bypasses RLS entirely, so both seeding and the report queries observe all
// rows without setting app.current_tenant.
//
// Seeding is done with parameterized $executeRaw INSERTs instead of model
// delegates so the spec does not depend on which schema variant the jest
// runtime client was generated from; timestamp literals are written without
// a zone so comparisons are deterministic regardless of machine timezone
// (process.env.TZ is also pinned to UTC below).
//
// Fixture isolation: each report reads its own time window on disjoint
// tables/columns, so fixtures for one report never pollute another:
//   - getSalesSummary      CONFIRMED sales by confirmedAt   (Aug 2026)
//   - getCashShiftSummary  CLOSED shifts by closedAt        (Jul 2026)
//   - getInventoryValuation lots as of dateFrom             (Jun 2026)
//   - getTaxSummary        VALIDATED INVOICEs by updatedAt  (Apr 2026)
//   - getFiscalReport      documents by issueDate           (May 2026)
//   - getDailyReport       CONFIRMED sales by confirmedAt   (Sep 2026)

process.env.TZ = 'UTC';

import { execSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@pharmacy/database';
import { PrismaPg } from '@prisma/adapter-pg';
import { ReportsService } from '../src/modules/reports/services/reports.service';
import { ReportInvalidDateRangeException } from '../src/modules/reports/exceptions/report-invalid-date-range.exception';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { TenantContextService } from '../src/modules/tenant/tenant-context.service';

const SUB = 'e2e-rpt-sub';
const USER_ID = 'e2e-rpt-user';
const WORKSTATION_ID = 'e2e-rpt-ws';

// Products used by sales/tax/daily fixtures.
const PRODUCT_A_ID = 'e2e-rpt-product-a'; // FREE_SALE
const PRODUCT_B_ID = 'e2e-rpt-product-b'; // PRESCRIPTION
// Products used exclusively by the inventory valuation fixtures.
const VALUATION_ALPHA_ID = 'e2e-rpt-product-val-alpha';
const VALUATION_BETA_ID = 'e2e-rpt-product-val-beta';

const CASH_PM_ID = 'e2e-rpt-pm-cash';
const DEBIT_PM_ID = 'e2e-rpt-pm-debit';

const SUPPLIER_ID = 'e2e-rpt-supplier';
const RECEPTION_ID = 'e2e-rpt-reception';

const RESOLUTION_ID = 'e2e-rpt-resolution';

function dto(dateFrom: string, dateTo: string): {
  dateFrom: string;
  dateTo: string;
  view: 'fiscal' | 'operational';
} {
  return { dateFrom, dateTo, view: 'operational' };
}

/** Zone-less timestamp literal: stored wall time == intended UTC instant. */
function ts(dateIso: string): string {
  return dateIso.replace(/Z$/, '');
}

describe('ReportsService raw SQL (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let seedClient: PrismaClient;
  let service: ReportsService;
  let prismaService: PrismaService;

  let nextLocalNumber = 1;
  let nextConsecutive = 1;

  beforeAll(async () => {
    // Fresh postgres:16-alpine instance per run.
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const containerUrl = container.getConnectionUri();
    process.env.DATABASE_URL = containerUrl;

    // Jest always executes with cwd = apps/server (rootDir '.' in
    // jest.e2e.config.ts), so both relative paths resolve. The prisma CLI
    // is invoked through its local bin because `pnpm exec` aborts on this
    // workspace's ignored-build-scripts check.
    const serverRoot = process.cwd();
    const prismaBin =
      process.platform === 'win32'
        ? '.\\node_modules\\.bin\\prisma.CMD'
        : './node_modules/.bin/prisma';
    // execSync already runs through the platform shell; DATABASE_URL was
    // exported above, so migrate deploy targets the container.
    execSync(
      `${prismaBin} migrate deploy --config ../../packages/database/prisma.full.config.ts`,
      {
        cwd: serverRoot,
        env: { ...process.env, DATABASE_URL: containerUrl },
        stdio: 'pipe',
      },
    );

    // Plain client for seeding/raw statements: superuser connection bypasses
    // RLS. Only $executeRaw is used, so any schema variant works.
    seedClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: containerUrl }),
    });
    await seedClient.$connect();

    await seedBaseData();

    const moduleRef = await Test.createTestingModule({
      providers: [ReportsService, TenantContextService, PrismaService],
    }).compile();

    prismaService = moduleRef.get(PrismaService);
    await prismaService.onModuleInit();
    service = moduleRef.get(ReportsService);
  }, 240_000);

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await seedClient?.$disconnect();
    await container?.stop();
  });

  // Prisma's @updatedAt maps to a plain NOT NULL timestamp WITHOUT a DDL
  // default, so raw INSERTs must always supply it.
  const REQUIRED_ON_INSERT: Record<string, string[]> = {
    User: ['updatedAt'],
    Workstation: ['updatedAt'],
    Product: ['createdAt', 'updatedAt'],
    PaymentMethod: ['createdAt', 'updatedAt'],
    Supplier: ['createdAt', 'updatedAt'],
    PurchaseReception: ['createdAt', 'updatedAt'],
    FiscalResolution: ['createdAt', 'updatedAt'],
    CashShift: ['updatedAt'],
    Lot: ['updatedAt'],
  };

  /** Parameterized INSERT ($1..$n placeholders, no string interpolation of values). */
  async function insert(table: string, columns: string[], values: unknown[]) {
    const extraColumns = (REQUIRED_ON_INSERT[table] ?? []).filter(
      (c) => !columns.includes(c),
    );
    const allColumns = [...columns, ...extraColumns];
    const allValues = [
      ...values,
      ...extraColumns.map(() => ts('2026-01-01T00:00:00Z')),
    ];
    const columnList = allColumns.map((c) => `"${c}"`).join(', ');
    const placeholders = allValues.map((_, i) => `$${i + 1}`).join(', ');
    await seedClient.$executeRawUnsafe(
      `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`,
      ...allValues,
    );
  }

  async function seedBaseData(): Promise<void> {
    await insert(
      'User',
      ['id', 'fullName', 'role'],
      [USER_ID, 'E2E Reports User', 'ADMIN'],
    );

    await insert(
      'Workstation',
      ['id', 'name', 'code', 'registeredAt'],
      [WORKSTATION_ID, 'E2E Reports Workstation', 'WS-E2E-RPT', ts('2026-01-01T00:00:00Z')],
    );

    await insert(
      'Product',
      ['id', 'subscriptionId', 'internalCode', 'commercialName', 'laboratory', 'saleType', 'createdById'],
      [PRODUCT_A_ID, SUB, 'RPT-A', 'E2E RPT Product A', 'E2E Lab', 'FREE_SALE', USER_ID],
    );
    await insert(
      'Product',
      ['id', 'subscriptionId', 'internalCode', 'commercialName', 'laboratory', 'saleType', 'createdById'],
      [PRODUCT_B_ID, SUB, 'RPT-B', 'E2E RPT Product B', 'E2E Lab', 'PRESCRIPTION', USER_ID],
    );
    await insert(
      'Product',
      ['id', 'subscriptionId', 'internalCode', 'commercialName', 'laboratory', 'saleType', 'createdById'],
      [VALUATION_ALPHA_ID, SUB, 'RPT-VAL-A', 'E2E RPT Val Alpha', 'E2E Lab', 'FREE_SALE', USER_ID],
    );
    await insert(
      'Product',
      ['id', 'subscriptionId', 'internalCode', 'commercialName', 'laboratory', 'saleType', 'createdById'],
      [VALUATION_BETA_ID, SUB, 'RPT-VAL-B', 'E2E RPT Val Beta', 'E2E Lab', 'FREE_SALE', USER_ID],
    );

    await insert(
      'PaymentMethod',
      ['id', 'subscriptionId', 'internalCode', 'name', 'category', 'isCash'],
      [CASH_PM_ID, SUB, 'CASH', 'Efectivo', 'CASH', true],
    );
    await insert(
      'PaymentMethod',
      ['id', 'subscriptionId', 'internalCode', 'name', 'category'],
      [DEBIT_PM_ID, SUB, 'DEBIT', 'Tarjeta Debito', 'DEBIT_CARD'],
    );

    await insert(
      'Supplier',
      ['id', 'subscriptionId', 'identificationType', 'identificationNumber', 'businessName', 'createdById'],
      [SUPPLIER_ID, SUB, 'NIT', '900123456', 'E2E Reports Supplier', USER_ID],
    );

    await insert(
      'PurchaseReception',
      ['id', 'subscriptionId', 'sequentialNumber', 'createdById', 'supplierId'],
      [RECEPTION_ID, SUB, 1, USER_ID, SUPPLIER_ID],
    );

    await insert(
      'FiscalResolution',
      ['id', 'subscriptionId', 'resolutionNumber', 'documentType', 'prefix', 'rangeFrom', 'rangeTo', 'validFrom', 'validTo'],
      [RESOLUTION_ID, SUB, 'RES-RPT-001', 'INVOICE', 'RPT', 1, 999999, ts('2026-01-01T00:00:00Z'), ts('2030-12-31T00:00:00Z')],
    );
  }

  async function seedShift(input: {
    id: string;
    state: 'OPEN' | 'CLOSED';
    openedAt: string;
    closedAt?: string | null;
    expectedClosingAmount: string;
  }): Promise<void> {
    const closedAt = input.closedAt ?? null;
    await insert(
      'CashShift',
      ['id', 'subscriptionId', 'workstationId', 'userId', 'state', 'openedAt', 'closedAt', 'closedByUserId', 'openingBalance', 'expectedClosingAmount', 'actualClosingAmount'],
      [
        input.id,
        SUB,
        WORKSTATION_ID,
        USER_ID,
        input.state,
        ts(input.openedAt),
        closedAt === null ? null : ts(closedAt),
        closedAt === null ? null : USER_ID,
        '100000.00',
        input.expectedClosingAmount,
        closedAt === null ? '0' : input.expectedClosingAmount,
      ],
    );
  }

  async function seedSale(input: {
    id: string;
    cashShiftId: string;
    operationalState: 'IN_PROGRESS' | 'CONFIRMED' | 'ANNULLED';
    confirmedAt: string | null;
    totalTax: string;
    totalAmount: string;
    annulledAt?: string | null;
  }): Promise<void> {
    await insert(
      'Sale',
      ['id', 'subscriptionId', 'localNumber', 'operationalState', 'startedAt', 'confirmedAt', 'annulledAt', 'subtotal', 'totalTax', 'totalAmount', 'lastModifiedAt', 'cashShiftId', 'workstationId', 'userId', 'sourceWorkstationId'],
      [
        input.id,
        SUB,
        String(nextLocalNumber++),
        input.operationalState,
        ts('2026-01-05T12:00:00Z'),
        input.confirmedAt === null ? null : ts(input.confirmedAt),
        input.annulledAt ? ts(input.annulledAt) : null,
        input.totalAmount,
        input.totalTax,
        input.totalAmount,
        ts('2026-01-06T12:00:00Z'),
        input.cashShiftId,
        WORKSTATION_ID,
        USER_ID,
        WORKSTATION_ID,
      ],
    );
  }

  async function seedSaleItem(input: {
    id: string;
    saleId: string;
    productId: string;
    quantity: number;
    unitPrice: string;
    taxRate: string;
    taxAmount: string;
    subtotal: string;
    total: string;
    commissionAmount?: string;
  }): Promise<void> {
    await insert(
      'SaleItem',
      ['id', 'subscriptionId', 'saleId', 'productId', 'productInternalCodeSnapshot', 'productCommercialNameSnapshot', 'quantity', 'unitPrice', 'taxRate', 'taxAmount', 'subtotal', 'total', 'commissionAmount'],
      [
        input.id,
        SUB,
        input.saleId,
        input.productId,
        'SNAP-CODE',
        'SNAP NAME',
        input.quantity,
        input.unitPrice,
        input.taxRate,
        input.taxAmount,
        input.subtotal,
        input.total,
        input.commissionAmount ?? '0',
      ],
    );
  }

  async function seedLot(input: {
    id: string;
    productId: string;
    batchNumber: string;
    expirationDate: string;
    currentStock: number;
    receptionUnitCost?: string;
  }): Promise<void> {
    await insert(
      'Lot',
      ['id', 'subscriptionId', 'batchNumber', 'expirationDate', 'entryDate', 'currentStock', 'productId'],
      [input.id, SUB, input.batchNumber, ts(input.expirationDate), ts('2026-05-01T00:00:00Z'), input.currentStock, input.productId],
    );
    if (input.receptionUnitCost !== undefined) {
      await insert(
        'PurchaseReceptionItem',
        ['id', 'subscriptionId', 'purchaseReceptionId', 'productId', 'lotId', 'receivedQuantity', 'realUnitCost', 'taxSchemeId'],
        [`${input.id}-pri`, SUB, RECEPTION_ID, input.productId, input.id, input.currentStock, input.receptionUnitCost, 'e2e-rpt-tax-scheme-scalar'],
      );
    }
  }

  async function seedPayment(input: {
    id: string;
    saleId: string;
    paymentMethodId: string;
    amount: string;
  }): Promise<void> {
    await insert(
      'SalePayment',
      ['id', 'subscriptionId', 'saleId', 'paymentMethodId', 'amount'],
      [input.id, SUB, input.saleId, input.paymentMethodId, input.amount],
    );
  }

  async function seedFiscalDocument(input: {
    id: string;
    documentType: 'INVOICE' | 'POS_TICKET' | 'CREDIT_NOTE';
    fiscalState: 'PENDING_GENERATION' | 'VALIDATED' | 'REJECTED' | 'ANNULLED';
    issueDate: string;
    updatedAt: string;
    subtotal: string;
    totalTax: string;
    totalAmount: string;
    saleId?: string | null;
  }): Promise<void> {
    await insert(
      'FiscalDocument',
      ['id', 'subscriptionId', 'documentType', 'consecutiveNumber', 'fullNumber', 'issueDate', 'cufeCude', 'fiscalState', 'subtotal', 'totalTax', 'totalAmount', 'issuerNitSnapshot', 'resolutionId', 'saleId', 'createdAt', 'updatedAt'],
      [
        input.id,
        SUB,
        input.documentType,
        nextConsecutive++,
        `RPT-${input.id}`,
        ts(input.issueDate),
        `cufe-${input.id}`,
        input.fiscalState,
        input.subtotal,
        input.totalTax,
        input.totalAmount,
        '900000000',
        RESOLUTION_ID,
        input.saleId ?? null,
        ts(input.updatedAt),
        ts(input.updatedAt),
      ],
    );
  }

  describe('getSalesSummary', () => {
    const AUGUST = dto('2026-08-01T00:00:00Z', '2026-08-31T23:59:59Z');

    beforeAll(async () => {
      await seedShift({
        id: 'e2e-rpt-shift-aug',
        state: 'OPEN',
        openedAt: '2026-08-01T08:00:00Z',
        expectedClosingAmount: '0',
      });

      // CONFIRMED inside range: two products, different quantities.
      await seedSale({
        id: 'e2e-rpt-ss1',
        cashShiftId: 'e2e-rpt-shift-aug',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-08-10T15:30:00Z',
        totalTax: '3800.00',
        totalAmount: '30000.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-ss1-i1',
        saleId: 'e2e-rpt-ss1',
        productId: PRODUCT_A_ID,
        quantity: 2,
        unitPrice: '10000.00',
        taxRate: '0.1900',
        taxAmount: '3800.00',
        subtotal: '20000.00',
        total: '23800.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-ss1-i2',
        saleId: 'e2e-rpt-ss1',
        productId: PRODUCT_B_ID,
        quantity: 1,
        unitPrice: '10000.00',
        taxRate: '0.0000',
        taxAmount: '0.00',
        subtotal: '10000.00',
        total: '10000.00',
      });

      await seedSale({
        id: 'e2e-rpt-ss2',
        cashShiftId: 'e2e-rpt-shift-aug',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-08-20T11:00:00Z',
        totalTax: '2850.00',
        totalAmount: '15000.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-ss2-i1',
        saleId: 'e2e-rpt-ss2',
        productId: PRODUCT_A_ID,
        quantity: 3,
        unitPrice: '5000.00',
        taxRate: '0.1900',
        taxAmount: '2850.00',
        subtotal: '15000.00',
        total: '17850.00',
      });

      // CONFIRMED but outside the range (July).
      await seedSale({
        id: 'e2e-rpt-ss3',
        cashShiftId: 'e2e-rpt-shift-aug',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-07-15T09:00:00Z',
        totalTax: '0.00',
        totalAmount: '99999.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-ss3-i1',
        saleId: 'e2e-rpt-ss3',
        productId: PRODUCT_A_ID,
        quantity: 5,
        unitPrice: '19999.80',
        taxRate: '0.1900',
        taxAmount: '0.00',
        subtotal: '99999.00',
        total: '99999.00',
      });

      // Inside range but IN_PROGRESS (never confirmed).
      await seedSale({
        id: 'e2e-rpt-ss4',
        cashShiftId: 'e2e-rpt-shift-aug',
        operationalState: 'IN_PROGRESS',
        confirmedAt: null,
        totalTax: '0.00',
        totalAmount: '7777.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-ss4-i1',
        saleId: 'e2e-rpt-ss4',
        productId: PRODUCT_A_ID,
        quantity: 1,
        unitPrice: '7777.00',
        taxRate: '0.1900',
        taxAmount: '0.00',
        subtotal: '7777.00',
        total: '7777.00',
      });
    });

    it('aggregates only CONFIRMED sales within the confirmedAt range', async () => {
      const result = await service.getSalesSummary(AUGUST);

      expect(result.totalSales).toBe('45000.00');
      expect(result.totalQuantity).toBe(6);
      expect(typeof result.totalQuantity).toBe('number');
    });

    it('groups the breakdown by each product saleType with count, total and average', async () => {
      const result = await service.getSalesSummary(AUGUST);

      // GROUP BY without ORDER BY: normalize row order before comparing.
      const breakdown = [...result.breakdownBySaleType].sort((a, b) =>
        a.saleType.localeCompare(b.saleType),
      );
      expect(breakdown).toEqual([
        {
          saleType: 'FREE_SALE',
          count: 2,
          totalAmount: '41650.00',
          averageAmount: '20825.00',
        },
        {
          saleType: 'PRESCRIPTION',
          count: 1,
          totalAmount: '10000.00',
          averageAmount: '10000.00',
        },
      ]);
    });

    it('returns zeroed totals when no sales match the window', async () => {
      const result = await service.getSalesSummary(
        dto('2030-01-01T00:00:00Z', '2030-01-31T23:59:59Z'),
      );

      expect(result.totalSales).toBe('0.00');
      expect(result.totalQuantity).toBe(0);
      expect(result.breakdownBySaleType).toEqual([]);
    });

    it('throws ReportInvalidDateRangeException when dateFrom is after dateTo', async () => {
      await expect(
        service.getSalesSummary(dto('2026-08-31T00:00:00Z', '2026-08-01T00:00:00Z')),
      ).rejects.toThrow(ReportInvalidDateRangeException);
    });

    it('produces a JSON-serializable response (no BigInt leakage)', async () => {
      const result = await service.getSalesSummary(AUGUST);

      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('getCashShiftSummary', () => {
    const JULY = dto('2026-07-01T00:00:00Z', '2026-07-31T23:59:59Z');

    beforeAll(async () => {
      // Two CLOSED shifts inside July...
      await seedShift({
        id: 'e2e-rpt-cs1',
        state: 'CLOSED',
        openedAt: '2026-07-05T08:00:00Z',
        closedAt: '2026-07-05T22:00:00Z',
        expectedClosingAmount: '50000.00',
      });
      await seedShift({
        id: 'e2e-rpt-cs2',
        state: 'CLOSED',
        openedAt: '2026-07-25T08:00:00Z',
        closedAt: '2026-07-25T22:00:00Z',
        expectedClosingAmount: '20000.00',
      });
      // ...one CLOSED outside the range...
      await seedShift({
        id: 'e2e-rpt-cs3',
        state: 'CLOSED',
        openedAt: '2026-06-20T08:00:00Z',
        closedAt: '2026-06-20T22:00:00Z',
        expectedClosingAmount: '70000.00',
      });
      // ...and one OPEN inside the range (excluded by state).
      await seedShift({
        id: 'e2e-rpt-cs4',
        state: 'OPEN',
        openedAt: '2026-07-30T08:00:00Z',
        expectedClosingAmount: '5000.00',
      });

      // Confirmed sale on cs1 paid in cash.
      await seedSale({
        id: 'e2e-rpt-css1',
        cashShiftId: 'e2e-rpt-cs1',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-07-05T20:00:00Z',
        totalTax: '5700.00',
        totalAmount: '30000.00',
      });
      await seedPayment({
        id: 'e2e-rpt-pay-1',
        saleId: 'e2e-rpt-css1',
        paymentMethodId: CASH_PM_ID,
        amount: '30000.00',
      });

      // Confirmed sale on cs2 paid by debit card.
      await seedSale({
        id: 'e2e-rpt-css2',
        cashShiftId: 'e2e-rpt-cs2',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-07-25T20:00:00Z',
        totalTax: '2850.00',
        totalAmount: '15000.00',
      });
      await seedPayment({
        id: 'e2e-rpt-pay-2',
        saleId: 'e2e-rpt-css2',
        paymentMethodId: DEBIT_PM_ID,
        amount: '15000.00',
      });

      // ANNULLED sale on cs1 with a payment that must be excluded.
      await seedSale({
        id: 'e2e-rpt-css3',
        cashShiftId: 'e2e-rpt-cs1',
        operationalState: 'ANNULLED',
        confirmedAt: null,
        totalTax: '0.00',
        totalAmount: '12345.00',
        annulledAt: '2026-07-06T10:00:00Z',
      });
      await seedPayment({
        id: 'e2e-rpt-pay-3',
        saleId: 'e2e-rpt-css3',
        paymentMethodId: CASH_PM_ID,
        amount: '12345.00',
      });

      // Confirmed sale on the outside-range shift cs3: its payment must not
      // leak into July's summary.
      await seedSale({
        id: 'e2e-rpt-css4',
        cashShiftId: 'e2e-rpt-cs3',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-06-20T20:00:00Z',
        totalTax: '0.00',
        totalAmount: '999.00',
      });
      await seedPayment({
        id: 'e2e-rpt-pay-4',
        saleId: 'e2e-rpt-css4',
        paymentMethodId: CASH_PM_ID,
        amount: '999.00',
      });
    });

    it('counts only CLOSED shifts within the range and sums expectedClosingAmount', async () => {
      const result = await service.getCashShiftSummary(JULY);

      expect(result.totalShifts).toBe(2);
      expect(result.totalCashMovement).toBe('70000.00');
    });

    it('breaks payments down per category over confirmed sales of in-range closed shifts only', async () => {
      const result = await service.getCashShiftSummary(JULY);

      // The query orders by pm.category, so this array comparison is stable.
      expect(result.breakdownByPaymentMethod).toEqual([
        {
          paymentMethodCategory: 'CASH',
          count: 1,
          totalAmount: '30000.00',
          averageAmount: '30000.00',
        },
        {
          paymentMethodCategory: 'DEBIT_CARD',
          count: 1,
          totalAmount: '15000.00',
          averageAmount: '15000.00',
        },
      ]);
    });

    it('produces a JSON-serializable response (no BigInt leakage)', async () => {
      const result = await service.getCashShiftSummary(JULY);

      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('getInventoryValuation', () => {
    // asOfDate comes from query.dateFrom; expiry threshold = asOf + 90 days
    // = 2026-08-30T00:00:00Z.
    const JUNE_FIRST = dto('2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z');

    beforeAll(async () => {
      // Alpha product: one costed expiring lot + one unknown-cost lot.
      await seedLot({
        id: 'e2e-rpt-lot-a1',
        productId: VALUATION_ALPHA_ID,
        batchNumber: 'BATCH-A1',
        expirationDate: '2026-07-15T00:00:00Z',
        currentStock: 10,
        receptionUnitCost: '12.50',
      });
      await seedLot({
        id: 'e2e-rpt-lot-a2',
        productId: VALUATION_ALPHA_ID,
        batchNumber: 'BATCH-A2',
        expirationDate: '2027-03-01T00:00:00Z',
        currentStock: 5,
        // No PurchaseReceptionItem -> unknown cost.
      });
      // Beta product: one costed lot exactly on the threshold boundary.
      await seedLot({
        id: 'e2e-rpt-lot-b1',
        productId: VALUATION_BETA_ID,
        batchNumber: 'BATCH-B1',
        expirationDate: '2026-08-30T00:00:00Z',
        currentStock: 4,
        receptionUnitCost: '7.25',
      });
      // Beta product: exhausted lot, excluded from every aggregate.
      await seedLot({
        id: 'e2e-rpt-lot-b2',
        productId: VALUATION_BETA_ID,
        batchNumber: 'BATCH-B2',
        expirationDate: '2026-07-01T00:00:00Z',
        currentStock: 0,
        receptionUnitCost: '99.99',
      });
    });

    it('values active lots per product and excludes zero-stock lots entirely', async () => {
      const result = await service.getInventoryValuation(JUNE_FIRST);

      expect(result.valuationDate).toBe('2026-06-01T00:00:00.000Z');
      // Ordered by commercialName ASC.
      expect(result.breakdownByProduct).toEqual([
        {
          productId: VALUATION_ALPHA_ID,
          productName: 'E2E RPT Val Alpha',
          quantity: 15,
          unitCost: '8.33',
          totalValue: '125.00',
          expiringLotCount: 1,
        },
        {
          productId: VALUATION_BETA_ID,
          productName: 'E2E RPT Val Beta',
          quantity: 4,
          unitCost: '7.25',
          totalValue: '29.00',
          expiringLotCount: 1,
        },
      ]);
    });

    it('rolls up lot counts including unknown-cost lots and excludes their value', async () => {
      const result = await service.getInventoryValuation(JUNE_FIRST);

      expect(result.totalLotsActive).toBe(3);
      expect(result.totalLotsExpiring).toBe(2);
      expect(result.lotsWithUnknownCost).toBe(1);
      // Unknown-cost stock (5 units) contributes nothing to the monetary total.
      expect(result.totalInventoryValue).toBe('154.00');
    });

    it('treats a lot expiring exactly at the threshold as expiring', async () => {
      const result = await service.getInventoryValuation(JUNE_FIRST);

      const betaRow = result.breakdownByProduct.find(
        (row: { productId: string }) => row.productId === VALUATION_BETA_ID,
      );
      expect(betaRow.expiringLotCount).toBe(1);
    });

    it('produces a JSON-serializable response (no BigInt leakage)', async () => {
      const result = await service.getInventoryValuation(JUNE_FIRST);

      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('getTaxSummary', () => {
    const APRIL = dto('2026-04-01T00:00:00Z', '2026-04-30T23:59:59Z');

    beforeAll(async () => {
      await seedShift({
        id: 'e2e-rpt-shift-mar',
        state: 'OPEN',
        openedAt: '2026-03-01T08:00:00Z',
        expectedClosingAmount: '0',
      });

      // Two confirmed sales with items at two distinct rates.
      await seedSale({
        id: 'e2e-rpt-ts1',
        cashShiftId: 'e2e-rpt-shift-mar',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-03-10T10:00:00Z',
        totalTax: '3800.00',
        totalAmount: '30000.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-ts1-i1',
        saleId: 'e2e-rpt-ts1',
        productId: PRODUCT_A_ID,
        quantity: 2,
        unitPrice: '10000.00',
        taxRate: '0.1900',
        taxAmount: '3800.00',
        subtotal: '20000.00',
        total: '23800.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-ts1-i2',
        saleId: 'e2e-rpt-ts1',
        productId: PRODUCT_B_ID,
        quantity: 1,
        unitPrice: '8000.00',
        taxRate: '0.0000',
        taxAmount: '0.00',
        subtotal: '10000.00',
        total: '10000.00',
      });

      await seedSale({
        id: 'e2e-rpt-ts2',
        cashShiftId: 'e2e-rpt-shift-mar',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-03-11T10:00:00Z',
        totalTax: '2850.00',
        totalAmount: '10000.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-ts2-i1',
        saleId: 'e2e-rpt-ts2',
        productId: PRODUCT_A_ID,
        quantity: 4,
        unitPrice: '2500.00',
        taxRate: '0.1900',
        taxAmount: '2850.00',
        subtotal: '10000.00',
        total: '12850.00',
      });

      // Confirmed sale without items: its VALIDATED INVOICE counts toward
      // totalDocuments only.
      await seedSale({
        id: 'e2e-rpt-ts3',
        cashShiftId: 'e2e-rpt-shift-mar',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-03-12T10:00:00Z',
        totalTax: '0.00',
        totalAmount: '5000.00',
      });

      // VALIDATED INVOICEs updated in April -> counted by the report. Their
      // issueDate sits outside May so the fiscal-report window stays clean.
      await seedFiscalDocument({
        id: 'e2e-rpt-fdt1',
        documentType: 'INVOICE',
        fiscalState: 'VALIDATED',
        issueDate: '2026-03-12T11:00:00Z',
        updatedAt: '2026-04-12T00:00:00Z',
        subtotal: '30000.00',
        totalTax: '3800.00',
        totalAmount: '33800.00',
        saleId: 'e2e-rpt-ts1',
      });
      await seedFiscalDocument({
        id: 'e2e-rpt-fdt2',
        documentType: 'INVOICE',
        fiscalState: 'VALIDATED',
        issueDate: '2026-03-13T11:00:00Z',
        updatedAt: '2026-04-22T00:00:00Z',
        subtotal: '10000.00',
        totalTax: '2850.00',
        totalAmount: '12850.00',
        saleId: 'e2e-rpt-ts2',
      });
      await seedFiscalDocument({
        id: 'e2e-rpt-fdt3',
        documentType: 'INVOICE',
        fiscalState: 'VALIDATED',
        issueDate: '2026-03-14T11:00:00Z',
        updatedAt: '2026-04-23T00:00:00Z',
        subtotal: '5000.00',
        totalTax: '0.00',
        totalAmount: '5000.00',
        saleId: 'e2e-rpt-ts3',
      });
      // Wrong fiscalState -> excluded even though updatedAt is in April.
      await seedFiscalDocument({
        id: 'e2e-rpt-fdt4',
        documentType: 'INVOICE',
        fiscalState: 'REJECTED',
        issueDate: '2026-03-15T11:00:00Z',
        updatedAt: '2026-04-24T00:00:00Z',
        subtotal: '30000.00',
        totalTax: '3800.00',
        totalAmount: '33800.00',
        saleId: 'e2e-rpt-ts1',
      });
      // Wrong documentType -> excluded.
      await seedFiscalDocument({
        id: 'e2e-rpt-fdt5',
        documentType: 'POS_TICKET',
        fiscalState: 'VALIDATED',
        issueDate: '2026-03-16T11:00:00Z',
        updatedAt: '2026-04-25T00:00:00Z',
        subtotal: '30000.00',
        totalTax: '3800.00',
        totalAmount: '33800.00',
        saleId: 'e2e-rpt-ts1',
      });
    });

    it('buckets subtotal and tax by stored taxRate over validated invoices updated in range', async () => {
      const result = await service.getTaxSummary(APRIL);

      // The query orders by taxRate ASC.
      expect(result.breakdownByTaxRate).toEqual([
        {
          taxRate: '0.0000',
          taxableBase: '10000.00',
          taxAmount: '0.00',
          documentCount: 1,
        },
        {
          taxRate: '0.1900',
          taxableBase: '30000.00',
          taxAmount: '6650.00',
          documentCount: 2,
        },
      ]);
    });

    it('counts documents without items in totalDocuments but not in monetary buckets', async () => {
      const result = await service.getTaxSummary(APRIL);

      // Three VALIDATED INVOICEs were updated in April: fdt1 (items at both
      // rates), fdt2 (0.19 items) and fdt3 (no items at all).
      expect(result.totalDocuments).toBe(3);
      expect(typeof result.totalDocuments).toBe('number');
      expect(result.totalTaxableBase).toBe('40000.00');
      expect(result.totalTaxAmount).toBe('6650.00');
    });

    it('echoes the requested period', async () => {
      const result = await service.getTaxSummary(APRIL);

      expect(result.reportPeriod).toEqual({
        dateFrom: '2026-04-01T00:00:00Z',
        dateTo: '2026-04-30T23:59:59Z',
      });
    });

    it('produces a JSON-serializable response (no BigInt leakage)', async () => {
      const result = await service.getTaxSummary(APRIL);

      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('getFiscalReport', () => {
    const MAY = dto('2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z');

    beforeAll(async () => {
      // updatedAt pinned to February so these documents stay out of the April
      // tax-summary window; issueDate decides the May fiscal-report window.
      const docs = [
        {
          id: 'e2e-rpt-ff1',
          documentType: 'INVOICE' as const,
          fiscalState: 'VALIDATED' as const,
          issueDate: '2026-05-02T12:00:00Z',
          subtotal: '30000.00',
          totalTax: '6650.00',
          totalAmount: '36650.00',
        },
        {
          id: 'e2e-rpt-ff2',
          documentType: 'INVOICE' as const,
          fiscalState: 'VALIDATED' as const,
          issueDate: '2026-05-03T12:00:00Z',
          subtotal: '15000.00',
          totalTax: '2850.00',
          totalAmount: '17850.00',
        },
        {
          id: 'e2e-rpt-ff3',
          documentType: 'INVOICE' as const,
          fiscalState: 'REJECTED' as const,
          issueDate: '2026-05-04T12:00:00Z',
          subtotal: '5000.00',
          totalTax: '950.00',
          totalAmount: '5950.00',
        },
        {
          id: 'e2e-rpt-ff4',
          documentType: 'CREDIT_NOTE' as const,
          fiscalState: 'VALIDATED' as const,
          issueDate: '2026-05-05T12:00:00Z',
          subtotal: '8000.00',
          totalTax: '1520.00',
          totalAmount: '9520.00',
        },
      ];

      for (const doc of docs) {
        await seedFiscalDocument({
          ...doc,
          updatedAt: '2026-02-10T00:00:00Z',
        });
      }

      // Same shape as ff1 but issued in April -> outside the May window.
      await seedFiscalDocument({
        id: 'e2e-rpt-ff5',
        documentType: 'INVOICE',
        fiscalState: 'VALIDATED',
        issueDate: '2026-04-28T12:00:00Z',
        updatedAt: '2026-02-10T00:00:00Z',
        subtotal: '11111.00',
        totalTax: '2222.00',
        totalAmount: '13333.00',
      });
    });

    it('nests states per document type alphabetically, states sorted by descending count', async () => {
      const result = await service.getFiscalReport(MAY);

      expect(result.breakdownByType).toHaveLength(2);
      expect(result.breakdownByType[0].documentType).toBe('CREDIT_NOTE');
      expect(result.breakdownByType[0].count).toBe(1);
      expect(result.breakdownByType[0].totalAmount.toFixed(2)).toBe('9520.00');
      expect(result.breakdownByType[0].states).toEqual([
        { state: 'VALIDATED', count: 1 },
      ]);
      expect(result.breakdownByType[1].documentType).toBe('INVOICE');
      expect(result.breakdownByType[1].count).toBe(3);
      expect(result.breakdownByType[1].totalAmount.toFixed(2)).toBe('60450.00');
      expect(result.breakdownByType[1].states).toEqual([
        { state: 'VALIDATED', count: 2 },
        { state: 'REJECTED', count: 1 },
      ]);
    });

    it('sums totals over ALL in-range rows regardless of fiscal state', async () => {
      const result = await service.getFiscalReport(MAY);

      expect(result.totalDocuments).toBe(4);
      expect(result.totalSubtotal).toBe('58000.00');
      expect(result.totalTax).toBe('11970.00');
      expect(result.totalAmount).toBe('69970.00');
    });

    it('echoes the requested period and view', async () => {
      const result = await service.getFiscalReport(MAY);

      expect(result.reportPeriod).toEqual({
        dateFrom: '2026-05-01T00:00:00Z',
        dateTo: '2026-05-31T23:59:59Z',
      });
      expect(result.view).toBe('operational');
    });

    it('produces a JSON-serializable response (no BigInt leakage)', async () => {
      const result = await service.getFiscalReport(MAY);

      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('getDailyReport', () => {
    const SEPTEMBER = dto('2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z');

    beforeAll(async () => {
      await seedShift({
        id: 'e2e-rpt-shift-sep',
        state: 'OPEN',
        openedAt: '2026-09-01T08:00:00Z',
        expectedClosingAmount: '0',
      });

      // Day 1: two sales.
      await seedSale({
        id: 'e2e-rpt-dd1',
        cashShiftId: 'e2e-rpt-shift-sep',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-09-10T10:00:00Z',
        totalTax: '3800.00',
        totalAmount: '30000.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-dd1-i1',
        saleId: 'e2e-rpt-dd1',
        productId: PRODUCT_A_ID,
        quantity: 2,
        unitPrice: '10000.00',
        taxRate: '0.1900',
        taxAmount: '1900.00',
        subtotal: '20000.00',
        total: '21900.00',
        commissionAmount: '600.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-dd1-i2',
        saleId: 'e2e-rpt-dd1',
        productId: PRODUCT_B_ID,
        quantity: 1,
        unitPrice: '10000.00',
        taxRate: '0.0000',
        taxAmount: '0.00',
        subtotal: '10000.00',
        total: '10000.00',
      });

      await seedSale({
        id: 'e2e-rpt-dd2',
        cashShiftId: 'e2e-rpt-shift-sep',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-09-10T18:45:00Z',
        totalTax: '3800.00',
        totalAmount: '20000.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-dd2-i1',
        saleId: 'e2e-rpt-dd2',
        productId: PRODUCT_A_ID,
        quantity: 2,
        unitPrice: '10000.00',
        taxRate: '0.1900',
        taxAmount: '3800.00',
        subtotal: '20000.00',
        total: '23800.00',
        commissionAmount: '250.00',
      });

      // Edge sale one second before midnight stays on Sep 20. Multi-item:
      // pins the LATERAL pre-aggregation (totalAmount must NOT be multiplied
      // by the item join while quantity/commission still sum per item).
      await seedSale({
        id: 'e2e-rpt-dd3',
        cashShiftId: 'e2e-rpt-shift-sep',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-09-20T23:59:59Z',
        totalTax: '7600.00',
        totalAmount: '40000.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-dd3-i1',
        saleId: 'e2e-rpt-dd3',
        productId: PRODUCT_A_ID,
        quantity: 3,
        unitPrice: '8333.33',
        taxRate: '0.1900',
        taxAmount: '4750.00',
        subtotal: '25000.00',
        total: '29750.00',
        commissionAmount: '1000.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-dd3-i2',
        saleId: 'e2e-rpt-dd3',
        productId: PRODUCT_B_ID,
        quantity: 1,
        unitPrice: '15000.00',
        taxRate: '0.0000',
        taxAmount: '0.00',
        subtotal: '15000.00',
        total: '15000.00',
        commissionAmount: '500.00',
      });

      // First seconds of the NEXT day land in the following bucket.
      await seedSale({
        id: 'e2e-rpt-dd4',
        cashShiftId: 'e2e-rpt-shift-sep',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-09-21T00:00:30Z',
        totalTax: '1900.00',
        totalAmount: '10000.00',
      });
      await seedSaleItem({
        id: 'e2e-rpt-dd4-i1',
        saleId: 'e2e-rpt-dd4',
        productId: PRODUCT_A_ID,
        quantity: 1,
        unitPrice: '10000.00',
        taxRate: '0.1900',
        taxAmount: '1900.00',
        subtotal: '10000.00',
        total: '11900.00',
      });
    });

    it('buckets confirmed sales per YYYY-MM-DD day with per-day averages', async () => {
      const result = await service.getDailyReport(SEPTEMBER);

      expect(result.dailyEntries).toEqual([
        {
          date: '2026-09-10',
          salesCount: 2,
          totalAmount: '50000.00',
          totalTax: '7600.00',
          quantity: 5,
          commissionAmount: '850.00',
          averageTicket: '25000.00',
        },
        {
          date: '2026-09-20',
          salesCount: 1,
          totalAmount: '40000.00',
          totalTax: '7600.00',
          quantity: 4,
          commissionAmount: '1500.00',
          averageTicket: '40000.00',
        },
        {
          date: '2026-09-21',
          salesCount: 1,
          totalAmount: '10000.00',
          totalTax: '1900.00',
          quantity: 1,
          commissionAmount: '0.00',
          averageTicket: '10000.00',
        },
      ]);
    });

    it('does not double-count multi-item sales in day or roll-up totals', async () => {
      const result = await service.getDailyReport(SEPTEMBER);

      // dd3 has two items but contributes its totalAmount exactly once.
      const sep20 = result.dailyEntries.find(
        (entry: { date: string }) => entry.date === '2026-09-20',
      );
      expect(sep20.totalAmount).toBe('40000.00');

      expect(result.totalDays).toBe(3);
      expect(result.totals.totalSales).toBe(4);
      expect(result.totals.totalAmount).toBe('100000.00');
      expect(result.totals.totalTax).toBe('17100.00');
      expect(result.totals.totalQuantity).toBe(10);
      expect(result.totals.averageTicket).toBe('25000.00');
      expect(result.totals.totalCommission).toBe('2350.00');
    });

    it('produces a JSON-serializable response (no BigInt leakage)', async () => {
      const result = await service.getDailyReport(SEPTEMBER);

      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });
});
