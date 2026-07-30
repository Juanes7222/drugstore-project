/**
 * Local report aggregations service.
 *
 * Pure database layer: takes a `QueryFragment`, executes it against the
 * local PGlite database, and returns a normalized `ReportQueryResult`.
 *
 * The execution service calls into this class.  It never throws on
 * "no data" — empty result sets produce a successful response with
 * zero rows.  Database errors propagate to the execution service which
 * wraps them as `ReportExecutionException`.
 *
 * ## Column key normalization
 *
 * SQL queries return column names in snake_case.  The report catalog
 * defines column IDs in camelCase.  The `normalizeRowKeys()` transform
 * adds camelCase aliases alongside each snake_case key so the table
 * renderer (which does `row[col.id]`) can find the right value without
 * every caller needing to map keys manually.
 *
 * The original snake_case keys are preserved so chart builders and KPI
 * aggregate helpers that access rows directly continue to work without
 * changes.
 */

import type { PrismaClient } from '@pharmacy/database/local';
import type { QueryFragment } from './report-query-builders';
import { buildCountQuery } from './report-query-builders';

export interface ReportQueryResult {
  rows: Record<string, unknown>[];
  total: number;
}

// ---------------------------------------------------------------------------
// Snake → camelCase helper
// ---------------------------------------------------------------------------

/** Convert a snake_case string to camelCase.  Idempotent — already-camelCase
 *  keys and single-word keys are returned unchanged. */
function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Add camelCase aliases for every snake_case key in a row.  The original
 *  snake_case keys are kept intact so existing code that accesses them
 *  directly does not break. */
function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...row };
  for (const key of Object.keys(row)) {
    const camel = snakeToCamel(key);
    if (camel !== key) {
      normalized[camel] = row[key];
    }
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReportAggregationsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Execute the query and return paginated rows + total count.
   *
   * Uses the raw `prisma.$queryRawUnsafe` API because the queries are
   * built with `Prisma`-style placeholders but contain Postgres-specific
   * expressions (`date_trunc`, `AT TIME ZONE`, etc.) that the Prisma
   * query builder does not model.  Inputs are already bound through
   * placeholders by the builder — no string interpolation happens here.
   *
   * Row keys are normalized: each snake_case column gets an additional
   * camelCase alias so the catalog-based table renderer can look up
   * values by `col.id`.  The original snake_case keys are preserved
   * for direct access by chart builders and aggregate helpers.
   */
  async run(
    fragment: QueryFragment,
    options: { count?: boolean } = { count: true },
  ): Promise<ReportQueryResult> {
    const rawRows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      fragment.sql,
      ...fragment.params,
    );
    const rows = (rawRows ?? []).map(normalizeRowKeys);
    if (!options.count) {
      return { rows, total: rows.length };
    }
    const countFragment = buildCountQuery(fragment, 'COUNT(*)', fragment.params);
    const countResult = await this.prisma.$queryRawUnsafe<Array<{ total: number | bigint }>>(
      countFragment.sql,
      ...countFragment.params,
    );
    const total = Number(countResult?.[0]?.total ?? 0);
    return { rows, total };
  }

  /** Execute a fragment that returns a single aggregate (e.g. pending ops). */
  async runScalar<R = Record<string, unknown>>(fragment: QueryFragment): Promise<R | null> {
    const result = await this.prisma.$queryRawUnsafe<R[]>(fragment.sql, ...fragment.params);
    return result?.[0] ?? null;
  }
}
