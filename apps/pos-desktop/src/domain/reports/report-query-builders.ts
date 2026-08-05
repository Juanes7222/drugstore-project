/**
 * Local report query builders.
 *
 * Every public function in this module returns a parameterized SQL
 * fragment that the aggregations service executes against the local
 * PGlite database via `getLocalDatabase()`.  No string interpolation of
 * user input ever happens here — the only parameters that vary are
 * placeholders bound to validated values.
 *
 * ## Why SQL fragments and not the Prisma client?
 * The Prisma client is fine for the small, well-shaped queries services
 * run every day.  Reports aggregate over tens of thousands of rows and
 * benefit from a single hand-tuned SQL statement per report.  We
 * intentionally keep the surface narrow: each builder returns a
 * `{ sql, params }` pair that the execution service runs with a small
 * in-memory cache around the result.
 *
 * ## Date handling
 * Report filter dates are Colombia-local YYYY-MM-DD strings.  Sales are
 * confirmed with UTC timestamps, so every filter compares the date
 * portion of `confirmedAt` to a `[from, to+1day)` range in UTC.  This
 * is the same pattern the server-side reports use — the POS never
 * reaches into the timezone-aware boundary, it just shifts `to` by one
 * day to include the entire Colombia day.
 */

import { Prisma } from '@pharmacy/database/local';
import { DateRangeFilter, MovementType, SaleOperationalState } from './report-types';

