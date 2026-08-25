/**
 * Cursor-based pagination helper.
 *
 * Produces an opaque `nextCursor` that clients pass back to continue
 * the pagination. Uses compound (timeField, id) keyset pagination,
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

/**
 * Timestamp DateTime column the keyset walks (createdAt, updatedAt,
 * startedAt, issueDate, revokedAt, ...). Must exist on the model and match
 * the first entry of orderBy.
 */
export type CursorTimeField = string;

export interface CursorPaginationInput<Where, OrderBy, Include = undefined> {
  /** Prisma delegate (e.g. prisma.product, prisma.lot). */
  model: {
    findMany: (args: {
      where?: Where;
      orderBy?: OrderBy | OrderBy[];
      take?: number;
      cursor?: { id: string };
      skip?: number;
      select?: Record<string, unknown>;
      include?: Include;
    }) => Promise<unknown[]>;
    count: (args: { where?: Where }) => Promise<number>;
  };
  /** Prisma where clause. */
  where?: Where;
  /** Where merged before cursor conditions (used by callers that always filter). */
  baseWhere?: Where;
  /**
   * Timestamp field the keyset walks. Must exist on the model and match the
   * first entry of orderBy. Defaults to updatedAt (models without it, like
   * append-only ledgers, pass createdAt).
   */
  timeField?: CursorTimeField;
  /**
   * Sort direction of the keyset walk. Must match the first entry of
   * orderBy. Defaults to asc.
   */
  direction?: 'asc' | 'desc';
  /** Sort order. Must start with (timeField, id) for cursor consistency. */
  orderBy?: OrderBy | OrderBy[];
  /** Max items per page (default 200). */
  limit?: number;
  /** Opaque cursor string from a previous response, or undefined for first page. */
  cursor?: string | null;
  /** Prisma include, forwarded verbatim to findMany. */
  include?: Include;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

interface CursorValue {
  // Key names are historical (the payload is opaque to clients): they hold
  // whatever timestamp field timeField points at, not literally updatedAt.
  lastUpdatedAt: string;
  lastId: string;
}

/** Hard ceiling so a client cannot request an unbounded page via the cursor path. */
const CURSOR_LIMIT_CEILING = 500;

/**
 * Encode cursor data into an opaque string.
 */
function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

/**
 * Decode an opaque cursor string, or return null for invalid/missing.
 * A well-shaped payload whose timestamp is not a parseable date is also
 * rejected, so garbage cursors fall back to the first page instead of
 * reaching Prisma with an Invalid Date.
 */
function decodeCursor(raw: string | null | undefined): CursorValue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (
      typeof parsed.lastUpdatedAt === 'string' &&
      typeof parsed.lastId === 'string' &&
      !Number.isNaN(new Date(parsed.lastUpdatedAt).getTime())
    ) {
      return parsed as CursorValue;
    }
    return null;
  } catch {
    return null;
  }
}

export async function paginateWithCursor<
  T,
  Where = Record<string, unknown>,
  OrderBy = Record<string, 'asc' | 'desc'>,
  Include = undefined,
>(
  input: CursorPaginationInput<Where, OrderBy, Include>,
): Promise<CursorPage<T>> {
  const {
    model,
    orderBy,
    limit = 200,
    cursor,
    baseWhere,
    timeField = 'updatedAt',
    direction = 'asc',
    include,
  } = input;
  const cursorValue = decodeCursor(cursor);
  // Merge both filter inputs up front: dropping `where` whenever a cursor is
  // present would silently unfilter continuation pages for callers that pass
  // filters via `where` instead of `baseWhere`.
  const where: Record<string, unknown> = {
    ...(baseWhere ?? {}),
    ...(input.where ?? {}),
  };

  if (cursorValue) {
    // Compound cursor condition: continue strictly after (or before, for
    // desc) the (timeField, id) position the cursor encodes.
    const lastTime = new Date(cursorValue.lastUpdatedAt);
    const timeCmp = direction === 'desc' ? 'lt' : 'gt';
    const idCmp = direction === 'desc' ? 'lt' : 'gt';
    where.OR = [
      { [timeField]: { [timeCmp]: lastTime } },
      {
        [timeField]: lastTime,
        id: { [idCmp]: cursorValue.lastId },
      },
    ];
  }

  // Ensure consistent ordering for cursor pagination
  const effectiveOrderBy =
    orderBy ??
    ([{ [timeField]: direction }, { id: direction }] as unknown as OrderBy[]);

  const effectiveLimit = Math.min(limit, CURSOR_LIMIT_CEILING);

  // Fetch limit + 1 to detect if there are more items
  const items = await model.findMany({
    // `where` is built as a plain record but the delegate expects `Where`
    where: where as Where,
    orderBy: effectiveOrderBy,
    take: effectiveLimit + 1,
    ...(include !== undefined ? { include } : {}),
  });

  const hasMore = (items as T[]).length > effectiveLimit;
  const resultItems = hasMore
    ? (items as T[]).slice(0, effectiveLimit)
    : (items as T[]);

  // Build next cursor from the last item
  let nextCursor: string | null = null;
  if (hasMore && resultItems.length > 0) {
    const last = resultItems[resultItems.length - 1] as Record<string, unknown>;
    const lastTime = last[timeField];
    const lastId = last.id;
    if (lastTime && lastId) {
      nextCursor = encodeCursor({
        lastUpdatedAt:
          lastTime instanceof Date ? lastTime.toISOString() : String(lastTime),
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
