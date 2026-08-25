import { PrismaService } from '@/infrastructure/prisma/prisma.service';

/**
 * Resolves the ids of `table` rows where any of `columns` matches `term`
 * case-insensitively AND accent-insensitively ("Dolex" finds "Dólex").
 *
 * Uses the immutable f_unaccent(text) wrapper created by migration
 * 20260825000005, which backs GIN trigram expression indexes — plain
 * Prisma `contains` cannot express that predicate, hence raw SQL.
 *
 * Only the search predicate is raw: callers feed the returned id set back
 * into their normal typed Prisma filters (`where.id = { in: ids }`), so
 * every other condition keeps its existing index path. Identifiers are
 * developer-controlled literals validated below; the term itself is always
 * a bound parameter.
 */
const IDENTIFIER_GUARD = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function searchIdsIgnoringAccents(
  prisma: PrismaService,
  table: string,
  columns: string[],
  term: string,
  maxIds = 5000,
): Promise<string[]> {
  if (!IDENTIFIER_GUARD.test(table)) {
    throw new Error(`Invalid table identifier: ${table}`);
  }
  if (columns.length === 0 || !columns.every((c) => IDENTIFIER_GUARD.test(c))) {
    throw new Error(`Invalid column identifiers: ${columns.join(', ')}`);
  }

  const pattern = `%${term}%`;
  // $queryRawUnsafe because the clause count depends on `columns`; the
  // placeholders stay fully bound ($1..$n) and identifiers are guarded above.
  const params: unknown[] = [];
  const clauses = columns.map((column) => {
    params.push(pattern);
    return `f_unaccent("${column}") ILIKE $${params.length}`;
  });
  const sql = `SELECT id FROM "${table}" WHERE ${clauses.join(' OR ')} LIMIT ${maxIds}`;

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    sql,
    ...params,
  );
  return rows.map((r) => r.id);
}