export interface QueryFragment {
  sql: string;
  params: unknown[];
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Convert a YYYY-MM-DD string into a UTC ISO timestamp at 00:00:00. */
export function startOfDayUtc(date: string): string {
  return `${date}T00:00:00.000Z`;
}

/** Convert a YYYY-MM-DD string into a UTC ISO timestamp at 23:59:59.999
 *  of the *next* day (so the report includes all sales up to midnight
 *  Colombia local time on `dateTo`). */
export function endOfDayUtcExclusive(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Build a `confirmedAt >= $X AND confirmedAt < $Y` clause + params. */
export function buildDateRangeClause(
  range: DateRangeFilter,
  startIndex: number,
  column = 'confirmedAt',
): { sql: string; params: unknown[]; nextIndex: number } {
  return {
    sql: ` AND ${column} >= $${startIndex} AND ${column} < $${startIndex + 1}`,
    params: [startOfDayUtc(range.dateFrom), endOfDayUtcExclusive(range.dateTo)],
    nextIndex: startIndex + 2,
  };
}

// ---------------------------------------------------------------------------
// Sale state predicate
// ---------------------------------------------------------------------------

/** Always include the same operational state filter on every sales report. */
export const CONFIRMED_SALE_PREDICATE =
  `s."operationalState" = '${SaleOperationalState.CONFIRMED}'`;

/** The inverse — annulled sales. */
export const ANNULLED_SALE_PREDICATE =
  `s."operationalState" = '${SaleOperationalState.ANNULLED}'`;

/**
 * Predicate for domicilio sales: the `delivery` JSONB column carries a
 * SaleDeliveryInfo object. Non-domicilio sales are persisted as
 * `'null'::jsonb` (Prisma `JsonNull`), so a bare `IS NOT NULL` check
 * would count every in-store sale — the `jsonb_typeof` guard excludes
 * JSON nulls and only matches real delivery objects.
 */
export const DELIVERY_SALE_PREDICATE =
  `s."delivery" IS NOT NULL AND jsonb_typeof(s."delivery") = 'object'`;

/** Returns predicate for sales included in gross revenue. */
export const REVENUE_SALE_PREDICATE = CONFIRMED_SALE_PREDICATE;

/** Returns predicate for annulled sales (counted separately). */
export const ANNULMENT_COUNT_PREDICATE = ANNULLED_SALE_PREDICATE;

// ---------------------------------------------------------------------------
// Common SELECT expressions
// ---------------------------------------------------------------------------

/** Currency aggregations cast to numeric so Prisma can serialize them. */
const MONEY_AGGS = `
  COALESCE(SUM(s."subtotal"), 0)::numeric AS gross_sales,
  COALESCE(SUM(s."totalDiscount"), 0)::numeric AS discounts,
  COALESCE(SUM(s."totalTax"), 0)::numeric AS taxes,
  COALESCE(SUM(s."totalAmount"), 0)::numeric AS net_sales,
  COUNT(*)::int AS transaction_count
`;

// ---------------------------------------------------------------------------
// Report 1: SALES_DAILY_SUMMARY
// ---------------------------------------------------------------------------

export function buildSalesDailySummaryQuery(
  range: DateRangeFilter,
  options: { cashierUserId?: string; paymentMethodId?: string },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [startOfDayUtc(range.dateFrom), endOfDayUtcExclusive(range.dateTo)];
  let idx = 3;
  const filters: string[] = [CONFIRMED_SALE_PREDICATE];

  if (options.cashierUserId) {
    filters.push(`s."userId" = $${idx++}`);
    params.push(options.cashierUserId);
  }
  if (options.paymentMethodId) {
    filters.push(
      `EXISTS (SELECT 1 FROM "SalePayment" sp WHERE sp."saleId" = s."id" AND sp."paymentMethodId" = $${idx++})`,
    );
    params.push(options.paymentMethodId);
  }

  const whereClause = filters.join(' AND ');
  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  const sql = `
    WITH confirmed AS (
      SELECT
        date_trunc('day', s."confirmedAt" AT TIME ZONE 'UTC') AS day,
        ${MONEY_AGGS},
        COUNT(*) FILTER (WHERE ${DELIVERY_SALE_PREDICATE})::int AS delivery_count,
        COALESCE(SUM((s."delivery" ->> 'feeCents')::numeric)
                 FILTER (WHERE ${DELIVERY_SALE_PREDICATE}), 0)::numeric AS delivery_fee_collected,
        COALESCE(SUM((
          SELECT COALESCE(SUM(si."commissionAmount"), 0)::numeric
            FROM "SaleItem" si
           WHERE si."saleId" = s."id"
        )), 0)::numeric AS total_commission
      FROM "Sale" s
      WHERE ${whereClause}
        AND s."confirmedAt" >= $1
        AND s."confirmedAt" < $2
      GROUP BY 1
    ),
    annulled AS (
      SELECT
        date_trunc('day', s."annulledAt" AT TIME ZONE 'UTC') AS day,
        COUNT(*)::int AS annulled_count
      FROM "Sale" s
      WHERE s."operationalState" = '${SaleOperationalState.ANNULLED}'
        AND s."annulledAt" >= $1
        AND s."annulledAt" < $2
      GROUP BY 1
    ),
    returns AS (
      SELECT
        date_trunc('day', cr."createdAt" AT TIME ZONE 'UTC') AS day,
        COALESCE(SUM(cr."refundAmount"), 0)::numeric AS returns_amount
      FROM "ClientReturn" cr
      WHERE cr."state" = 'CONFIRMED'
        AND cr."createdAt" >= $1
        AND cr."createdAt" < $2
      GROUP BY 1
    ),
    days AS (
      SELECT day AS date,
             gross_sales,
             discounts,
             taxes,
             net_sales,
             transaction_count,
             delivery_count,
             delivery_fee_collected,
             total_commission,
             COALESCE(a.annulled_count, 0) AS annulled,
             COALESCE(r.returns_amount, 0) AS returns
      FROM confirmed
      LEFT JOIN annulled a USING (day)
      LEFT JOIN returns r USING (day)
    )
    SELECT * FROM days
    ORDER BY date ASC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 2: SALES_BY_CASHIER
// ---------------------------------------------------------------------------

export function buildSalesByCashierQuery(
  range: DateRangeFilter,
  options: { restrictToUserId?: string },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [startOfDayUtc(range.dateFrom), endOfDayUtcExclusive(range.dateTo)];
  let idx = 3;
  const filters: string[] = [CONFIRMED_SALE_PREDICATE];

  if (options.restrictToUserId) {
    filters.push(`s."userId" = $${idx++}`);
    params.push(options.restrictToUserId);
  }

  const whereClause = filters.join(' AND ');
  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  const sql = `
    WITH per_cashier AS (
      SELECT
        s."userId" AS cashier_user_id,
        ${MONEY_AGGS},
        COALESCE(SUM((
          SELECT COALESCE(SUM(si."commissionAmount"), 0)::numeric
            FROM "SaleItem" si
           WHERE si."saleId" = s."id"
        )), 0)::numeric AS commission_amount
      FROM "Sale" s
      WHERE ${whereClause}
        AND s."confirmedAt" >= $1
        AND s."confirmedAt" < $2
      GROUP BY 1
    ),
    returns AS (
      SELECT
        s."userId" AS cashier_user_id,
        COALESCE(SUM(cr."refundAmount"), 0)::numeric AS returns
      FROM "ClientReturn" cr
      JOIN "Sale" s ON s."id" = cr."saleId"
      WHERE cr."state" = 'CONFIRMED'
        AND cr."createdAt" >= $1
        AND cr."createdAt" < $2
      GROUP BY 1
    ),
    variance AS (
      SELECT
        cs."userId" AS cashier_user_id,
        COALESCE(SUM(cs."closingDifference"), 0)::numeric AS total_variance
      FROM "CashShift" cs
      WHERE cs."state" IN ('CLOSED', 'FORCED_CLOSE')
        AND cs."closedAt" >= $1
        AND cs."closedAt" < $2
      GROUP BY 1
    )
    SELECT
      p.cashier_user_id,
      COALESCE(NULLIF(u."displayName", ''), u."username", p.cashier_user_id) AS cashier_name,
      p.transaction_count,
      p.gross_sales,
      COALESCE(r.returns, 0) AS returns,
      (p.gross_sales - COALESCE(r.returns, 0)) AS net_sales,
      CASE WHEN p.transaction_count > 0
           THEN (p.gross_sales - COALESCE(r.returns, 0)) / p.transaction_count
           ELSE 0 END AS average_ticket,
      COALESCE(v.total_variance, 0) AS total_variance,
      p.commission_amount
    FROM per_cashier p
    LEFT JOIN returns r USING (cashier_user_id)
    LEFT JOIN variance v USING (cashier_user_id)
    LEFT JOIN "User" u ON u."id" = p.cashier_user_id
    ORDER BY net_sales DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 3: SALES_BY_PAYMENT_METHOD
// ---------------------------------------------------------------------------

export function buildSalesByPaymentMethodQuery(
  range: DateRangeFilter,
  options: { paymentMethodId?: string },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [
    startOfDayUtc(range.dateFrom),
    endOfDayUtcExclusive(range.dateTo),
  ];
  let idx = 3;
  const filters: string[] = [
    `sp."createdAt" >= $1`,
    `sp."createdAt" < $2`,
  ];
  if (options.paymentMethodId) {
    filters.push(`sp."paymentMethodId" = $${idx++}`);
    params.push(options.paymentMethodId);
  }
  const whereClause = filters.join(' AND ');
  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  const sql = `
    WITH collected AS (
      SELECT
        sp."paymentMethodId" AS payment_method_id,
        pm."name" AS payment_method_name,
        COUNT(*)::int AS transaction_count,
        COALESCE(SUM(sp."amount"), 0)::numeric AS collected
      FROM "SalePayment" sp
      JOIN "PaymentMethod" pm ON pm."id" = sp."paymentMethodId"
      JOIN "Sale" s ON s."id" = sp."saleId"
      WHERE s."operationalState" = '${SaleOperationalState.CONFIRMED}'
        AND ${whereClause}
      GROUP BY sp."paymentMethodId", pm."name"
    ),
    refunded AS (
      SELECT
        cr."refundMethodId" AS payment_method_id,
        COALESCE(SUM(cr."refundAmount"), 0)::numeric AS refunded
      FROM "ClientReturn" cr
      WHERE cr."state" = 'CONFIRMED'
        AND cr."createdAt" >= $1
        AND cr."createdAt" < $2
      GROUP BY cr."refundMethodId"
    )
    SELECT
      c.payment_method_id,
      c.payment_method_name,
      c.transaction_count,
      c.collected,
      COALESCE(r.refunded, 0) AS refunded,
      (c.collected - COALESCE(r.refunded, 0)) AS net_collected
    FROM collected c
    LEFT JOIN refunded r ON r.payment_method_id = c.payment_method_id
    ORDER BY c.collected DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 4: SALES_BY_PRODUCT
// ---------------------------------------------------------------------------

export function buildSalesByProductQuery(
  range: DateRangeFilter,
  options: { categoryId?: string; topN?: number },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [
    startOfDayUtc(range.dateFrom),
    endOfDayUtcExclusive(range.dateTo),
  ];
  let idx = 3;
  const filters: string[] = [CONFIRMED_SALE_PREDICATE];
  if (options.categoryId) {
    filters.push(`p."categoryId" = $${idx++}`);
    params.push(options.categoryId);
  }
  const whereClause = filters.join(' AND ');
  const limitCap = Math.max(1, options.topN ?? 20);

  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, Math.min(pagination.limit, limitCap));

  const sql = `
    WITH aggregated AS (
      SELECT
        p."id" AS product_id,
        p."commercialName" AS product_name,
        COALESCE(SUM(si."quantity"), 0)::int AS units_sold,
        COALESCE(SUM(si."subtotal"), 0)::numeric AS gross_revenue,
        COALESCE(SUM(si."total"), 0)::numeric AS net_revenue,
        COALESCE(SUM(si."commissionAmount"), 0)::numeric AS commission_amount
      FROM "SaleItem" si
      JOIN "Sale" s ON s."id" = si."saleId"
      JOIN "Product" p ON p."id" = si."productId"
      WHERE ${whereClause}
        AND s."confirmedAt" >= $1
        AND s."confirmedAt" < $2
      GROUP BY p."id", p."commercialName"
    )
    SELECT
      *,
      ROW_NUMBER() OVER (ORDER BY net_revenue DESC) AS rank,
      CASE WHEN SUM(net_revenue) OVER () > 0
           THEN ROUND((net_revenue / SUM(net_revenue) OVER ()) * 100, 2)
           ELSE 0 END::numeric AS contribution_percent
    FROM aggregated
    ORDER BY rank
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 5: SALES_BY_HOUR
// ---------------------------------------------------------------------------

export function buildSalesByHourQuery(
  range: DateRangeFilter,
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params = [
    startOfDayUtc(range.dateFrom),
    endOfDayUtcExclusive(range.dateTo),
    pagination.offset,
    pagination.limit,
  ];
  // Colombia is UTC-5 with no DST.  EXTRACT(HOUR … AT TIME ZONE 'America/Bogota').
  const sql = `
    SELECT
      EXTRACT(HOUR FROM s."confirmedAt" AT TIME ZONE 'America/Bogota')::int AS hour,
      COUNT(*)::int AS transaction_count,
      COALESCE(SUM(s."totalAmount"), 0)::numeric AS total_amount
    FROM "Sale" s
    WHERE ${CONFIRMED_SALE_PREDICATE}
      AND s."confirmedAt" >= $1
      AND s."confirmedAt" < $2
    GROUP BY 1
    ORDER BY 1
    LIMIT $4 OFFSET $3
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 6: SALES_BY_WEEKDAY
// ---------------------------------------------------------------------------

export function buildSalesByWeekdayQuery(
  range: DateRangeFilter,
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params = [
    startOfDayUtc(range.dateFrom),
    endOfDayUtcExclusive(range.dateTo),
    pagination.offset,
    pagination.limit,
  ];
  // DOW: 0=Sunday.  We expose 1..7 with Monday=1 for the UI to translate.
  const sql = `
    SELECT
      EXTRACT(ISODOW FROM s."confirmedAt" AT TIME ZONE 'America/Bogota')::int AS weekday,
      COUNT(*)::int AS transaction_count,
      COALESCE(SUM(s."totalAmount"), 0)::numeric AS total_amount
    FROM "Sale" s
    WHERE ${CONFIRMED_SALE_PREDICATE}
      AND s."confirmedAt" >= $1
      AND s."confirmedAt" < $2
    GROUP BY 1
    ORDER BY 1
    LIMIT $4 OFFSET $3
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 7: INV_CURRENT_STOCK
// ---------------------------------------------------------------------------

export function buildCurrentStockQuery(
  options: {
    categoryId?: string;
    laboratory?: string;
    productId?: string;
    includeInactive?: boolean;
  },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [];
  let idx = 1;
  const filters: string[] = [
    `l."state" = 'ACTIVE'`,
    `l."currentStock" > 0`,
  ];
  if (!options.includeInactive) {
    filters.push(`p."isActive" = true`);
  }
  if (options.categoryId) {
    filters.push(`p."categoryId" = $${idx++}`);
    params.push(options.categoryId);
  }
  if (options.laboratory) {
    filters.push(`p."laboratory" = $${idx++}`);
    params.push(options.laboratory);
  }
  if (options.productId) {
    filters.push(`p."id" = $${idx++}`);
    params.push(options.productId);
  }
  const whereClause = filters.join(' AND ');

  // Current CPP = latest cost history effective now; fall back to 0 when none.
  const cppExpr = `COALESCE((
    SELECT c."cost" FROM "ProductCostHistory" c
    WHERE c."productId" = p."id"
      AND c."effectiveFrom" <= NOW()
      AND (c."effectiveTo" IS NULL OR c."effectiveTo" > NOW())
    ORDER BY c."effectiveFrom" DESC LIMIT 1
  ), 0)::numeric`;

  const priceExpr = `COALESCE((
    SELECT ph."price" FROM "ProductPriceHistory" ph
    WHERE ph."productId" = p."id"
      AND ph."effectiveFrom" <= NOW()
      AND (ph."effectiveTo" IS NULL OR ph."effectiveTo" > NOW())
    ORDER BY ph."effectiveFrom" DESC LIMIT 1
  ), 0)::numeric`;

  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  const sql = `
    SELECT
      p."id" AS product_id,
      p."commercialName" AS product_name,
      c."name" AS category_name,
      p."laboratory",
      ${cppExpr} AS cpp,
      ${priceExpr} AS sale_price,
      COALESCE(SUM(l."currentStock"), 0)::int AS stock,
      (COALESCE(SUM(l."currentStock"), 0) * ${cppExpr})::numeric AS stock_value,
      (COALESCE(SUM(l."currentStock"), 0) <= p."minimumStock") AS low_stock
    FROM "Product" p
    LEFT JOIN "Category" c ON c."id" = p."categoryId"
    LEFT JOIN "Lot" l ON l."productId" = p."id"
    WHERE ${whereClause}
    GROUP BY p."id", p."commercialName", c."name", p."laboratory", p."minimumStock"
    ORDER BY p."commercialName" ASC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 8: INV_EXPIRING_LOTS
// ---------------------------------------------------------------------------

export function buildExpiringLotsQuery(
  options: { daysAhead: number; categoryId?: string; productId?: string },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [options.daysAhead];
  let idx = 2;
  const filters: string[] = [
    `l."state" = 'ACTIVE'`,
    `l."currentStock" > 0`,
    `l."expirationDate" <= (NOW() + ($1 || ' days')::interval)`,
    `l."expirationDate" >= NOW()`,
  ];
  if (options.categoryId) {
    filters.push(`p."categoryId" = $${idx++}`);
    params.push(options.categoryId);
  }
  if (options.productId) {
    filters.push(`p."id" = $${idx++}`);
    params.push(options.productId);
  }
  const whereClause = filters.join(' AND ');

  const cppExpr = `COALESCE((
    SELECT c."cost" FROM "ProductCostHistory" c
    WHERE c."productId" = p."id"
      AND c."effectiveFrom" <= NOW()
      AND (c."effectiveTo" IS NULL OR c."effectiveTo" > NOW())
    ORDER BY c."effectiveFrom" DESC LIMIT 1
  ), 0)::numeric`;

  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  const sql = `
    SELECT
      l."id" AS lot_id,
      l."batchNumber",
      p."commercialName" AS product_name,
      l."currentStock" AS quantity,
      ${cppExpr} AS cpp,
      (l."currentStock" * ${cppExpr})::numeric AS estimated_value,
      l."expirationDate",
      GREATEST(0, (l."expirationDate"::date - CURRENT_DATE)::int) AS days_remaining
    FROM "Lot" l
    JOIN "Product" p ON p."id" = l."productId"
    WHERE ${whereClause}
    ORDER BY l."expirationDate" ASC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 9: INV_EXPIRED_WITH_LOSS
// ---------------------------------------------------------------------------

export function buildExpiredWithLossQuery(
  options: { categoryId?: string; productId?: string },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [];
  let idx = 1;
  const filters: string[] = [
    `l."currentStock" > 0`,
    `l."expirationDate" < CURRENT_DATE`,
    `(l."state" = 'ACTIVE' OR l."state" = 'EXPIRED')`,
  ];
  if (options.categoryId) {
    filters.push(`p."categoryId" = $${idx++}`);
    params.push(options.categoryId);
  }
  if (options.productId) {
    filters.push(`p."id" = $${idx++}`);
    params.push(options.productId);
  }
  const whereClause = filters.join(' AND ');

  const cppExpr = `COALESCE((
    SELECT c."cost" FROM "ProductCostHistory" c
    WHERE c."productId" = p."id"
      AND c."effectiveFrom" <= NOW()
      AND (c."effectiveTo" IS NULL OR c."effectiveTo" > NOW())
    ORDER BY c."effectiveFrom" DESC LIMIT 1
  ), 0)::numeric`;

  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  const sql = `
    SELECT
      l."id" AS lot_id,
      l."batchNumber",
      p."commercialName" AS product_name,
      l."currentStock" AS quantity,
      ${cppExpr} AS cpp,
      (l."currentStock" * ${cppExpr})::numeric AS estimated_loss,
      l."expirationDate"
    FROM "Lot" l
    JOIN "Product" p ON p."id" = l."productId"
    WHERE ${whereClause}
    ORDER BY l."expirationDate" ASC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 10: INV_ROTATION
// ---------------------------------------------------------------------------

export function buildRotationQuery(
  range: DateRangeFilter,
  options: { categoryId?: string; productId?: string },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [
    startOfDayUtc(range.dateFrom),
    endOfDayUtcExclusive(range.dateTo),
  ];
  let idx = 3;
  const filters: string[] = [
    `s."operationalState" = '${SaleOperationalState.CONFIRMED}'`,
  ];
  if (options.categoryId) {
    filters.push(`p."categoryId" = $${idx++}`);
    params.push(options.categoryId);
  }
  if (options.productId) {
    filters.push(`p."id" = $${idx++}`);
    params.push(options.productId);
  }
  const whereClause = filters.join(' AND ');

  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  // Rotation index = units sold / average stock (within the period).
  // Days of inventory = average stock / (units sold / days).  Both clamp
  // division by zero using NULLIF — `0 / 0` returns 0 in both cases.
  const sql = `
    WITH sales AS (
      SELECT
        p."id" AS product_id,
        p."commercialName" AS product_name,
        COALESCE(SUM(si."quantity"), 0)::int AS units_sold
      FROM "SaleItem" si
      JOIN "Sale" s ON s."id" = si."saleId"
      JOIN "Product" p ON p."id" = si."productId"
      WHERE ${whereClause}
        AND s."confirmedAt" >= $1
        AND s."confirmedAt" < $2
      GROUP BY p."id", p."commercialName"
    ),
    opening AS (
      SELECT "productId" AS product_id, COALESCE(SUM("currentStock"), 0)::int AS stock
      FROM "Lot"
      WHERE "createdAt" < $1
      GROUP BY "productId"
    ),
    closing AS (
      SELECT "productId" AS product_id, COALESCE(SUM("currentStock"), 0)::int AS stock
      FROM "Lot"
      WHERE "createdAt" < $2
      GROUP BY "productId"
    )
    SELECT
      s.product_id,
      s.product_name,
      s.units_sold,
      COALESCE(o.stock, 0) AS opening_stock,
      COALESCE(c.stock, 0) AS closing_stock,
      ((COALESCE(o.stock, 0) + COALESCE(c.stock, 0)) / 2.0)::numeric AS average_stock,
      CASE WHEN COALESCE(c.stock, 0) > 0
           THEN s.units_sold::numeric / NULLIF(((COALESCE(o.stock, 0) + COALESCE(c.stock, 0)) / 2.0), 0)
           ELSE 0 END AS rotation_index,
      CASE WHEN s.units_sold > 0
           THEN NULLIF(((COALESCE(o.stock, 0) + COALESCE(c.stock, 0)) / 2.0), 0) / (s.units_sold::numeric / GREATEST(1, ($2::date - $1::date + 1)))
           ELSE NULL END AS days_of_inventory
    FROM sales s
    LEFT JOIN opening o USING (product_id)
    LEFT JOIN closing c USING (product_id)
    ORDER BY rotation_index DESC NULLS LAST
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 11: INV_LOW_MOVEMENT
// ---------------------------------------------------------------------------

export function buildLowMovementQuery(
  options: { daysWithoutMovement: number; categoryId?: string },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [options.daysWithoutMovement];
  let idx = 2;
  const filters: string[] = [
    `l."state" = 'ACTIVE'`,
    `l."currentStock" > 0`,
  ];
  if (options.categoryId) {
    filters.push(`p."categoryId" = $${idx++}`);
    params.push(options.categoryId);
  }
  const whereClause = filters.join(' AND ');

  const cppExpr = `COALESCE((
    SELECT c."cost" FROM "ProductCostHistory" c
    WHERE c."productId" = p."id"
      AND c."effectiveFrom" <= NOW()
      AND (c."effectiveTo" IS NULL OR c."effectiveTo" > NOW())
    ORDER BY c."effectiveFrom" DESC LIMIT 1
  ), 0)::numeric`;

  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  // Lots that have had no `InventoryMovement` in the last N days.
  const sql = `
    SELECT
      p."id" AS product_id,
      p."commercialName" AS product_name,
      COALESCE(SUM(l."currentStock"), 0)::int AS stock,
      ${cppExpr} AS cpp,
      (COALESCE(SUM(l."currentStock"), 0) * ${cppExpr})::numeric AS immobilized_value,
      (SELECT MAX(m."createdAt")
         FROM "InventoryMovement" m
         JOIN "Lot" ml ON ml."id" = m."lotId"
         WHERE ml."productId" = p."id") AS last_movement
    FROM "Product" p
    LEFT JOIN "Lot" l ON l."productId" = p."id"
    WHERE ${whereClause}
    GROUP BY p."id", p."commercialName"
    HAVING
      (SELECT MAX(m."createdAt")
         FROM "InventoryMovement" m
         JOIN "Lot" ml ON ml."id" = m."lotId"
         WHERE ml."productId" = p."id") IS NULL
      OR
      (SELECT MAX(m."createdAt")
         FROM "InventoryMovement" m
         JOIN "Lot" ml ON ml."id" = m."lotId"
         WHERE ml."productId" = p."id")
        < (NOW() - ($1 || ' days')::interval)
    ORDER BY immobilized_value DESC NULLS LAST
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 12: INV_MOVEMENTS
// ---------------------------------------------------------------------------

export function buildInventoryMovementsQuery(
  range: DateRangeFilter,
  options: {
    productId?: string;
    lotId?: string;
    movementType?: MovementType;
    userId?: string;
  },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [
    startOfDayUtc(range.dateFrom),
    endOfDayUtcExclusive(range.dateTo),
  ];
  let idx = 3;
  const filters: string[] = [
    `m."createdAt" >= $1`,
    `m."createdAt" < $2`,
  ];
  if (options.productId) {
    filters.push(`p."id" = $${idx++}`);
    params.push(options.productId);
  }
  if (options.lotId) {
    filters.push(`l."id" = $${idx++}`);
    params.push(options.lotId);
  }
  if (options.movementType) {
    filters.push(`m."movementType" = $${idx++}::"MovementType"`);
    params.push(options.movementType);
  }
  if (options.userId) {
    filters.push(`m."createdById" = $${idx++}`);
    params.push(options.userId);
  }
  const whereClause = filters.join(' AND ');

  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  const sql = `
    SELECT
      m."id" AS movement_id,
      m."createdAt",
      p."commercialName" AS product_name,
      l."batchNumber",
      m."movementType"::text AS movement_type,
      m."quantity",
      m."previousStock",
      m."resultingStock",
      COALESCE(NULLIF(u."displayName", ''), u."username", m."createdById") AS created_by_name
    FROM "InventoryMovement" m
    JOIN "Lot" l ON l."id" = m."lotId"
    JOIN "Product" p ON p."id" = l."productId"
    LEFT JOIN "User" u ON u."id" = m."createdById"
    WHERE ${whereClause}
    ORDER BY m."createdAt" DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 13: FISCAL_TAX_SUMMARY
// ---------------------------------------------------------------------------

export function buildFiscalTaxSummaryQuery(
  range: DateRangeFilter,
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params = [
    startOfDayUtc(range.dateFrom),
    endOfDayUtcExclusive(range.dateTo),
    pagination.offset,
    pagination.limit,
  ];
  // Sale items carry `taxRate` (decimal 0..1); the tax type lives on
  // the current ProductTaxHistory.taxScheme.  We group by scheme name
  // for the "IVA 19%", "EXENTO", "INC" rows.
  const sql = `
    SELECT
      ts."name" AS tax_type,
      COALESCE(SUM(si."subtotal" - si."discountAmount"), 0)::numeric AS taxable_base,
      COALESCE(SUM(si."taxAmount"), 0)::numeric AS tax_amount
    FROM "SaleItem" si
    JOIN "Sale" s ON s."id" = si."saleId"
    JOIN "Product" p ON p."id" = si."productId"
    LEFT JOIN "ProductTaxHistory" pth
      ON pth."productId" = p."id"
      AND pth."effectiveFrom" <= NOW()
      AND (pth."effectiveTo" IS NULL OR pth."effectiveTo" > NOW())
    LEFT JOIN "TaxScheme" ts ON ts."id" = pth."taxSchemeId"
    WHERE s."operationalState" = '${SaleOperationalState.CONFIRMED}'
      AND s."confirmedAt" >= $1
      AND s."confirmedAt" < $2
    GROUP BY ts."name"
    ORDER BY tax_amount DESC
    LIMIT $4 OFFSET $3
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 14: FISCAL_DIAN_DOCUMENTS
// ---------------------------------------------------------------------------

export function buildFiscalDianDocumentsQuery(
  range: DateRangeFilter,
  options: { status?: string; invoiceType?: string },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [
    startOfDayUtc(range.dateFrom),
    endOfDayUtcExclusive(range.dateTo),
  ];
  let idx = 3;
  const filters: string[] = [
    `i."issuedAt" >= $1`,
    `i."issuedAt" < $2`,
  ];
  if (options.status) {
    filters.push(`i."status" = $${idx++}::"InvoiceStatus"`);
    params.push(options.status);
  }
  if (options.invoiceType) {
    filters.push(`i."invoiceType" = $${idx++}::"InvoiceType"`);
    params.push(options.invoiceType);
  }
  const whereClause = filters.join(' AND ');

  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  const sql = `
    SELECT
      i."id" AS invoice_id,
      i."invoiceNumber",
      i."invoiceType"::text AS invoice_type,
      i."issuedAt",
      i."status"::text AS status,
      COALESCE(i."cufeOfficial", i."cufeProvisional") AS cufe
    FROM "Invoice" i
    WHERE ${whereClause}
    ORDER BY i."issuedAt" DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 15: CASH_SHIFT_CLOSE
// ---------------------------------------------------------------------------

export function buildCashShiftCloseQuery(shiftId: string): QueryFragment {
  // No date range — the shift id alone is the filter.  Returns the shift
  // header and one row per payment-method CLOSING count.
  return {
    sql: `
      SELECT
        cs."id" AS shift_id,
        cs."workstationId",
        cs."userId" AS cashier_user_id,
        cs."openedAt",
        cs."closedAt",
        cs."openingBalance"::numeric,
        cs."expectedClosingAmount"::numeric,
        cs."actualClosingAmount"::numeric,
        cs."closingDifference"::numeric,
        cs."closingNotes",
        pm."name" AS payment_method_name,
        scc."expectedAmount"::numeric AS "expectedAmount",
        scc."declaredAmount"::numeric AS "declaredAmount",
        scc."difference"::numeric AS difference,
        scc."paymentMethodIsCash" AS is_cash
      FROM "CashShift" cs
      LEFT JOIN "ShiftCashCount" scc ON scc."cashShiftId" = cs."id" AND scc."countType" = 'CLOSING'
      LEFT JOIN "PaymentMethod" pm ON pm."id" = scc."paymentMethodId"
      WHERE cs."id" = $1
      ORDER BY pm."name" ASC
    `,
    params: [shiftId],
  };
}

// ---------------------------------------------------------------------------
// Report 16: AUDIT_SHIFT_VARIANCES
// ---------------------------------------------------------------------------

export function buildAuditShiftVariancesQuery(
  range: DateRangeFilter,
  options: { cashierUserId?: string },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [
    startOfDayUtc(range.dateFrom),
    endOfDayUtcExclusive(range.dateTo),
  ];
  let idx = 3;
  const filters: string[] = [
    `cs."state" IN ('CLOSED', 'FORCED_CLOSE')`,
    `cs."closingDifference" <> 0`,
    `cs."closedAt" >= $1`,
    `cs."closedAt" < $2`,
  ];
  if (options.cashierUserId) {
    filters.push(`cs."userId" = $${idx++}`);
    params.push(options.cashierUserId);
  }
  const whereClause = filters.join(' AND ');
  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  const sql = `
    SELECT
      cs."id" AS shift_id,
      cs."closedAt",
      COALESCE(NULLIF(u."displayName", ''), u."username", cs."userId") AS cashier_name,
      cs."closingDifference"::numeric AS total_variance
    FROM "CashShift" cs
    LEFT JOIN "User" u ON u."id" = cs."userId"
    WHERE ${whereClause}
    ORDER BY ABS(cs."closingDifference") DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 17: AUDIT_TRACEABILITY
// ---------------------------------------------------------------------------

export function buildAuditTraceabilityQuery(
  range: DateRangeFilter,
  options: { userId?: string; category?: string; actionPrefix?: string },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [
    startOfDayUtc(range.dateFrom),
    endOfDayUtcExclusive(range.dateTo),
  ];
  let idx = 3;
  const filters: string[] = [
    `l."createdAt" >= $1`,
    `l."createdAt" < $2`,
  ];
  if (options.userId) {
    filters.push(`l."userId" = $${idx++}`);
    params.push(options.userId);
  }
  if (options.category) {
    filters.push(`l."category" = $${idx++}`);
    params.push(options.category);
  }
  if (options.actionPrefix) {
    filters.push(`l."action" LIKE $${idx++}`);
    params.push(`${options.actionPrefix}%`);
  }
  const whereClause = filters.join(' AND ');

  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  const sql = `
    SELECT
      l."id" AS audit_id,
      l."createdAt",
      l."action",
      l."category",
      l."entityType",
      l."entityId",
      COALESCE(NULLIF(u."displayName", ''), u."username", l."userId") AS user_name,
      l."userRole"
    FROM "LocalAuditLog" l
    LEFT JOIN "User" u ON u."id" = l."userId"
    WHERE ${whereClause}
    ORDER BY l."createdAt" DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Report 18: PROFIT_MARGIN_BY_PRODUCT
// ---------------------------------------------------------------------------

export function buildProfitMarginQuery(
  range: DateRangeFilter,
  options: { categoryId?: string; productId?: string },
  pagination: { limit: number; offset: number },
): QueryFragment {
  const params: unknown[] = [
    startOfDayUtc(range.dateFrom),
    endOfDayUtcExclusive(range.dateTo),
  ];
  let idx = 3;
  const filters: string[] = [
    `s."operationalState" = '${SaleOperationalState.CONFIRMED}'`,
  ];
  if (options.categoryId) {
    filters.push(`p."categoryId" = $${idx++}`);
    params.push(options.categoryId);
  }
  if (options.productId) {
    filters.push(`p."id" = $${idx++}`);
    params.push(options.productId);
  }
  const whereClause = filters.join(' AND ');

  const cppExpr = `COALESCE((
    SELECT c."cost" FROM "ProductCostHistory" c
    WHERE c."productId" = p."id"
      AND c."effectiveFrom" <= NOW()
      AND (c."effectiveTo" IS NULL OR c."effectiveTo" > NOW())
    ORDER BY c."effectiveFrom" DESC LIMIT 1
  ), 0)::numeric`;

  const priceExpr = `COALESCE((
    SELECT ph."price" FROM "ProductPriceHistory" ph
    WHERE ph."productId" = p."id"
      AND ph."effectiveFrom" <= NOW()
      AND (ph."effectiveTo" IS NULL OR ph."effectiveTo" > NOW())
    ORDER BY ph."effectiveFrom" DESC LIMIT 1
  ), 0)::numeric`;

  const offsetParam = idx++;
  const limitParam = idx++;
  params.push(pagination.offset, pagination.limit);

  const sql = `
    WITH sold AS (
      SELECT
        si."productId" AS product_id,
        COALESCE(SUM(si."quantity"), 0)::int AS units_sold,
        COALESCE(SUM(si."total"), 0)::numeric AS revenue,
        COALESCE(SUM(si."quantity" * ${cppExpr}), 0)::numeric AS estimated_cost
      FROM "SaleItem" si
      JOIN "Sale" s ON s."id" = si."saleId"
      JOIN "Product" p ON p."id" = si."productId"
      WHERE ${whereClause}
        AND s."confirmedAt" >= $1
        AND s."confirmedAt" < $2
      GROUP BY si."productId"
    )
    SELECT
      p."id" AS product_id,
      p."commercialName" AS product_name,
      ${cppExpr} AS cpp,
      ${priceExpr} AS sale_price,
      so.units_sold,
      so.revenue,
      so.estimated_cost,
      (so.revenue - so.estimated_cost)::numeric AS gross_profit,
      CASE WHEN ${priceExpr} > 0
           THEN ((${priceExpr} - ${cppExpr}) / ${priceExpr}) * 100
           ELSE 0 END AS gross_margin_percent
    FROM sold so
    JOIN "Product" p ON p."id" = so.product_id
    ORDER BY gross_profit DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Aggregate helpers (used for KPI cards / chart data)
// ---------------------------------------------------------------------------

/** Count pending sync operations for the freshness banner. */
export function buildPendingOpsCountQuery(): QueryFragment {
  return {
    sql: `
      SELECT
        COUNT(*) FILTER (WHERE "status" = 'PENDING')::int AS pending,
        COUNT(*) FILTER (WHERE "status" = 'PERMANENT_FAILURE')::int AS permanent_failures,
        MAX("clientSequence")::text AS max_seq,
        MAX(CASE WHEN "status" = 'COMPLETED' THEN "sourceCreatedAt" END) AS last_completed_at,
        MAX(CASE WHEN "status" = 'FAILED' THEN "sourceCreatedAt" END) AS last_failed_at
      FROM "SyncQueue"
    `,
    params: [],
  };
}

/** Compute the totals row for a report, ignoring pagination.
 *  Caller passes the same params used for the data query.  When the query
 *  ends with a LIMIT/OFFSET tail the last two params (offset, limit) are
 *  stripped so the count reuses every filter placeholder; queries without
 *  a pagination tail (e.g. CASH_SHIFT_CLOSE) keep their params untouched,
 *  otherwise their placeholders would be left unbound. */
export function buildCountQuery(
  baseQuery: QueryFragment,
  countExpr: string,
  dataParams: unknown[],
): QueryFragment {
  const inner = baseQuery.sql.replace(/LIMIT\s+\$\d+\s+OFFSET\s+\$\d+\s*$/iu, '');
  const strippedPagination = inner !== baseQuery.sql;
  return {
    sql: `SELECT ${countExpr} AS total FROM (${inner}) AS count_subquery`,
    params: strippedPagination
      ? dataParams.slice(0, Math.max(0, dataParams.length - 2))
      : dataParams,
  };
}

// Reference for `Prisma` namespace usage — keeps the import alive in
// case future builders need a `Prisma.sql` template tag.
export { Prisma };
