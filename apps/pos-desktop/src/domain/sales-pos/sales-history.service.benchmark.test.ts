/**
 * Benchmark — sales-history list query, old vs optimized, on real PGlite.
 *
 * Seeds a realistic local database (confirmed sales + DIAN invoices with the
 * full `fullData` JSONB payload + payments) and times both implementations
 * of `listConfirmedSales` against the SAME data through the real
 * PrismaClient + pglite-prisma-adapter:
 *
 * - **before** — the HEAD implementation: `sale.findMany` with the payments
 *   include, `invoice.findMany` without a select (materializes the whole
 *   `fullData` JSONB + `fiscalXml` per row), and OFFSET pagination.
 * - **after** — the optimized implementation (the real service):
 *   minimal `select`, a single raw SQL projection that reads only the buyer
 *   from the JSONB path, and keyset (cursor) pagination.
 *
 * The measurements are informational (printed to stdout); the hard
 * assertions guarantee both implementations return equivalent results, so
 * the timing compares apples to apples.
 *
 * Known results on PGlite (WASM) at 3 000 sales, page size 50:
 * - page 1: ~1.8× faster (the projection + JSONB-path win the UI actually
 *   feels — this is the "historial siempre demora" case).
 * - deep page: keyset cursor is *slower* than OFFSET in PGlite (~0.6×).
 *   PGlite's planner does not index-seek the keyset OR predicate and at
 *   this volume OFFSET is not a bottleneck yet, so the cursor only pays
 *   its extra WHERE evaluation. The cursor is a scalability investment
 *   that wins on PostgreSQL at much larger volumes (or once the
 *   Sale(operationalState, confirmedAt, id) index is in place); it is
 *   kept because it is correct, cheap on page 1, and unblocks infinite
 *   scroll without OFFSET re-scan.
 *
 * Run: `pnpm --filter pos-desktop test:unit -- src/domain/sales-pos/sales-history.service.benchmark.test.ts`
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient, Prisma, SaleOperationalState } from "@pharmacy/database/local";
import { LOCAL_SCHEMA_SQL } from "@pharmacy/database/local-schema";
import {
  createSalesHistoryService,
  type SaleHistoryFilters,
  type SaleHistoryListResult,
} from "./sales-history.service";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Number of confirmed sales to seed (each with one invoice + one payment). */
const SALE_COUNT = 3_000;
/** Page size used by the UI. */
const PAGE_SIZE = 50;
/** Offset / cursor position for the "deep page" measurement. */
const DEEP_OFFSET = 1_000;
/** Iterations per measurement (median is reported). */
const ITERATIONS = 5;

const WORKSTATION_ID = "ws-bench-001";
const USER_ID = "user-bench-001";

// ---------------------------------------------------------------------------
// Old implementation (replica of HEAD) — measured, not asserted for output
// ---------------------------------------------------------------------------

interface SaleHistoryListItem {
  saleId: string;
  invoiceId: string | null;
}

