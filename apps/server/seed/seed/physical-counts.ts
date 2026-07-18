import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { ONE_MONTH_AGO } from '../constants/dates';

/**
 * Seeds a physical-count session that was completed and applied,
 * with an adjustment document and inventory movements.
 * Demonstrates the PhysicalCount → InventoryAdjustmentDocument → InventoryMovement chain.
 */

const PHYS_COUNT_DATE = new Date(ONE_MONTH_AGO.getFullYear(), ONE_MONTH_AGO.getMonth(), ONE_MONTH_AGO.getDate() + 3, 10, 0, 0);

async function seedPhysicalCount(): Promise<void> {
  await prisma.physicalCount.upsert({
    where: { id: IDS.PHYS_COUNT_001 },
    update: {},
    create: {
      id: IDS.PHYS_COUNT_001,
      sequentialNumber: 1,
      state: 'APPLIED',
      startedAt: PHYS_COUNT_DATE,
      startedByUserId: IDS.USER_INVENTORY,
      finishedAt: new Date(PHYS_COUNT_DATE.getTime() + 2 * 60 * 60 * 1000),
      approvedAt: new Date(PHYS_COUNT_DATE.getTime() + 3 * 60 * 60 * 1000),
      approvedByUserId: IDS.USER_ADMIN,
      appliedAt: new Date(PHYS_COUNT_DATE.getTime() + 3 * 60 * 60 * 1000),
      notes: 'Conteo mensual de antibioticos de alto consumo',
    },
  });

  // Adjustment document — positive adjustment (found more stock than expected)
  await prisma.inventoryAdjustmentDocument.upsert({
    where: { id: IDS.ADJ_DOC_001 },
    update: {},
    create: {
      id: IDS.ADJ_DOC_001,
      sequentialNumber: 1,
      state: 'APPLIED',
      reason: 'Diferencia encontrada en conteo físico mensual',
      notes: 'Se encontraron 15 unidades adicionales de Amoxicilina y 5 menos de Azitromicina',
      createdByUserId: IDS.USER_INVENTORY,
      submittedForApprovalAt: new Date(PHYS_COUNT_DATE.getTime() + 2 * 60 * 60 * 1000),
      approvedAt: new Date(PHYS_COUNT_DATE.getTime() + 3 * 60 * 60 * 1000),
      approvedByUserId: IDS.USER_ADMIN,
      approvalNotes: 'Diferencia justificada — se verificó conteo',
      appliedAt: new Date(PHYS_COUNT_DATE.getTime() + 3 * 60 * 60 * 1000),
      physicalCountId: IDS.PHYS_COUNT_001,
    },
  });

  // Movement 1 — positive adjustment: found 15 more Amoxicilina than system showed
  await prisma.inventoryMovement.upsert({
    where: { id: 'mov_adj_amox' },
    update: {},
    create: {
      id: 'mov_adj_amox',
      movementType: 'POSITIVE_ADJUSTMENT',
      quantity: 15,
      previousStock: 200,
      resultingStock: 215,
      lotId: IDS.LOT_AMOX_001,
      adjustmentDocumentId: IDS.ADJ_DOC_001,
      createdById: IDS.USER_INVENTORY,
      reason: 'Conteo físico: se encontraron 15 unidades adicionales',
      createdAt: new Date(PHYS_COUNT_DATE.getTime() + 3 * 60 * 60 * 1000),
    },
  });

  // Update lot stock
  await prisma.lot.update({
    where: { id: IDS.LOT_AMOX_001 },
    data: { currentStock: 215 },
  });

  // Movement 2 — negative adjustment: 5 Azitromicina missing (counted 35, system had 40)
  await prisma.inventoryMovement.upsert({
    where: { id: 'mov_adj_azit' },
    update: {},
    create: {
      id: 'mov_adj_azit',
      movementType: 'NEGATIVE_ADJUSTMENT',
      quantity: 5,
      previousStock: 40,
      resultingStock: 35,
      lotId: IDS.LOT_AZIT_001,
      adjustmentDocumentId: IDS.ADJ_DOC_001,
      createdById: IDS.USER_INVENTORY,
      reason: 'Conteo físico: faltan 5 unidades respecto al sistema',
      createdAt: new Date(PHYS_COUNT_DATE.getTime() + 3 * 60 * 60 * 1000),
    },
  });

  // Update lot stock
  await prisma.lot.update({
    where: { id: IDS.LOT_AZIT_001 },
    data: { currentStock: 35 },
  });
}

export async function seedPhysicalCounts(): Promise<void> {
  console.log('Seeding physical counts and adjustments...');
  await seedPhysicalCount();
  console.log('   1 physical count → 1 adjustment document → 2 movements');
}
