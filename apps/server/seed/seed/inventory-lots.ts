import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { TWO_YEARS_FROM_NOW, ONE_MONTH_AGO, NOW } from '../constants/dates';

export async function seedInventoryLots(): Promise<void> {
  console.log('Seeding inventory lots...');
  const lots = [
    { id: IDS.LOT_ACET_001, batchNumber: 'ACE-2025-001', productId: IDS.PROD_ACETAMINOFEN_500, currentStock: 120, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_IBU_001, batchNumber: 'IBU-2025-001', productId: IDS.PROD_IBUPROFENO_400, currentStock: 85, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_IBU_002, batchNumber: 'IBU-2025-002', productId: IDS.PROD_IBUPROFENO_800, currentStock: 60, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_DIC_001, batchNumber: 'DIC-2025-001', productId: IDS.PROD_DICLOFENACO_50, currentStock: 70, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_NAP_001, batchNumber: 'NAP-2025-001', productId: IDS.PROD_NAPROXENO_250, currentStock: 55, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_AMOX_001, batchNumber: 'AMX-2025-001', productId: IDS.PROD_AMOXICILINA_500, currentStock: 200, expirationDate: new Date(NOW.getFullYear() + 1, 11, 31) },
    { id: IDS.LOT_AZIT_001, batchNumber: 'AZT-2025-001', productId: IDS.PROD_AZITROMICINA_500, currentStock: 40, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_CEF_001, batchNumber: 'CEF-2025-001', productId: IDS.PROD_CEFALEXINA_500, currentStock: 45, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_COTRI_001, batchNumber: 'CTR-2025-001', productId: IDS.PROD_COTRIMOXAZOL, currentStock: 30, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_LORAT_001, batchNumber: 'LOR-2025-001', productId: IDS.PROD_LORATADINA_10, currentStock: 90, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_CET_001, batchNumber: 'CET-2025-001', productId: IDS.PROD_CETIRIZINA_10, currentStock: 65, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_DESL_001, batchNumber: 'DES-2025-001', productId: IDS.PROD_DESLORATADINA_5, currentStock: 30, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_LOS_001, batchNumber: 'LOS-2025-001', productId: IDS.PROD_LOSARTAN_50, currentStock: 100, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_ENAL_001, batchNumber: 'ENA-2025-001', productId: IDS.PROD_ENALAPRIL_10, currentStock: 50, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_OME_001, batchNumber: 'OME-2025-001', productId: IDS.PROD_OMEPRAZOL_20, currentStock: 150, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_ESO_001, batchNumber: 'ESO-2025-001', productId: IDS.PROD_ESOMEPRAZOL_40, currentStock: 35, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_RAN_001, batchNumber: 'RAN-2025-001', productId: IDS.PROD_RANITIDINA_150, currentStock: 70, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_SALB_001, batchNumber: 'SAL-2025-001', productId: IDS.PROD_SALBUTAMOL_100, currentStock: 25, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_DOLEX_001, batchNumber: 'DLX-2025-001', productId: IDS.PROD_DOLEX_FORTE, currentStock: 200, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_VITC_001, batchNumber: 'VTC-2025-001', productId: IDS.PROD_VITAMINA_C_500, currentStock: 100, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_ALCOHOL_001, batchNumber: 'ALC-2025-001', productId: IDS.PROD_ALCOHOL_70, currentStock: 40, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_GUANTES_001, batchNumber: 'GLT-2025-001', productId: IDS.PROD_GUANTES_LATEX_M, currentStock: 300, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_JERINGA_001, batchNumber: 'JER-2025-001', productId: IDS.PROD_JERINGA_3ML, currentStock: 500, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_BAJA_001, batchNumber: 'BJL-2025-001', productId: IDS.PROD_BAJALENGUAS, currentStock: 80, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_GASA_001, batchNumber: 'GAS-2025-001', productId: IDS.PROD_GASA_ESTERIL, currentStock: 60, expirationDate: TWO_YEARS_FROM_NOW },
    { id: IDS.LOT_TRAMADOL_001, batchNumber: 'TRM-2025-001', productId: IDS.PROD_TRAMADOL_50, currentStock: 50, expirationDate: new Date(NOW.getFullYear() + 1, 5, 15) },
    { id: IDS.LOT_CLONAZEPAM_001, batchNumber: 'CLZ-2025-001', productId: IDS.PROD_CLONAZEPAM_2, currentStock: 30, expirationDate: TWO_YEARS_FROM_NOW },
  ];

  for (const lot of lots) {
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
  console.log(`   ${lots.length} lots with initial stock movements`);
}