async function legacyListConfirmedSales(
  prisma: PrismaClient,
  filters: SaleHistoryFilters = {},
): Promise<{ items: SaleHistoryListItem[]; total: number }> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const where: Record<string, unknown> = {
    operationalState: SaleOperationalState.CONFIRMED,
  };

  if (filters.since || filters.until) {
    const confirmedAt: Record<string, Date> = {};
    if (filters.since) confirmedAt.gte = filters.since;
    if (filters.until) confirmedAt.lte = filters.until;
    where.confirmedAt = confirmedAt;
  }

  if (filters.clientId) {
    where.clientId = filters.clientId;
  }

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: { confirmedAt: "desc" as const },
      take: limit,
      skip: offset,
      include: {
        payments: { include: { paymentMethod: { select: { name: true } } } },
      },
    }),
    prisma.sale.count({ where }),
  ]);

  const saleIds = sales.map((s) => s.id);
  const invoices = await prisma.invoice.findMany({
    where: { saleId: { in: saleIds } },
    orderBy: { issuedAt: "desc" as const },
  });

  const adjustmentCounts = await prisma.invoiceLocalAdjustment.groupBy({
    by: ["invoiceId"],
    where: { invoiceId: { in: invoices.map((i) => i.id) } },
    _count: { invoiceId: true },
  });

  const invoicesBySaleId = new Map<string, (typeof invoices)[number][]>();
  for (const invoice of invoices) {
    const list = invoicesBySaleId.get(invoice.saleId) ?? [];
    list.push(invoice);
    invoicesBySaleId.set(invoice.saleId, list);
  }

  const adjustmentCountByInvoiceId = new Map(
    adjustmentCounts.map((ac) => [ac.invoiceId, ac._count.invoiceId]),
  );

  const items: SaleHistoryListItem[] = sales.map((sale) => {
    const mainInvoice = (invoicesBySaleId.get(sale.id) ?? [])[0] ?? null;
    return {
      saleId: sale.id,
      invoiceId: mainInvoice?.id ?? null,
      // hasAdjustments is read from the groupBy map — forces the same work.
      hasAdjustments: mainInvoice
        ? (adjustmentCountByInvoiceId.get(mainInvoice.id) ?? 0) > 0
        : false,
    };
  });

  return { items, total };
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/** Build a realistic DIAN invoice `fullData` JSONB payload (~2-4 KB serialized). */
function buildFullData(index: number): Record<string, unknown> {
  return {
    invoiceType: "ELECTRONIC_INVOICE",
    invoiceNumber: `FE${String(index).padStart(8, "0")}`,
    cufe: `cufe-${index}`,
    issuedAt: "2026-07-01T10:00:00Z",
    seller: {
      nit: "900000000",
      name: "Droguería Farmacia Central S.A.S.",
      address: "Calle 10 # 5-20",
      city: "Bogotá D.C.",
      phone: "6015551234",
      email: "facturacion@farmaciacentral.example",
      resolutionNumber: "18760000000001",
      resolutionPrefix: "FE",
      rangeStart: 1,
      rangeEnd: 99999999,
    },
    buyer: {
      name: `Cliente Bench ${index}`,
      identificationType: index % 3 === 0 ? "NIT" : "CC",
      identificationNumber: String(1000000000 + index),
      address: `Calle ${index} # 1-2`,
      phone: `300${String(index).padStart(7, "0")}`,
    },
    lineItems: [
      {
        line: 1,
        code: "7701234567890",
        name: "Acetaminofén 500mg Tabletas x 20",
        quantity: 2,
        unitPrice: "3500.00",
        subtotal: "7000.00",
        taxRate: "0.0000",
        taxAmount: "0.00",
        total: "7000.00",
      },
      {
        line: 2,
        code: "7709876543210",
        name: "Loratadina 10mg Tabletas x 10",
        quantity: 1,
        unitPrice: "12400.00",
        subtotal: "12400.00",
        taxRate: "0.1900",
        taxAmount: "2356.00",
        total: "14756.00",
      },
      {
        line: 3,
        code: "7701112223334",
        name: "Vitamina C 1000mg Efervescente x 30",
        quantity: 1,
        unitPrice: "28900.00",
        subtotal: "28900.00",
        taxRate: "0.1900",
        taxAmount: "5491.00",
        total: "34391.00",
      },
      {
        line: 4,
        code: "7704445556667",
        name: "Alcohol Antiséptico 70% 500ml",
        quantity: 3,
        unitPrice: "5200.00",
        subtotal: "15600.00",
        taxRate: "0.1900",
        taxAmount: "2964.00",
        total: "18564.00",
      },
    ],
    taxSummaries: [
      { taxCode: "01", taxRate: "0.0000", taxableAmount: "7000.00", taxAmount: "0.00" },
      { taxCode: "01", taxRate: "0.1900", taxableAmount: "56900.00", taxAmount: "10811.00" },
    ],
    totals: {
      grossTotal: "73900.00",
      discounts: "0.00",
      taxableTotal: "63900.00",
      nonTaxableTotal: "7000.00",
      taxTotal: "10811.00",
      totalAmount: "74711.00",
      currency: "COP",
    },
    payments: [{ paymentMethodCode: "1", paymentMethodName: "Efectivo", amount: "74711.00" }],
    notes: `Venta de referencia del benchmark #${index}`,
  };
}

