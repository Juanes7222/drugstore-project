/**
 * Local audit service — queries local audit entries from two sources:
 *
 * 1. **`LocalAuditLog` table** — events explicitly written by domain services
 *    (cash-shift, sales, auth, sync, etc.). Covers everything that doesn't
 *    already have a dedicated table.
 * 2. **`InventoryMovement` table** (legacy) — stock mutations that already
 *    existed before LocalAuditLog was introduced. Kept as-is because every
 *    stock mutation already writes an InventoryMovement row inside the same
 *    transaction.
 *
 * ## Design rationale
 *
 * The server-side `AuditLog` model lives under `prisma/schema-source/
 * server-only/` and is excluded from the local Prisma build. Rather than
 * moving it into shared schema (which would couple the two sides), we read
 * from local-only `LocalAuditLog` for non-inventory events and from the
 * already-existing `InventoryMovement` for stock events.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { PrismaClient } from '@pharmacy/database/local';

// ---------------------------------------------------------------------------
// Types — mirror the shape audit-log-view.tsx / audit-event-card.tsx expects
// ---------------------------------------------------------------------------

export interface LocalAuditEntry {
  id: string;
  action: string;
  createdAt: string;
  userId?: string;
  userRole?: string | null;
  entityType?: string;
  entityId?: string;
  details?: string | null;
  /** Extra fields not in the server shape — for richer rendering */
  productName?: string;
  lotBatch?: string;
}

/**
 * Filter shape accepted by `getLocalAuditEntries`.
 *
 * When `module` is set to a specific domain it dispatches to the
 * corresponding reader (InventoryMovement for INVENTORY, LocalAuditLog
 * for everything else).  When omitted it reads from LocalAuditLog only.
 */
