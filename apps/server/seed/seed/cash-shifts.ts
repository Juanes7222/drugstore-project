import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { NOW, YESTERDAY } from '../constants/dates';

export async function seedCashShifts(): Promise<void> {
  console.log('Seeding cash shifts...');

  await prisma.cashShift.upsert({
    where: { id: IDS.SHIFT_OPEN },
    update: {},
    create: {
      id: IDS.SHIFT_OPEN,
      workstationId: IDS.WS_PRINCIPAL,
      userId: IDS.USER_CASHIER1,
      state: 'OPEN',
      openedAt: NOW,
      openingBalance: '200000.00',
      openingNotes: 'Turno de la mañana',
      expectedClosingAmount: '0',
      actualClosingAmount: '0',
      closingDifference: '0',
      forcedClose: false,
      hasExtendedAlert: false,
    },
  });

  const yesterdayOpen = new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 8, 0, 0);
  const yesterdayClose = new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 20, 0, 0);

  await prisma.cashShift.upsert({
    where: { id: IDS.SHIFT_CLOSED_YESTERDAY },
    update: {},
    create: {
      id: IDS.SHIFT_CLOSED_YESTERDAY,
      workstationId: IDS.WS_PRINCIPAL,
      userId: IDS.USER_CASHIER1,
      state: 'CLOSED',
      openedAt: yesterdayOpen,
      closedAt: yesterdayClose,
      closedByUserId: IDS.USER_CASHIER1,
      openingBalance: '200000.00',
      openingNotes: 'Turno de ayer',
      expectedClosingAmount: '1856000.00',
      actualClosingAmount: '1855000.00',
      closingDifference: '-1000.00',
      closingNotes: 'Faltante de $1,000',
      forcedClose: false,
      hasExtendedAlert: false,
    },
  });

  await prisma.shiftCashCount.upsert({
    where: { id: IDS.SHIFT_COUNT_CLOSED_1 },
    update: {
      expectedAmount: '1856000.00',
      declaredAmount: '1855000.00',
      difference: '-1000.00',
    },
    create: {
      id: IDS.SHIFT_COUNT_CLOSED_1,
      cashShiftId: IDS.SHIFT_CLOSED_YESTERDAY,
      countType: 'CLOSING',
      paymentMethodId: IDS.PAY_EFECTIVO,
      paymentMethodIsCash: true,
      expectedAmount: '1856000.00',
      declaredAmount: '1855000.00',
      difference: '-1000.00',
      createdById: IDS.USER_CASHIER1,
    },
  });

  console.log('   2 cash shifts (1 open, 1 closed)');
}