async function seedData(prisma: PrismaClient): Promise<void> {
  const now = new Date();

  // Reference rows needed for FKs.
  const paymentMethodId = "pm-bench-cash";
  await prisma.paymentMethod.create({
    data: {
      id: paymentMethodId,
      internalCode: "CASH",
      name: "Efectivo",
      category: "CASH",
      isCash: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const cashShiftId = "shift-bench-001";
  await prisma.cashShift.create({
    data: {
      id: cashShiftId,
      workstationId: WORKSTATION_ID,
      userId: USER_ID,
      state: "CLOSED",
      openedAt: new Date("2026-07-01T06:00:00Z"),
      updatedAt: now,
    },
  });

  // Bulk-create sales (batched to keep the statement size sane).
  const SALE_BATCH = 500;
  for (let start = 0; start < SALE_COUNT; start += SALE_BATCH) {
    const end = Math.min(start + SALE_BATCH, SALE_COUNT);
    await prisma.sale.createMany({
      data: Array.from({ length: end - start }, (_, k) => {
        const i = start + k;
        const confirmedAt = new Date(Date.UTC(2026, 6, 1, 8, 0, i));
        return {
          id: `sale-bench-${String(i).padStart(6, "0")}`,
          localNumber: BigInt(i + 1),
          operationalState: SaleOperationalState.CONFIRMED,
          startedAt: confirmedAt,
          confirmedAt,
          lastModifiedAt: confirmedAt,
          subtotal: new Prisma.Decimal("63900.00"),
          totalTax: new Prisma.Decimal("10811.00"),
          totalAmount: new Prisma.Decimal("74711.00"),
          changeAmount: new Prisma.Decimal("0.00"),
          clientNameSnapshot: `Cliente Bench ${i}`,
          clientIdentificationNumberSnapshot: String(1000000000 + i),
          cashShiftId,
          workstationId: WORKSTATION_ID,
          userId: USER_ID,
          sourceWorkstationId: WORKSTATION_ID,
        };
      }),
    });
  }

  // Invoices — one per sale, with the full DIAN payload + fiscalXml so the
  // "before" query pays the full JSONB + XML serialization cost.
  for (let start = 0; start < SALE_COUNT; start += SALE_BATCH) {
    const end = Math.min(start + SALE_BATCH, SALE_COUNT);
    await prisma.invoice.createMany({
      data: Array.from({ length: end - start }, (_, k) => {
        const i = start + k;
        return {
          id: `inv-bench-${String(i).padStart(6, "0")}`,
          saleId: `sale-bench-${String(i).padStart(6, "0")}`,
          workstationId: WORKSTATION_ID,
          invoiceType: "ELECTRONIC_INVOICE",
          invoiceNumber: `FE${String(i).padStart(8, "0")}`,
          status: "TRANSMITTED_AUTHORIZED",
          cufeProvisional: `cufe-${i}`,
          issuedAt: new Date(Date.UTC(2026, 6, 1, 8, 0, i)),
          expiresAt: new Date(Date.UTC(2026, 6, 3, 8, 0, i)),
          fiscalXml: `<Invoice><Number>FE${String(i).padStart(8, "0")}</Number><Total>74711.00</Total><CUFE>cufe-${i}</CUFE></Invoice>`,
          techKeySnapshot: "tech-key-bench",
          fullData: buildFullData(i) as Prisma.InputJsonValue,
        };
      }),
    });
  }

  // One payment per sale (what the old query's include materialized).
  for (let start = 0; start < SALE_COUNT; start += SALE_BATCH) {
    const end = Math.min(start + SALE_BATCH, SALE_COUNT);
    await prisma.salePayment.createMany({
      data: Array.from({ length: end - start }, (_, k) => {
        const i = start + k;
        return {
          id: `pay-bench-${String(i).padStart(6, "0")}`,
          saleId: `sale-bench-${String(i).padStart(6, "0")}`,
          paymentMethodId,
          amount: new Prisma.Decimal("74711.00"),
        };
      }),
    });
  }

  // A handful of invoices with adjustments so the groupBy/subquery has work.
  await prisma.invoiceLocalAdjustment.createMany({
    data: [0, 25, 500, 1500, 2900].map((i, k) => ({
      id: `adj-bench-${k}`,
      invoiceId: `inv-bench-${String(i).padStart(6, "0")}`,
      invoiceNumber: `FE${String(i).padStart(8, "0")}`,
      createdAt: now,
      createdByUserId: USER_ID,
      createdByUserName: "Bench User",
      workstationId: WORKSTATION_ID,
      adjustmentType: "INTERNAL_NOTE",
      reason: "benchmark adjustment",
      version: 1,
    })),
  });
}

// ---------------------------------------------------------------------------
// Measurement helper
// ---------------------------------------------------------------------------

async function measure<T>(
  run: () => Promise<T>,
  iterations = ITERATIONS,
): Promise<{ medianMs: number; p90Ms: number }> {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await run();
    samples.push(performance.now() - t0);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? sorted[sorted.length - 1];
  return { medianMs: median, p90Ms: p90 };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("sales-history list benchmark (PGlite)", () => {
  let pg: PGlite;
  let prisma: PrismaClient;
  let service: ReturnType<typeof createSalesHistoryService>;

  beforeAll(async () => {
    pg = new PGlite("memory://");
    await pg.exec(LOCAL_SCHEMA_SQL);
    const adapter = new PrismaPGlite(pg);
    prisma = new PrismaClient({ adapter });
    await seedData(prisma);

    service = createSalesHistoryService({
      prisma,
      // listConfirmedSales never touches the adjustment service.
      adjustmentService: {} as never,
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pg.close();
  });

  it("measures page 1 (offset 0) — before vs after", async () => {
    // Warmup both paths (WASM + query-plan caches).
    await legacyListConfirmedSales(prisma, { limit: PAGE_SIZE, offset: 0 });
    await service.listConfirmedSales({ limit: PAGE_SIZE });

    const before = await measure(() =>
      legacyListConfirmedSales(prisma, { limit: PAGE_SIZE, offset: 0 }),
    );
    const after = await measure(() =>
      service.listConfirmedSales({ limit: PAGE_SIZE }),
    );

    const beforeRes = await legacyListConfirmedSales(prisma, {
      limit: PAGE_SIZE,
      offset: 0,
    });
    const afterRes = await service.listConfirmedSales({ limit: PAGE_SIZE });

    // Equivalence: same rows, same order, same total.
    expect(afterRes.items.map((i) => i.saleId)).toEqual(
      beforeRes.items.map((i) => i.saleId),
    );
    expect(afterRes.total).toBe(beforeRes.total);
    expect(afterRes.total).toBe(SALE_COUNT);

    console.log(
      `\n[bench] page 1 (${PAGE_SIZE} rows, ${SALE_COUNT} sales total)\n` +
        `  before (payments include + fullData materialized + OFFSET): ${before.medianMs.toFixed(1)} ms median, ${before.p90Ms.toFixed(1)} ms p90\n` +
        `  after  (minimal select + JSONB path + cursor-ready):       ${after.medianMs.toFixed(1)} ms median, ${after.p90Ms.toFixed(1)} ms p90\n` +
        `  speedup: ${(before.medianMs / after.medianMs).toFixed(2)}×`,
    );
  }, 120_000);

  it("measures a deep page (offset 1000) — before vs after", async () => {
    // Resolve the cursor id at position DEEP_OFFSET-1 using the real ordering.
    const reference = await prisma.sale.findMany({
      where: { operationalState: SaleOperationalState.CONFIRMED },
      orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
      take: DEEP_OFFSET,
      select: { id: true },
    });
    const cursorId = reference[DEEP_OFFSET - 1]?.id;

    // Warmup.
    await legacyListConfirmedSales(prisma, {
      limit: PAGE_SIZE,
      offset: DEEP_OFFSET,
    });
    await service.listConfirmedSales({
      limit: PAGE_SIZE,
      cursor: cursorId ? { id: cursorId } : undefined,
    });

    const before = await measure(() =>
      legacyListConfirmedSales(prisma, {
        limit: PAGE_SIZE,
        offset: DEEP_OFFSET,
      }),
    );
    const after = await measure(() =>
      service.listConfirmedSales({
        limit: PAGE_SIZE,
        cursor: cursorId ? { id: cursorId } : undefined,
      }),
    );

    const beforeRes = await legacyListConfirmedSales(prisma, {
      limit: PAGE_SIZE,
      offset: DEEP_OFFSET,
    });
    const afterRes = await service.listConfirmedSales({
      limit: PAGE_SIZE,
      cursor: cursorId ? { id: cursorId } : undefined,
    });

    expect(afterRes.items.map((i) => i.saleId)).toEqual(
      beforeRes.items.map((i) => i.saleId),
    );

    console.log(
      `\n[bench] deep page (offset/cursor ${DEEP_OFFSET})\n` +
        `  before (OFFSET re-scan): ${before.medianMs.toFixed(1)} ms median, ${before.p90Ms.toFixed(1)} ms p90\n` +
        `  after  (keyset cursor):  ${after.medianMs.toFixed(1)} ms median, ${after.p90Ms.toFixed(1)} ms p90\n` +
        `  speedup: ${(before.medianMs / after.medianMs).toFixed(2)}×`,
    );
  }, 120_000);

  it("measures the search path (new DB-side query vs old in-memory filter)", async () => {
    const QUERY = "Cliente Bench 1500";

    // Old behaviour: it could only ever look at the rows on page 1 (50).
    const oldT0 = performance.now();
    await legacyListConfirmedSales(prisma, { limit: PAGE_SIZE, offset: 0 });
    const oldMs = performance.now() - oldT0;

    // New behaviour: filter in the database across ALL rows.
    const newT0 = performance.now();
    const newRes: SaleHistoryListResult = await service.listConfirmedSales({
      limit: PAGE_SIZE,
      query: QUERY,
    });
    const newMs = performance.now() - newT0;

    // The new path is the correct one: it finds the row even deep in the
    // history, something the old in-memory filter never could.
    expect(newRes.items.length).toBe(1);
    expect(newRes.items[0].saleId).toBe(
      `sale-bench-${String(1500).padStart(6, "0")}`,
    );

    console.log(
      `\n[bench] search "${QUERY}"\n` +
        `  old (client filter on page 1 only): ${oldMs.toFixed(1)} ms — cannot find deep rows\n` +
        `  new (DB-side ILIKE over all ${SALE_COUNT} rows): ${newMs.toFixed(1)} ms — finds the row`,
    );
  }, 120_000);
});