export interface LocalAuditQuery {
  /** Domain module to scope the query to. */
  module?:
    | 'INVENTORY'
    | 'CASH_SHIFT'
    | 'SALES'
    | 'AUTH'
    | 'SYNC'
    | 'CLIENTS'
    | 'PRESCRIPTIONS'
    | 'PURCHASES'
    | 'FISCAL';
  /** LocalAuditLog category filter (e.g. "cash_shift", "sale"). */
  category?: string;
  /** Specific audit action filter (e.g. "CASH_SHIFT_OPENED"). */
  action?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface LocalAuditResponse {
  rows: LocalAuditEntry[];
  total: number;
}

// ---------------------------------------------------------------------------
// Module → LocalAuditLog category mapping
// ---------------------------------------------------------------------------

const MODULE_CATEGORY_MAP: Record<string, string> = {
  CASH_SHIFT: 'cash_shift',
  SALES: 'sale',
  AUTH: 'auth',
  SYNC: 'sync',
  CLIENTS: 'client',
  PRESCRIPTIONS: 'prescription',
  PURCHASES: 'purchase',
  FISCAL: 'fiscal',
};

// ---------------------------------------------------------------------------
// Movement type → human-readable action label
// ---------------------------------------------------------------------------

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  PURCHASE_RECEIPT: 'INVENTORY_PURCHASE_RECEIPT',
  SALE: 'INVENTORY_SALE',
  POSITIVE_ADJUSTMENT: 'INVENTORY_ADJUSTMENT_POSITIVE',
  NEGATIVE_ADJUSTMENT: 'INVENTORY_ADJUSTMENT_NEGATIVE',
  CLIENT_RETURN: 'INVENTORY_CLIENT_RETURN',
  SUPPLIER_RETURN: 'INVENTORY_SUPPLIER_RETURN',
  ADMIN_BLOCK: 'INVENTORY_ADMIN_BLOCK',
  ADMIN_UNBLOCK: 'INVENTORY_ADMIN_UNBLOCK',
  AUTO_EXPIRATION: 'INVENTORY_AUTO_EXPIRATION',
  PHYSICAL_COUNT: 'INVENTORY_PHYSICAL_COUNT',
  INITIAL_STOCK: 'INVENTORY_INITIAL_STOCK',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch local audit entries, dispatching to the appropriate reader based
 * on the `module` filter.
 *
 * - `module === 'INVENTORY'` → reads from `InventoryMovement` (legacy)
 * - other module or none → reads from `LocalAuditLog`
 */
export async function getLocalAuditEntries(
  prisma: PrismaClient,
  query: LocalAuditQuery = {},
  client?: PGlite,
): Promise<LocalAuditResponse> {
  if (query.module === 'INVENTORY') {
    if (!client) {
      throw new Error(
        'getLocalAuditEntries: PGlite client is required for INVENTORY module',
      );
    }
    return getInventoryMovements(client, query);
  }

  return getFromLocalAuditLog(prisma, query);
}

// ---------------------------------------------------------------------------
// LocalAuditLog reader
// ---------------------------------------------------------------------------

async function getFromLocalAuditLog(
  prisma: PrismaClient,
  query: LocalAuditQuery,
): Promise<LocalAuditResponse> {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  // Build Prisma where
  const where: Record<string, unknown> = {};

  // Map module to category
  const category = query.category ?? (
    query.module ? MODULE_CATEGORY_MAP[query.module] : undefined
  );
  if (category) {
    where.category = category;
  }

  if (query.action) {
    where.action = query.action;
  }

  if (query.fromDate || query.toDate) {
    const createdAt: Record<string, Date | string> = {};
    if (query.fromDate) {
      createdAt.gte = query.fromDate;
    }
    if (query.toDate) {
      createdAt.lte = query.toDate + 'T23:59:59.999Z';
    }
    where.createdAt = createdAt;
  }

  const [rows, total] = await Promise.all([
    (prisma as any).localAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' as const },
      take: limit,
      skip: offset,
    }),
    (prisma as any).localAuditLog.count({ where }),
  ]);

  return {
    rows: rows.map((r: any) => ({
      id: r.id,
      action: r.action,
      createdAt: r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : String(r.createdAt),
      userId: r.userId ?? undefined,
      userRole: r.userRole ?? null,
      entityType: r.entityType ?? undefined,
      entityId: r.entityId ?? undefined,
      details: r.details ?? null,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// InventoryMovement reader (legacy)
// ---------------------------------------------------------------------------

/**
 * Fetch inventory movements as local audit entries.
 *
 * Uses raw SQL through Prisma so we can join Lot + Product in a single
 * round-trip without depending on generated `include` types for every
 * relation path.
 */
async function getInventoryMovements(
  client: PGlite,
  query: LocalAuditQuery,
): Promise<LocalAuditResponse> {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  // Build WHERE clause
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (query.action) {
    // Reverse-lookup: find movementType key by its label
    const movementType = Object.entries(MOVEMENT_TYPE_LABELS)
      .find(([, label]) => label === query.action)?.[0];
    if (movementType) {
      conditions.push(`im."movementType" = $${paramIdx++}`);
      params.push(movementType);
    }
  }

  if (query.fromDate) {
    conditions.push(`im."createdAt" >= $${paramIdx++}`);
    params.push(query.fromDate);
  }
  if (query.toDate) {
    conditions.push(`im."createdAt" <= $${paramIdx++}`);
    params.push(query.toDate + 'T23:59:59.999Z');
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // Count query
  const countResult = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM "InventoryMovement" im ${whereClause}`,
    params,
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  // Data query
  type MovementRow = {
    id: string;
    movement_type: string;
    quantity: number;
    previous_stock: number;
    resulting_stock: number;
    created_by_id: string;
    created_at: Date;
    lot_id: string;
    reason: string | null;
    batch_number: string | null;
    product_name: string | null;
  };
  const dataResult = await client.query<MovementRow>(
    `SELECT
       im.id,
       im."movementType" AS movement_type,
       im.quantity,
       im."previousStock" AS previous_stock,
       im."resultingStock" AS resulting_stock,
       im."createdById" AS created_by_id,
       im."createdAt" AS created_at,
       im."lotId" AS lot_id,
       im.reason,
       l."batchNumber" AS batch_number,
       p."commercialName" AS product_name
     FROM "InventoryMovement" im
     LEFT JOIN "Lot" l ON l.id = im."lotId"
     LEFT JOIN "Product" p ON p.id = l."productId"
     ${whereClause}
     ORDER BY im."createdAt" DESC
     LIMIT $${paramIdx++}
     OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );

  return {
    rows: dataResult.rows.map((r) => ({
      id: r.id,
      action: MOVEMENT_TYPE_LABELS[r.movement_type] ?? r.movement_type,
      createdAt: new Date(r.created_at).toISOString(),
      userId: r.created_by_id,
      entityType: 'InventoryMovement',
      entityId: r.lot_id,
      details: r.reason ?? null,
      productName: r.product_name ?? undefined,
      lotBatch: r.batch_number ?? undefined,
    })),
    total,
  };
}
