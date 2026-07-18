import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { ONE_MONTH_AGO } from '../constants/dates';

/**
 * Seeds purchase orders and items so the purchases workflow has test data.
 * Orders are in CONFIRMED state, ready for reception.
 */

async function seedPoDisfarma(): Promise<void> {
  const poId = IDS.PO_DISFARMA_001;

  await prisma.purchaseOrder.upsert({
    where: { id: poId },
    update: {},
    create: {
      id: poId,
      sequentialNumber: 1,
      state: 'CONFIRMED',
      supplierId: IDS.SUP_DISFARMA,
      expectedDeliveryDate: new Date(ONE_MONTH_AGO.getFullYear(), ONE_MONTH_AGO.getMonth(), ONE_MONTH_AGO.getDate() + 7),
      subtotal: '3375000.00',
      totalTax: '641250.00',
      totalAmount: '4016250.00',
      notes: 'Pedido mensual de analgesicos y antiinflamatorios',
      createdById: IDS.USER_ADMIN,
      confirmedAt: ONE_MONTH_AGO,
      confirmedById: IDS.USER_ADMIN,
    },
  });

  const items = [
    {
      id: `${poId}_it_1`, productId: IDS.PROD_ACETAMINOFEN_500, requested: 300, received: 0, pending: 300, expectedCost: '1800.00',
    },
    {
      id: `${poId}_it_2`, productId: IDS.PROD_IBUPROFENO_400, requested: 200, received: 0, pending: 200, expectedCost: '1400.00',
    },
    {
      id: `${poId}_it_3`, productId: IDS.PROD_IBUPROFENO_800, requested: 100, received: 0, pending: 100, expectedCost: '3000.00',
    },
    {
      id: `${poId}_it_4`, productId: IDS.PROD_DICLOFENACO_50, requested: 150, received: 0, pending: 150, expectedCost: '1100.00',
    },
    {
      id: `${poId}_it_5`, productId: IDS.PROD_NAPROXENO_250, requested: 100, received: 0, pending: 100, expectedCost: '2500.00',
    },
    {
      id: `${poId}_it_6`, productId: IDS.PROD_DOLEX_FORTE, requested: 250, received: 0, pending: 250, expectedCost: '3200.00',
    },
  ];

  for (const it of items) {
    await prisma.purchaseOrderItem.upsert({
      where: { id: it.id },
      update: {},
      create: {
        id: it.id,
        purchaseOrderId: poId,
        productId: it.productId,
        requestedQuantity: it.requested,
        receivedQuantity: it.received,
        pendingQuantity: it.pending,
        expectedUnitCost: it.expectedCost,
      },
    });
  }
}

async function seedPoColvan(): Promise<void> {
  const poId = IDS.PO_COLVAN_001;

  await prisma.purchaseOrder.upsert({
    where: { id: poId },
    update: {},
    create: {
      id: poId,
      sequentialNumber: 2,
      state: 'CONFIRMED',
      supplierId: IDS.SUP_COLVAN,
      expectedDeliveryDate: new Date(ONE_MONTH_AGO.getFullYear(), ONE_MONTH_AGO.getMonth(), ONE_MONTH_AGO.getDate() + 5),
      subtotal: '2070000.00',
      totalTax: '393300.00',
      totalAmount: '2463300.00',
      notes: 'Antibioticos y cardiovasculares',
      createdById: IDS.USER_ADMIN,
      confirmedAt: ONE_MONTH_AGO,
      confirmedById: IDS.USER_ADMIN,
    },
  });

  const items = [
    {
      id: `${poId}_it_1`, productId: IDS.PROD_AMOXICILINA_500, requested: 400, received: 0, pending: 400, expectedCost: '900.00',
    },
    {
      id: `${poId}_it_2`, productId: IDS.PROD_AZITROMICINA_500, requested: 50, received: 0, pending: 50, expectedCost: '7500.00',
    },
    {
      id: `${poId}_it_3`, productId: IDS.PROD_CEFALEXINA_500, requested: 80, received: 0, pending: 80, expectedCost: '2000.00',
    },
    {
      id: `${poId}_it_4`, productId: IDS.PROD_COTRIMOXAZOL, requested: 60, received: 0, pending: 60, expectedCost: '1500.00',
    },
    {
      id: `${poId}_it_5`, productId: IDS.PROD_LOSARTAN_50, requested: 100, received: 0, pending: 100, expectedCost: '4200.00',
    },
    {
      id: `${poId}_it_6`, productId: IDS.PROD_ENALAPRIL_10, requested: 100, received: 0, pending: 100, expectedCost: '1600.00',
    },
  ];

  for (const it of items) {
    await prisma.purchaseOrderItem.upsert({
      where: { id: it.id },
      update: {},
      create: {
        id: it.id,
        purchaseOrderId: poId,
        productId: it.productId,
        requestedQuantity: it.requested,
        receivedQuantity: it.received,
        pendingQuantity: it.pending,
        expectedUnitCost: it.expectedCost,
      },
    });
  }
}

export async function seedPurchases(): Promise<void> {
  console.log('Seeding purchase orders...');
  await seedPoDisfarma();
  await seedPoColvan();
  console.log('   2 purchase orders with items');
}
