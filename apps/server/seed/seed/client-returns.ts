import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { YESTERDAY } from '../constants/dates';

/**
 * Seeds a client return (devolución) tied to the closed-yesterday cash shift.
 * Returns a few items from SALE_CLOSED_001 (Clínica San José).
 */

const RETURN_DATE = new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 17, 0, 0);

async function seedClientReturn(): Promise<void> {
  const returnId = IDS.RETURN_CLOSED_001;
  const saleId = IDS.SALE_CLOSED_001;

  await prisma.clientReturn.upsert({
    where: { id: returnId },
    update: {},
    create: {
      id: returnId,
      sequentialNumber: 1,
      state: 'CONFIRMED',
      saleId,
      clientId: IDS.CLIENT_CLINICA_SAN_JOSE,
      refundAmount: '95600.00',
      subtotalReturned: '80000.00',
      taxReturned: '15600.00',
      refundMethodId: IDS.PAY_TRANSFERENCIA,
      reason: 'Producto recibido en mal estado — caja de jeringas abierta',
      notes: 'Se devuelven 20 unidades de jeringa 3ml con empaque violado',
      createdById: IDS.USER_CASHIER1,
      cashShiftId: IDS.SHIFT_CLOSED_YESTERDAY,
      workstationId: IDS.WS_PRINCIPAL,
      creditNoteId: null,
    },
  });

  // Return item — 20 jeringas from SALE_CLOSED_001 item 4
  const saleItemId = `${saleId}_it_4`; // Jeringa 3ml x50
  await prisma.clientReturnItem.upsert({
    where: { id: `${returnId}_it_1` },
    update: {},
    create: {
      id: `${returnId}_it_1`,
      clientReturnId: returnId,
      saleItemId,
      quantity: 20,
      unitPriceAtSale: '800.00',
      unitPriceAtReturn: '800.00',
      taxAmount: '15200.00',
      totalAmount: '95600.00',
    },
  });

  // Lot tracking for returned items
  await prisma.clientReturnItemLot.upsert({
    where: { id: `${returnId}_it_1_lot` },
    update: {},
    create: {
      id: `${returnId}_it_1_lot`,
      clientReturnItemId: `${returnId}_it_1`,
      lotId: IDS.LOT_JERINGA_001,
      quantity: 20,
    },
  });

  // Inventory movement for the return (CLIENT_RETURN type)
  await prisma.inventoryMovement.upsert({
    where: { id: `mov_return_jeringa` },
    update: {},
    create: {
      id: `mov_return_jeringa`,
      movementType: 'CLIENT_RETURN',
      quantity: 20,
      previousStock: 500,
      resultingStock: 520,
      lotId: IDS.LOT_JERINGA_001,
      clientReturnId: returnId,
      createdById: IDS.USER_CASHIER1,
      reason: 'Devolución de cliente: 20 jeringas dañadas',
      createdAt: RETURN_DATE,
    },
  });
}

export async function seedClientReturns(): Promise<void> {
  console.log('Seeding client returns...');
  await seedClientReturn();
  console.log('   1 client return (jeringas 3ml x20) with lot movement');
}
