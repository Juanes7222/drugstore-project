import { prisma } from '../helpers/db';
import { seedMany } from '../helpers/upsert';
import { IDS } from '../constants/ids';
import { NOW, SIX_MONTHS_AGO, YESTERDAY } from '../constants/dates';

export async function seedWorkstations(): Promise<void> {
  console.log('Seeding workstations...');
  const workstations = [
    { id: IDS.WS_PRINCIPAL, name: 'Caja Principal', code: 'WS-001', registeredAt: SIX_MONTHS_AGO, lastSeenAt: NOW },
    { id: IDS.WS_SECUNDARIA, name: 'Caja Secundaria', code: 'WS-002', registeredAt: SIX_MONTHS_AGO, lastSeenAt: YESTERDAY },
  ];
  await seedMany(prisma.workstation, workstations);
  console.log('   2 workstations');
}