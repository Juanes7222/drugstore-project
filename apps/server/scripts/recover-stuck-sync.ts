import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '@pharmacy/database';

/**
 * One-shot recovery script for SyncQueue entries that were created against
 * the pre-fix server contract and have been stuck in FAILED status.
 *
 * Two pre-fix conditions are repaired:
 *
 *   SALE_CONFIRMATION
 *     The POS pre-fix did not include the four snapshotted totals
 *     (`subtotal`, `totalDiscount`, `totalTax`, `totalAmount`) on
 *     `createSaleDto`. The server's `resolveHeaderTotals` falls back to
 *     recomputing from items, which diverges from the customer-paid
 *     amount whenever the catalog has drifted. Fix: inject the four
 *     totals into the existing payload so the server treats the entry
 *     as offline-first and the payment check matches the recorded sum.
 *
 *   PURCHASE_RECEPTION_CONFIRMATION
 *     The POS pre-fix used `receivedQuantity` / `realUnitCost` on each
 *     item; the server schema requires `quantity` / `unitCost`. The new
 *     Zod boundary rejects the payload with `SYNC_PAYLOAD_VALIDATION`
 *     instead of letting it crash inside the service. Fix: rename the
 *     two keys in place and drop the three server-unknown extras
 *     (`taxSchemeId`, `taxRate`, `discountAmount`).
 *
 * The script is idempotent — re-running it on an already-recovered entry
 * is a no-op (the entry will already be PENDING or COMPLETED and is not
 * selected by the WHERE clause).
 *
 * Usage:
 *   pnpm tsx scripts/recover-stuck-sync.ts                  # process all eligible
 *   pnpm tsx scripts/recover-stuck-sync.ts --dry-run        # list, do not mutate
 *   pnpm tsx scripts/recover-stuck-sync.ts --ids=id1,id2    # target a subset
 *   pnpm tsx scripts/recover-stuck-sync.ts --type=SALE_CONFIRMATION
 */

