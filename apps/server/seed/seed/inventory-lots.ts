import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { TWO_YEARS_FROM_NOW, ONE_MONTH_AGO, NOW } from '../constants/dates';
import { Prisma } from '@pharmacy/database';

/** Seed lots with their unit cost (what the pharmacy paid per unit). */
interface SeedLot {
  id: string;
  batchNumber: string;
  productId: string;
  currentStock: number;
  expirationDate: Date;
  unitCost: number;
}

// All seed suppliers' products come from DISFARMA so we use a single
// reception record. Each item has a plausible unit cost in COP.
const RECEPTION_ID = 'reception_initial_stock';

const lots: SeedLot[] = [
  { id: IDS.LOT_ACET_001, batchNumber: 'ACE-2025-001', productId: IDS.PROD_ACETAMINOFEN_500, currentStock: 120, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 120 },
  { id: IDS.LOT_IBU_001, batchNumber: 'IBU-2025-001', productId: IDS.PROD_IBUPROFENO_400, currentStock: 85, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 180 },
  { id: IDS.LOT_IBU_002, batchNumber: 'IBU-2025-002', productId: IDS.PROD_IBUPROFENO_800, currentStock: 60, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 250 },
  { id: IDS.LOT_DIC_001, batchNumber: 'DIC-2025-001', productId: IDS.PROD_DICLOFENACO_50, currentStock: 70, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 100 },
  { id: IDS.LOT_NAP_001, batchNumber: 'NAP-2025-001', productId: IDS.PROD_NAPROXENO_250, currentStock: 55, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 200 },
  { id: IDS.LOT_AMOX_001, batchNumber: 'AMX-2025-001', productId: IDS.PROD_AMOXICILINA_500, currentStock: 200, expirationDate: new Date(NOW.getFullYear() + 1, 11, 31), unitCost: 300 },
  { id: IDS.LOT_AZIT_001, batchNumber: 'AZT-2025-001', productId: IDS.PROD_AZITROMICINA_500, currentStock: 40, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 1500 },
  { id: IDS.LOT_CEF_001, batchNumber: 'CEF-2025-001', productId: IDS.PROD_CEFALEXINA_500, currentStock: 45, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 400 },
  { id: IDS.LOT_COTRI_001, batchNumber: 'CTR-2025-001', productId: IDS.PROD_COTRIMOXAZOL, currentStock: 30, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 350 },
  { id: IDS.LOT_LORAT_001, batchNumber: 'LOR-2025-001', productId: IDS.PROD_LORATADINA_10, currentStock: 90, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 250 },
  { id: IDS.LOT_CET_001, batchNumber: 'CET-2025-001', productId: IDS.PROD_CETIRIZINA_10, currentStock: 65, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 200 },
  { id: IDS.LOT_DESL_001, batchNumber: 'DES-2025-001', productId: IDS.PROD_DESLORATADINA_5, currentStock: 30, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 400 },
  { id: IDS.LOT_LOS_001, batchNumber: 'LOS-2025-001', productId: IDS.PROD_LOSARTAN_50, currentStock: 100, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 150 },
  { id: IDS.LOT_ENAL_001, batchNumber: 'ENA-2025-001', productId: IDS.PROD_ENALAPRIL_10, currentStock: 50, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 180 },
  { id: IDS.LOT_OME_001, batchNumber: 'OME-2025-001', productId: IDS.PROD_OMEPRAZOL_20, currentStock: 150, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 220 },
  { id: IDS.LOT_ESO_001, batchNumber: 'ESO-2025-001', productId: IDS.PROD_ESOMEPRAZOL_40, currentStock: 35, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 600 },
  { id: IDS.LOT_RAN_001, batchNumber: 'RAN-2025-001', productId: IDS.PROD_RANITIDINA_150, currentStock: 70, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 160 },
  { id: IDS.LOT_SALB_001, batchNumber: 'SAL-2025-001', productId: IDS.PROD_SALBUTAMOL_100, currentStock: 25, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 800 },
  { id: IDS.LOT_DOLEX_001, batchNumber: 'DLX-2025-001', productId: IDS.PROD_DOLEX_FORTE, currentStock: 200, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 350 },
  { id: IDS.LOT_VITC_001, batchNumber: 'VTC-2025-001', productId: IDS.PROD_VITAMINA_C_500, currentStock: 100, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 450 },
  { id: IDS.LOT_ALCOHOL_001, batchNumber: 'ALC-2025-001', productId: IDS.PROD_ALCOHOL_70, currentStock: 40, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 300 },
  { id: IDS.LOT_GUANTES_001, batchNumber: 'GLT-2025-001', productId: IDS.PROD_GUANTES_LATEX_M, currentStock: 300, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 80 },
  { id: IDS.LOT_JERINGA_001, batchNumber: 'JER-2025-001', productId: IDS.PROD_JERINGA_3ML, currentStock: 500, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 50 },
  { id: IDS.LOT_BAJA_001, batchNumber: 'BJL-2025-001', productId: IDS.PROD_BAJALENGUAS, currentStock: 80, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 30 },
  { id: IDS.LOT_GASA_001, batchNumber: 'GAS-2025-001', productId: IDS.PROD_GASA_ESTERIL, currentStock: 60, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 250 },
  { id: IDS.LOT_TRAMADOL_001, batchNumber: 'TRM-2025-001', productId: IDS.PROD_TRAMADOL_50, currentStock: 50, expirationDate: new Date(NOW.getFullYear() + 1, 5, 15), unitCost: 900 },
  { id: IDS.LOT_CLONAZEPAM_001, batchNumber: 'CLZ-2025-001', productId: IDS.PROD_CLONAZEPAM_2, currentStock: 30, expirationDate: TWO_YEARS_FROM_NOW, unitCost: 700 },
];

