import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { YESTERDAY, NOW, ONE_MONTH_AGO } from '../constants/dates';

/**
 * Seeded sales for the closed-yesterday and open cash shifts,
 * referencing existing clients, products, lots, and payment methods.
 * All sales are CONFIRMED with appropriate items, lot assignments, and payments.
 */

function saleStartedAt(hour: number, minute: number): Date {
  return new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), hour, minute, 0);
}

function saleConfirmedAt(hour: number, minute: number): Date {
  return new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), hour, minute + 2, 0);
}

async function seedSaleClosed001(): Promise<void> {
  const saleId = IDS.SALE_CLOSED_001;
  const startedAt = saleStartedAt(9, 15);
  const confirmedAt = saleConfirmedAt(9, 15);
  const userId = IDS.USER_CASHIER1;
  const wsId = IDS.WS_PRINCIPAL;

  // Sale 1 — Clínica San José (institucional, 10% desc): material médico-quirúrgico
  await prisma.sale.upsert({
    where: { id: saleId },
    update: {},
    create: {
      id: saleId,
      localNumber: BigInt(1),
      internalNumber: 1001,
      operationalState: 'CONFIRMED',
      startedAt,
      confirmedAt,
      lastModifiedAt: confirmedAt,
      clientId: IDS.CLIENT_CLINICA_SAN_JOSE,
      clientIdentificationTypeSnapshot: 'NIT',
      clientIdentificationNumberSnapshot: '900555666-1',
      clientNameSnapshot: 'Clínica San José S.A.S.',
      clientTypeSnapshot: 'INSTITUTIONAL',
      clientClassificationIdSnapshot: IDS.CLASS_INSTITUCIONAL,
      subtotal: '597500.00',
      totalDiscount: '59750.00',
      totalTax: '102125.00',
      totalCost: '380000.00',
      totalAmount: '639875.00',
      changeAmount: '0',
      cashShiftId: IDS.SHIFT_CLOSED_YESTERDAY,
      workstationId: wsId,
      userId,
      sourceWorkstationId: wsId,
      sourceCreatedAt: startedAt,
    },
  });

  // Items
  const items = [
    { id: `${saleId}_it_1`, productId: IDS.PROD_GUANTES_LATEX_M, qty: 25, unitPrice: '12000.00', unitCost: '7500.00', taxRate: '19.0000', taxAmount: '57000.00', discountPct: '10.00', discountAmt: '30000.00', subtotal: '300000.00', total: '327000.00', lotId: IDS.LOT_GUANTES_001, previousStock: 300 },
    { id: `${saleId}_it_2`, productId: IDS.PROD_GASA_ESTERIL, qty: 20, unitPrice: '6500.00', unitCost: '4000.00', taxRate: '19.0000', taxAmount: '24700.00', discountPct: '10.00', discountAmt: '13000.00', subtotal: '130000.00', total: '141700.00', lotId: IDS.LOT_GASA_001, previousStock: 60 },
    { id: `${saleId}_it_3`, productId: IDS.PROD_ALCOHOL_70, qty: 15, unitPrice: '8500.00', unitCost: '5500.00', taxRate: '19.0000', taxAmount: '24225.00', discountPct: '10.00', discountAmt: '12750.00', subtotal: '127500.00', total: '138975.00', lotId: IDS.LOT_ALCOHOL_001, previousStock: 40 },
    { id: `${saleId}_it_4`, productId: IDS.PROD_JERINGA_3ML, qty: 50, unitPrice: '800.00', unitCost: '400.00', taxRate: '19.0000', taxAmount: '7600.00', discountPct: '10.00', discountAmt: '4000.00', subtotal: '40000.00', total: '43600.00', lotId: IDS.LOT_JERINGA_001, previousStock: 500 },
  ];

  for (const it of items) {
    const itemSubtotal = it.subtotal;
    const itemTotal = it.total;
    const resultingStock = it.previousStock - it.qty;

    await prisma.saleItem.upsert({
      where: { id: it.id },
      update: {},
      create: {
        id: it.id,
        saleId,
        productId: it.productId,
        productInternalCodeSnapshot: '',
        productCommercialNameSnapshot: '',
        productGenericNameSnapshot: '',
        quantity: it.qty,
        unitPrice: it.unitPrice,
        unitCost: it.unitCost,
        taxRate: it.taxRate,
        taxAmount: it.taxAmount,
        discountPercentage: it.discountPct,
        discountAmount: it.discountAmt,
        discountReason: 'Descuento institucional 10%',
        subtotal: itemSubtotal,
        total: itemTotal,
        requiresPrescription: false,
      },
    });

    await prisma.saleItemLot.upsert({
      where: { id: `${it.id}_lot` },
      update: {},
      create: {
        id: `${it.id}_lot`,
        saleItemId: it.id,
        lotId: it.lotId,
        quantity: it.qty,
        unitCostAtSale: it.unitCost,
      },
    });

    // Inventory movement — stock decrement from sale
    await prisma.inventoryMovement.upsert({
      where: { id: `mov_sale_${it.id}` },
      update: {},
      create: {
        id: `mov_sale_${it.id}`,
        movementType: 'SALE',
        quantity: it.qty,
        previousStock: it.previousStock,
        resultingStock,
        lotId: it.lotId,
        saleId,
        createdById: userId,
        reason: 'Venta confirmada',
        createdAt: confirmedAt,
      },
    });

    // Update lot stock
    await prisma.lot.update({
      where: { id: it.lotId },
      data: { currentStock: resultingStock },
    });
  }

  // Payment — bank transfer (full amount)
  await prisma.salePayment.upsert({
    where: { id: `${saleId}_pay_1` },
    update: {},
    create: {
      id: `${saleId}_pay_1`,
      saleId,
      paymentMethodId: IDS.PAY_TRANSFERENCIA,
      amount: '639875.00',
      transactionReference: 'TRF-2025-001',
    },
  });
}

