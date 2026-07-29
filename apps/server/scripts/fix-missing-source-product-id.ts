import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@pharmacy/database';

/**
 * Fix: product was never created by PRODUCT_CREATION (COMPLETED but no entityId,
 * no product with sourceOperationUuid).  Reset the entry to PENDING so the
 * cron job re-creates it properly.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL not set');

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    // Find PRODUCT_CREATION entries COMPLETED but with no matching product
    const entries = await prisma.syncQueue.findMany({
      where: { operationType: 'PRODUCT_CREATION', status: 'COMPLETED', entityId: null },
      select: { id: true, operationUuid: true, payload: true, retryCount: true },
    });

    console.log(`Found ${entries.length} entries.`);
    let reset = 0;

    for (const entry of entries) {
      // Show payload for debugging
      const payload = JSON.parse(entry.payload);
      const dto = payload.createProductDto;
      console.log(`\nEntry ${entry.id}:`);
      console.log(`  operationUuid: ${entry.operationUuid}`);
      console.log(`  product payload:`, JSON.stringify(dto, null, 4));
      console.log(`  metadata:`, JSON.stringify(payload.metadata, null, 4));

      // Check if any product has this sourceOperationUuid
      const p = await prisma.product.findFirst({
        where: { sourceOperationUuid: entry.operationUuid },
        select: { id: true },
      });
      if (p) {
        console.log(`  → Product exists (${p.id}), stamping entityId`);
        await prisma.syncQueue.update({
          where: { id: entry.id },
          data: { entityId: p.id },
        });
        continue;
      }

      // Check if product exists by metadata.productId as sourceProductId
      const localId = payload.metadata?.productId;
      if (localId) {
        const p2 = await prisma.product.findFirst({
          where: { sourceProductId: localId },
          select: { id: true },
        });
        if (p2) {
          console.log(`  → Product exists via sourceProductId (${p2.id}), stamping entityId`);
          await prisma.syncQueue.update({
            where: { id: entry.id },
            data: { entityId: p2.id },
          });
          continue;
        }
      }

      // Check if product exists by internalCode
      if (dto?.internalCode) {
        const p3 = await prisma.product.findFirst({
          where: { internalCode: dto.internalCode },
          select: { id: true },
        });
        if (p3) {
          console.log(`  → Product exists via internalCode (${p3.id}), stamping entityId`);
          await prisma.syncQueue.update({
            where: { id: entry.id },
            data: { entityId: p3.id },
          });
          continue;
        }
      }

      // Product truly doesn't exist — reset to PENDING for cron retry
      console.log(`  → No product found on server. Resetting to PENDING...`);
      await prisma.syncQueue.update({
        where: { id: entry.id },
        data: {
          status: 'PENDING',
          retryCount: 0,
          nextRetryAt: null,
          lastErrorMessage: 'Reset by fix-missing-source-product-id: product was never created',
        },
      });
      reset++;
    }

    // Also reset FAILED SALE_CONFIRMATION entries to PENDING
    console.log(`\n--- Resetting FAILED SALE_CONFIRMATION entries ---`);
    const failedSales = await prisma.syncQueue.findMany({
      where: { operationType: 'SALE_CONFIRMATION', status: 'FAILED' },
    });
    for (const entry of failedSales) {
      console.log(`  Resetting ${entry.id} (retry=${entry.retryCount}) → PENDING`);
      await prisma.syncQueue.update({
        where: { id: entry.id },
        data: {
          status: 'PENDING',
          retryCount: 0,
          nextRetryAt: null,
          lastErrorMessage: 'Reset by fix-missing-source-product-id: awaiting product creation',
        },
      });
    }
    console.log(`\nReset ${reset} PRODUCT_CREATION entries, ${failedSales.length} SALE_CONFIRMATION entries.`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