export async function seedInventoryLots(): Promise<void> {
  console.log('Seeding inventory lots...');

  // 1. Create a single reception that groups all initial-stock lots.
  //    This gives every seed lot a PurchaseReceptionItem.realUnitCost so
  //    consumeStockForSale() finds a cost instead of throwing.
  const receptionItemCount = lots.reduce((sum, l) => sum + l.currentStock * l.unitCost, 0);
  const receptionTotal = new Prisma.Decimal(receptionItemCount);

  await prisma.purchaseReception.upsert({
    where: { id: RECEPTION_ID },
    update: {},
    create: {
      id: RECEPTION_ID,
      sequentialNumber: 1,
      state: 'CONFIRMED',
      receivedAt: ONE_MONTH_AGO,
      createdAt: ONE_MONTH_AGO,
      createdById: IDS.USER_ADMIN,
      supplierId: IDS.SUP_DISFARMA,
      subtotal: receptionTotal,
      totalTax: new Prisma.Decimal(0),
      totalAmount: receptionTotal,
      notes: 'Recepción de carga inicial de inventario (seed data)',
    },
  });

  const TAX_SCHEME_EXENTO = IDS.TAX_EXENTO;

  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    const itemTotal = lot.currentStock * lot.unitCost;

    await prisma.lot.upsert({
      where: { id: lot.id },
      update: { currentStock: lot.currentStock, expirationDate: lot.expirationDate, batchNumber: lot.batchNumber },
      create: {
        id: lot.id,
        batchNumber: lot.batchNumber,
        expirationDate: lot.expirationDate,
        entryDate: ONE_MONTH_AGO,
        state: 'ACTIVE',
        currentStock: lot.currentStock,
        version: 0,
        productId: lot.productId,
        locationCode: 'EST-01-A',
      },
    });

    await prisma.purchaseReceptionItem.upsert({
      where: { id: `pri_${lot.id}` },
      update: { realUnitCost: new Prisma.Decimal(lot.unitCost) },
      create: {
        id: `pri_${lot.id}`,
        purchaseReceptionId: RECEPTION_ID,
        productId: lot.productId,
        lotId: lot.id,
        receivedQuantity: lot.currentStock,
        lotNumber: lot.batchNumber,
        expirationDate: lot.expirationDate,
        realUnitCost: new Prisma.Decimal(lot.unitCost),
        taxSchemeId: TAX_SCHEME_EXENTO,
        taxRate: new Prisma.Decimal(0),
        subtotal: new Prisma.Decimal(itemTotal),
        total: new Prisma.Decimal(itemTotal),
      },
    });

    await prisma.inventoryMovement.upsert({
      where: { id: `mov_init_${lot.id}` },
      update: { quantity: lot.currentStock },
      create: {
        id: `mov_init_${lot.id}`,
        lotId: lot.id,
        movementType: 'INITIAL_STOCK',
        quantity: lot.currentStock,
        previousStock: 0,
        resultingStock: lot.currentStock,
        createdById: IDS.USER_ADMIN,
        reason: 'Carga inicial de inventario',
        createdAt: ONE_MONTH_AGO,
      },
    });
  }
  console.log(`   ${lots.length} lots with purchase reception items + initial stock movements`);
}