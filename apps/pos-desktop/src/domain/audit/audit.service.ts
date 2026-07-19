/**
 * Local audit service — queries local inventory movements as audit entries.
 *
 * The server-side `AuditLog` model is not available in the local build, so
 * we query `InventoryMovement` directly via the typed Prisma client and map
 * rows to the `LocalAuditEntry` shape the audit-log-view expects.
 *
 * ## Why not write to AuditLog?
 *
 * The `AuditLog` model lives under `prisma/schema-source/server-only/` and
 * is excluded from the local Prisma build.  Rather than moving it into the
 * shared schema (which would require re-generating the local client), we
 * read the data that already exists — every stock mutation already writes an
 * `InventoryMovement` row inside the same transaction as the stock change.
 */

import type { PrismaClient, MovementType } from '@pharmacy/database/local';

// ---------------------------------------------------------------------------
// Types — mirror the shape audit-log-view.tsx expects
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

export interface LocalAuditQuery {
  module?: 'INVENTORY';
  fromDate?: string;
  toDate?: string;
  movementType?: MovementType;
  limit?: number;
  offset?: number;
}

export interface LocalAuditResponse {
  rows: LocalAuditEntry[];
  total: number;
}

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
// Query builder
// ---------------------------------------------------------------------------

/**
 * Fetch inventory movements as local audit entries.
 *
 * Uses raw SQL through Prisma so we can join Lot + Product in a single
 * round-trip without depending on generated `include` types for every
 * relation path.
 */
export async function getLocalAuditEntries(
  prisma: PrismaClient,
  query: LocalAuditQuery = {},
): Promise<LocalAuditResponse> {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  // Build WHERE clause
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (query.fromDate) {
    conditions.push(`im."createdAt" >= $${paramIdx++}`);
    params.push(query.fromDate);
  }
  if (query.toDate) {
    conditions.push(`im."createdAt" <= $${paramIdx++}`);
    params.push(query.toDate + 'T23:59:59.999Z');
  }
  if (query.movementType) {
    conditions.push(`im."movementType" = $${paramIdx++}`);
    params.push(query.movementType);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // Count query
  const countResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count FROM "InventoryMovement" im ${whereClause}`,
    ...params,
  );
  const total = Number(countResult[0]?.count ?? 0);

  // Data query
  const rows = await prisma.$queryRawUnsafe<
    Array<{
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
    }>
  >(
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
    ...params,
    limit,
    offset,
  );

  return {
    rows: rows.map((r) => ({
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