async function seedSaleClosed002(): Promise<void> {
  const saleId = IDS.SALE_CLOSED_002;
  const startedAt = saleStartedAt(11, 30);
  const confirmedAt = saleConfirmedAt(11, 30);
  const userId = IDS.USER_CASHIER1;
  const wsId = IDS.WS_PRINCIPAL;

  // Sale 2 — Juan Pérez (frecuente, 5% desc): medicamentos crónicos
  await prisma.sale.upsert({
    where: { id: saleId },
    update: {},
    create: {
      id: saleId,
      localNumber: BigInt(2),
      internalNumber: 1002,
      operationalState: 'CONFIRMED',
      startedAt,
      confirmedAt,
      lastModifiedAt: confirmedAt,
      clientId: IDS.CLIENT_JUAN,
      clientIdentificationTypeSnapshot: 'CC',
      clientIdentificationNumberSnapshot: '1234567890',
      clientNameSnapshot: 'Juan Pérez',
      clientTypeSnapshot: 'FREQUENT',
      clientClassificationIdSnapshot: IDS.CLASS_FRECUENTE,
      subtotal: '450000.00',
      totalDiscount: '22500.00',
      totalTax: '85500.00',
      totalCost: '280000.00',
      totalAmount: '513000.00',
      changeAmount: '0',
      cashShiftId: IDS.SHIFT_CLOSED_YESTERDAY,
      workstationId: wsId,
      userId,
      sourceWorkstationId: wsId,
      sourceCreatedAt: startedAt,
    },
  });

  const items = [
    { id: `${saleId}_it_1`, productId: IDS.PROD_LOSARTAN_50, qty: 30, unitPrice: '6800.00', unitCost: '4200.00', taxRate: '5.0000', taxAmount: '10200.00', discountPct: '5.00', discountAmt: '10200.00', subtotal: '204000.00', total: '204000.00', lotId: IDS.LOT_LOS_001, previousStock: 100 },
    { id: `${saleId}_it_2`, productId: IDS.PROD_ENALAPRIL_10, qty: 20, unitPrice: '2900.00', unitCost: '1600.00', taxRate: '19.0000', taxAmount: '11020.00', discountPct: '5.00', discountAmt: '2900.00', subtotal: '58000.00', total: '66120.00', lotId: IDS.LOT_ENAL_001, previousStock: 50 },
    { id: `${saleId}_it_3`, productId: IDS.PROD_OMEPRAZOL_20, qty: 40, unitPrice: '2200.00', unitCost: '1200.00', taxRate: '19.0000', taxAmount: '16720.00', discountPct: '5.00', discountAmt: '4400.00', subtotal: '88000.00', total: '100320.00', lotId: IDS.LOT_OME_001, previousStock: 150 },
    { id: `${saleId}_it_4`, productId: IDS.PROD_VITAMINA_C_500, qty: 30, unitPrice: '2800.00', unitCost: '1500.00', taxRate: '0.0000', taxAmount: '0', discountPct: '5.00', discountAmt: '4200.00', subtotal: '84000.00', total: '79800.00', lotId: IDS.LOT_VITC_001, previousStock: 100 },
    { id: `${saleId}_it_5`, productId: IDS.PROD_ACETAMINOFEN_500, qty: 20, unitPrice: '3500.00', unitCost: '1800.00', taxRate: '5.0000', taxAmount: '3500.00', discountPct: '5.00', discountAmt: '3500.00', subtotal: '70000.00', total: '70000.00', lotId: IDS.LOT_ACET_001, previousStock: 120 },
  ];

  for (const it of items) {
    const resultingStock = it.previousStock - it.qty;

    await prisma.saleItem.upsert({
      where: { id: it.id },
      update: {},
      create: {
        id: it.id,
        saleId,
        productId: it.productId,
        productInternalCodeSnapshot: '',
        productCommercialNameSnapshot: '',
        productGenericNameSnapshot: '',
        quantity: it.qty,
        unitPrice: it.unitPrice,
        unitCost: it.unitCost,
        taxRate: it.taxRate,
        taxAmount: it.taxAmount,
        discountPercentage: it.discountPct,
        discountAmount: it.discountAmt,
        discountReason: 'Descuento cliente frecuente 5%',
        subtotal: it.subtotal,
        total: it.total,
        requiresPrescription: it.productId === IDS.PROD_LOSARTAN_50 || it.productId === IDS.PROD_ENALAPRIL_10,
      },
    });

    await prisma.saleItemLot.upsert({
      where: { id: `${it.id}_lot` },
      update: {},
      create: {
        id: `${it.id}_lot`,
        saleItemId: it.id,
        lotId: it.lotId,
        quantity: it.qty,
        unitCostAtSale: it.unitCost,
      },
    });

    // Inventory movement — stock decrement from sale
    await prisma.inventoryMovement.upsert({
      where: { id: `mov_sale_${it.id}` },
      update: {},
      create: {
        id: `mov_sale_${it.id}`,
        movementType: 'SALE',
        quantity: it.qty,
        previousStock: it.previousStock,
        resultingStock,
        lotId: it.lotId,
        saleId,
        createdById: userId,
        reason: 'Venta confirmada',
        createdAt: confirmedAt,
      },
    });

    // Update lot stock
    await prisma.lot.update({
      where: { id: it.lotId },
      data: { currentStock: resultingStock },
    });
  }

  // Payment — cash + debit card split
  await prisma.salePayment.upsert({
    where: { id: `${saleId}_pay_1` },
    update: {},
    create: {
      id: `${saleId}_pay_1`,
      saleId,
      paymentMethodId: IDS.PAY_EFECTIVO,
      amount: '263000.00',
    },
  });

  await prisma.salePayment.upsert({
    where: { id: `${saleId}_pay_2` },
    update: {},
    create: {
      id: `${saleId}_pay_2`,
      saleId,
      paymentMethodId: IDS.PAY_TARJETA_DEBITO,
      amount: '250000.00',
      transactionReference: 'DB-2025-001',
      cardBrand: 'Visa',
      cardLastFour: '4567',
      authorizationCode: 'AUTH-001',
    },
  });
}