interface CliArgs {
  dryRun: boolean;
  ids: string[] | null;
  type: 'SALE_CONFIRMATION' | 'PURCHASE_RECEPTION_CONFIRMATION' | null;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false, ids: null, type: null };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--ids=')) {
      out.ids = arg.slice('--ids='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--type=')) {
      const value = arg.slice('--type='.length);
      if (value === 'SALE_CONFIRMATION' || value === 'PURCHASE_RECEPTION_CONFIRMATION') {
        out.type = value;
      } else {
        throw new Error(`Unsupported --type value: ${value}`);
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

interface SalePaymentInput { amount: number | string; paymentMethodId: string }
interface SaleItemInput {
  productId: string;
  quantity: number;
  unitPrice?: string;
  discount?: string;
  discountPercentage?: number;
  discountReason?: string;
}
interface CreateSaleDtoShape {
  saleType?: string;
  cashShiftId?: string;
  clientId?: string | null;
  items: SaleItemInput[];
  prescriptionNumber?: string | null;
  subtotal?: string;
  totalDiscount?: string;
  totalTax?: string;
  totalAmount?: string;
}
interface ConfirmSaleDtoShape { payments: SalePaymentInput[] }
interface SaleConfirmationPayload {
  userId?: string;
  workstationId?: string;
  createSaleDto: CreateSaleDtoShape;
  confirmSaleDto: ConfirmSaleDtoShape;
}

interface ReceptionItemInput {
  productId: string;
  lotId?: string;
  receivedQuantity?: number;
  realUnitCost?: number | string;
  quantity?: number;
  unitCost?: number | string;
  expirationDate?: string;
  batchNumber?: string;
  taxSchemeId?: string;
  taxRate?: number | string;
  discountAmount?: number | string;
  lot?: unknown;
}
interface ReceptionConfirmationPayload {
  receptionId?: string;
  sequentialNumber?: number;
  supplierId?: string;
  purchaseOrderId?: string;
  notes?: string;
  confirmedByUserId?: string;
  createdById?: string;
  confirmedAt?: string;
  items?: ReceptionItemInput[];
}

function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Ensure apps/server/.env exists.');
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/** Lookup product by its UUID or sourceProductId (local POS UUID). */
async function findProduct(
  tx: Prisma.TransactionClient,
  localProductId: string,
): Promise<{ id: string; priceHistories: Array<{ price: Prisma.Decimal }>; taxHistories: Array<{ taxScheme: { rate: Prisma.Decimal } }> } | null> {
  return tx.product.findFirst({
    where: { OR: [{ id: localProductId }, { sourceProductId: localProductId }] },
    include: {
      priceHistories: { take: 1, orderBy: { effectiveFrom: 'desc' } },
      taxHistories: { include: { taxScheme: true }, take: 1, orderBy: { effectiveFrom: 'desc' } },
    },
  }) as any;
}

/** Backfill sourceProductId from COMPLETED PRODUCT_CREATION SyncQueue payloads. */
async function backfillSourceProductId(tx: Prisma.TransactionClient, dryRun: boolean): Promise<number> {
  const productCreations = await (tx as any).syncQueue.findMany({
    where: {
      operationType: 'PRODUCT_CREATION',
      status: 'COMPLETED',
      entityId: { not: null },
    },
    select: { id: true, entityId: true, payload: true },
  });

  let backfilled = 0;
  for (const entry of productCreations) {
    if (!entry.entityId) continue;
    const parsed = JSON.parse(entry.payload);
    const localProductId = parsed.metadata?.productId as string | undefined;
    if (!localProductId) continue;

    const exists = await (tx as any).product.findUnique({
      where: { id: entry.entityId },
      select: { sourceProductId: true },
    });
    if (exists && exists.sourceProductId === localProductId) continue;

    if (dryRun) {
      console.log(`  DRY   would set sourceProductId=${localProductId} on product ${entry.entityId}`);
      backfilled++;
      continue;
    }

    await (tx as any).product.update({
      where: { id: entry.entityId },
      data: { sourceProductId: localProductId },
    });
    backfilled++;
  }
  return backfilled;
}

async function recoverSaleConfirmation(
  tx: Prisma.TransactionClient,
  entryId: string,
  payload: SaleConfirmationPayload,
): Promise<{ subtotal: string; totalDiscount: string; totalTax: string; totalAmount: string; remapped: number }> {
  const items = payload.createSaleDto.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('createSaleDto.items missing or empty');
  }

  // Remap local product IDs to server product IDs via sourceProductId
  let remapped = 0;
  for (const item of items) {
    if (item.productId) {
      const product = await findProduct(tx, item.productId);
      if (product && product.id !== item.productId) {
        console.log(`  MAP   ${item.productId} → ${product.id}`);
        item.productId = product.id;
        remapped++;
      }
    }
  }

  // Compute per-item totals the same way the server's
  // `buildSaleItemFromRequest` does, using the server's current catalog as
  // the source of truth. This is the only place the server-side drift
  // (tax scheme edit, price change not yet synced) can be reconciled for
  // a pre-fix entry — there is no POS snapshot to fall back to.
  let subtotalDecimal = new Prisma.Decimal(0);
  let discountDecimal = new Prisma.Decimal(0);
  let taxDecimal = new Prisma.Decimal(0);
  let totalDecimal = new Prisma.Decimal(0);

  for (const item of items) {
    const product = await findProduct(tx, item.productId);
    if (!product) {
      throw new Error(`Product ${item.productId} not found on server — cannot recover. ` +
        `Sync PRODUCT_CREATION first or create the product manually.`);
    }

    const unitPrice = item.unitPrice
      ? new Prisma.Decimal(item.unitPrice)
      : (product.priceHistories?.[0]?.price ?? new Prisma.Decimal(0));
    const taxRate = product.taxHistories?.[0]?.taxScheme?.rate ?? new Prisma.Decimal(0);

    const quantity = new Prisma.Decimal(item.quantity);
    const itemSubtotal = unitPrice.times(quantity);
    const discountPercentage = item.discountPercentage
      ? new Prisma.Decimal(item.discountPercentage)
      : new Prisma.Decimal(0);
    const itemDiscount = itemSubtotal.times(discountPercentage).dividedBy(100);
    const priceAfterDiscount = itemSubtotal.minus(itemDiscount);
    const itemTax = priceAfterDiscount.times(taxRate).dividedBy(100);
    const itemTotal = priceAfterDiscount.plus(itemTax);

    subtotalDecimal = subtotalDecimal.plus(itemSubtotal);
    discountDecimal = discountDecimal.plus(itemDiscount);
    taxDecimal = taxDecimal.plus(itemTax);
    totalDecimal = totalDecimal.plus(itemTotal);
  }

  return {
    subtotal: subtotalDecimal.toFixed(2),
    totalDiscount: discountDecimal.toFixed(2),
    totalTax: taxDecimal.toFixed(2),
    // totalAmount is the customer-paid sum, not the server-recomputed
    // total. This is the offline-first invariant: the POS recorded what
    // the customer paid; the server stores that as the authoritative
    // sale header so the payment-vs-total check passes.
    totalAmount: payload.confirmSaleDto.payments
      .reduce((sum, p) => sum.plus(new Prisma.Decimal(p.amount)), new Prisma.Decimal(0))
      .toFixed(2),
    remapped,
  };
}

function recoverReceptionPayload(payload: ReceptionConfirmationPayload): { items: unknown[]; changed: number } {
  const items = payload.items ?? [];
  let changed = 0;
  const newItems = items.map((item) => {
    if (item.quantity !== undefined && item.unitCost !== undefined) {
      return item; // already on the new schema
    }
    changed += 1;
    const { receivedQuantity, realUnitCost, taxSchemeId, taxRate, discountAmount, ...rest } = item;
    return {
      ...rest,
      quantity: receivedQuantity,
      unitCost: realUnitCost,
    };
  });
  return { items: newItems, changed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = createPrisma();

  try {
    const where: Prisma.SyncQueueWhereInput = {
      status: 'FAILED',
      operationType: args.type
        ? args.type
        : { in: ['SALE_CONFIRMATION', 'PURCHASE_RECEPTION_CONFIRMATION'] },
      ...(args.ids ? { id: { in: args.ids } } : {}),
    };

    const entries = await prisma.syncQueue.findMany({
      where,
      orderBy: { receivedAt: 'asc' },
    });

    console.log(`Found ${entries.length} eligible FAILED sync queue entries.`);

    // Step 0: backfill sourceProductId on existing products so the
    // product-ID remapping in recoverSaleConfirmation can find server
    // products by their local POS UUID.
    console.log('Backfilling sourceProductId from PRODUCT_CREATION payloads…');
    const backfilled = await backfillSourceProductId(prisma, args.dryRun);
    console.log(`Backfilled sourceProductId on ${backfilled} product(s).`);

    if (entries.length === 0) return;

    let recovered = 0;
    let skipped = 0;
    let failed = 0;

    for (const entry of entries) {
      const header = `[${entry.id}] ${entry.operationType} (retry=${entry.retryCount})`;
      try {
        const payload = JSON.parse(entry.payload);

        if (entry.operationType === 'SALE_CONFIRMATION') {
          if (payload.createSaleDto?.subtotal !== undefined
              && payload.createSaleDto?.totalAmount !== undefined) {
            console.log(`${header}  SKIP  (already carries snapshotted totals)`);
            skipped += 1;
            continue;
          }

          const { subtotal, totalDiscount, totalTax, totalAmount, remapped } = await recoverSaleConfirmation(prisma, entry.id, payload);
          const totals = { subtotal, totalDiscount, totalTax, totalAmount };
          const newPayload = {
            ...payload,
            createSaleDto: {
              ...payload.createSaleDto,
              ...totals,
            },
          };

          if (args.dryRun) {
            console.log(`${header}  DRY   would inject totals=${JSON.stringify(totals)} (remapped ${remapped} product(s))`);
            recovered += 1;
            continue;
          }

          await prisma.$transaction(async (tx) => {
            await tx.syncQueue.update({
              where: { id: entry.id },
              data: {
                status: 'PENDING',
                retryCount: 0,
                nextRetryAt: null,
                lastErrorMessage: 'Recovered by recover-stuck-sync: snapshotted totals injected',
                payload: JSON.stringify(newPayload),
              },
            });
          });
          console.log(`${header}  OK    injected totals=${JSON.stringify(totals)} (remapped ${remapped} product(s))`);
          recovered += 1;
        } else if (entry.operationType === 'PURCHASE_RECEPTION_CONFIRMATION') {
          const { items, changed } = recoverReceptionPayload(payload);
          if (changed === 0) {
            console.log(`${header}  SKIP  (items already on new schema)`);
            skipped += 1;
            continue;
          }

          const newPayload = { ...payload, items };

          if (args.dryRun) {
            console.log(`${header}  DRY   would rename keys on ${changed} item(s)`);
            recovered += 1;
            continue;
          }

          await prisma.$transaction(async (tx) => {
            await tx.syncQueue.update({
              where: { id: entry.id },
              data: {
                status: 'PENDING',
                retryCount: 0,
                nextRetryAt: null,
                lastErrorMessage: 'Recovered by recover-stuck-sync: item field names aligned to current schema',
                payload: JSON.stringify(newPayload),
              },
            });
          });
          console.log(`${header}  OK    renamed ${changed} item(s)`);
          recovered += 1;
        } else {
          console.log(`${header}  SKIP  (unsupported operation type for this script)`);
          skipped += 1;
        }
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`${header}  ERR   ${message}`);
      }
    }

    console.log('');
    console.log(`Summary: ${recovered} recovered, ${skipped} skipped, ${failed} failed${args.dryRun ? ' (dry run)' : ''}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Recovery script failed:', err);
  process.exit(1);
});
