/**
 * Cursor-based pagination helper.
 *
 * Produces an opaque `nextCursor` that clients pass back to continue
 * the pagination. Uses compound (updatedAt, id) keyset pagination,
 * efficient with a compound index on both fields.
 *
 * Usage:
 * ```ts
 * const { items, nextCursor, hasMore } = await paginateWithCursor({
 *   model: prisma.product,
 *   where: { isActive: true },
 *   limit: 200,
 *   cursor,          // from request query
 *   orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
 * });
 * ```
 *
 * The cursor is opaque to clients: encode(decode) round-trips inside the
 * server but clients store and return the raw string.
 */

export interface CursorPaginationInput<Where, OrderBy> {
  /** Prisma delegate (e.g. prisma.product, prisma.lot). */
  model: {
    findMany: (args: {
      where?: Where;
      orderBy?: OrderBy | OrderBy[];
      take?: number;
      cursor?: { id: string };
      skip?: number;
      select?: Record<string, unknown>;
    }) => Promise<unknown[]>;
    count: (args: { where?: Where }) => Promise<number>;
  };
  /** Prisma where clause. */
  where?: Where;
  /** Sort order. Must include (updatedAt, id) for cursor consistency. */
  orderBy?: OrderBy | OrderBy[];
  /** Max items per page (default 200). */
  limit?: number;
  /** Opaque cursor string from a previous response, or undefined for first page. */
  cursor?: string | null;
  /** Optional base where to merge with cursor conditions. */
  baseWhere?: Where;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

interface CursorValue {
  lastUpdatedAt: string;
  lastId: string;
}

/**
 * Encode cursor data into an opaque string.
 */
function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

/**
 * Decode an opaque cursor string, or return null for invalid/missing.
 */
function decodeCursor(raw: string | null | undefined): CursorValue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (typeof parsed.lastUpdatedAt === 'string' && typeof parsed.lastId === 'string') {
      return parsed as CursorValue;
    }
    return null;
  } catch {
    return null;
  }
}

export async function paginateWithCursor<T, Where = Record<string, unknown>, OrderBy = Record<string, 'asc' | 'desc'>>(
  input: CursorPaginationInput<Where, OrderBy>,
): Promise<CursorPage<T>> {
  const { model, orderBy, limit = 200, cursor, baseWhere } = input;
  const cursorValue = decodeCursor(cursor);

  // Build the where clause
  const where: Record<string, unknown> = { ...(baseWhere ?? {}) };

  if (cursorValue) {
    // Compound cursor condition: (updatedAt > lastUpdatedAt) OR (updatedAt = lastUpdatedAt AND id > lastId)
    where.OR = [
      { updatedAt: { gt: new Date(cursorValue.lastUpdatedAt) } },
      {
        updatedAt: new Date(cursorValue.lastUpdatedAt),
        id: { gt: cursorValue.lastId },
      },
    ];
  } else if (input.where) {
    // No cursor — use input where directly
    Object.assign(where, input.where);
  }

  // Ensure consistent ordering for cursor pagination
  const effectiveOrderBy = orderBy ?? [{ updatedAt: 'asc' as const }, { id: 'asc' as const }] as any;

  // Fetch limit + 1 to detect if there are more items
  const items = await model.findMany({
    // `where` is built as a plain record but the delegate expects `Where`
    where: where as Where,
    orderBy: effectiveOrderBy,
    take: limit + 1,
  });

  const hasMore = (items as T[]).length > limit;
  const resultItems = hasMore ? (items as T[]).slice(0, limit) : (items as T[]);

  // Build next cursor from the last item
  let nextCursor: string | null = null;
  if (hasMore && resultItems.length > 0) {
    const last = resultItems[resultItems.length - 1] as Record<string, unknown>;
    const lastUpdatedAt = last.updatedAt;
    const lastId = last.id;
    if (lastUpdatedAt && lastId) {
      nextCursor = encodeCursor({
        lastUpdatedAt: lastUpdatedAt instanceof Date ? lastUpdatedAt.toISOString() : String(lastUpdatedAt),
        lastId: String(lastId),
      });
    }
  }

  return {
    items: resultItems as T[],
    nextCursor,
    hasMore,
  };
}