async function seedSaleOpen001(): Promise<void> {
  const saleId = IDS.SALE_OPEN_001;
  const startedAt = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 10, 0, 0);
  const confirmedAt = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 10, 3, 0);
  const userId = IDS.USER_CASHIER1;
  const wsId = IDS.WS_PRINCIPAL;

  // Sale 3 — María González (particular, sin descuento): antibióticos + respiratorio
  await prisma.sale.upsert({
    where: { id: saleId },
    update: {},
    create: {
      id: saleId,
      localNumber: BigInt(1),
      operationalState: 'CONFIRMED',
      startedAt,
      confirmedAt,
      lastModifiedAt: confirmedAt,
      clientId: IDS.CLIENT_MARIA,
      clientIdentificationTypeSnapshot: 'CC',
      clientIdentificationNumberSnapshot: '2345678901',
      clientNameSnapshot: 'María González',
      clientTypeSnapshot: 'PARTICULAR',
      subtotal: '109400.00',
      totalDiscount: '0',
      totalTax: '20786.00',
      totalCost: '58000.00',
      totalAmount: '130186.00',
      changeAmount: '0',
      cashShiftId: IDS.SHIFT_OPEN,
      workstationId: wsId,
      userId,
      sourceWorkstationId: wsId,
      sourceCreatedAt: startedAt,
    },
  });

  const items = [
    { id: `${saleId}_it_1`, productId: IDS.PROD_AMOXICILINA_500, qty: 14, unitPrice: '1800.00', unitCost: '900.00', taxRate: '19.0000', taxAmount: '4788.00', subtotal: '25200.00', total: '29988.00', lotId: IDS.LOT_AMOX_001, previousStock: 215 },
    { id: `${saleId}_it_2`, productId: IDS.PROD_AZITROMICINA_500, qty: 2, unitPrice: '12500.00', unitCost: '7500.00', taxRate: '19.0000', taxAmount: '4750.00', subtotal: '25000.00', total: '29750.00', lotId: IDS.LOT_AZIT_001, previousStock: 35 },
    { id: `${saleId}_it_3`, productId: IDS.PROD_LORATADINA_10, qty: 2, unitPrice: '4500.00', unitCost: '2500.00', taxRate: '19.0000', taxAmount: '1710.00', subtotal: '9000.00', total: '10710.00', lotId: IDS.LOT_LORAT_001, previousStock: 90 },
    { id: `${saleId}_it_4`, productId: IDS.PROD_DOLEX_FORTE, qty: 5, unitPrice: '5600.00', unitCost: '3200.00', taxRate: '19.0000', taxAmount: '5320.00', subtotal: '28000.00', total: '33320.00', lotId: IDS.LOT_DOLEX_001, previousStock: 200 },
    { id: `${saleId}_it_5`, productId: IDS.PROD_SALBUTAMOL_100, qty: 1, unitPrice: '22000.00', unitCost: '14000.00', taxRate: '19.0000', taxAmount: '4180.00', subtotal: '22000.00', total: '26180.00', lotId: IDS.LOT_SALB_001, previousStock: 25 },
  ];

  for (const it of items) {
    const resultingStock = it.previousStock - it.qty;

    await prisma.saleItem.upsert({
      where: { id: it.id },
      update: {},
      create: {
        id: it.id,
        saleId,
        productId: it.productId,
        productInternalCodeSnapshot: '',
        productCommercialNameSnapshot: '',
        productGenericNameSnapshot: '',
        quantity: it.qty,
        unitPrice: it.unitPrice,
        unitCost: it.unitCost,
        taxRate: it.taxRate,
        taxAmount: it.taxAmount,
        discountPercentage: '0',
        discountAmount: '0',
        subtotal: it.subtotal,
        total: it.total,
        requiresPrescription: it.productId === IDS.PROD_AMOXICILINA_500 || it.productId === IDS.PROD_AZITROMICINA_500 || it.productId === IDS.PROD_SALBUTAMOL_100,
      },
    });

    await prisma.saleItemLot.upsert({
      where: { id: `${it.id}_lot` },
      update: {},
      create: {
        id: `${it.id}_lot`,
        saleItemId: it.id,
        lotId: it.lotId,
        quantity: it.qty,
        unitCostAtSale: it.unitCost,
      },
    });

    // Inventory movement — stock decrement from sale
    await prisma.inventoryMovement.upsert({
      where: { id: `mov_sale_${it.id}` },
      update: {},
      create: {
        id: `mov_sale_${it.id}`,
        movementType: 'SALE',
        quantity: it.qty,
        previousStock: it.previousStock,
        resultingStock,
        lotId: it.lotId,
        saleId,
        createdById: userId,
        reason: 'Venta confirmada',
        createdAt: confirmedAt,
      },
    });

    // Update lot stock
    await prisma.lot.update({
      where: { id: it.lotId },
      data: { currentStock: resultingStock },
    });
  }

  // Payment — mixed: cash + Nequi
  await prisma.salePayment.upsert({
    where: { id: `${saleId}_pay_1` },
    update: {},
    create: {
      id: `${saleId}_pay_1`,
      saleId,
      paymentMethodId: IDS.PAY_EFECTIVO,
      amount: '100000.00',
    },
  });

  await prisma.salePayment.upsert({
    where: { id: `${saleId}_pay_2` },
    update: {},
    create: {
      id: `${saleId}_pay_2`,
      saleId,
      paymentMethodId: IDS.PAY_NEQUI,
      amount: '30186.00',
      transactionReference: 'NEQ-2025-001',
    },
  });
}

export async function seedSales(): Promise<void> {
  console.log('Seeding sales...');
  await seedSaleClosed001();
  await seedSaleClosed002();
  await seedSaleOpen001();
  console.log('   3 sales (2 closed shift, 1 open shift) with items, lots, payments');
}
