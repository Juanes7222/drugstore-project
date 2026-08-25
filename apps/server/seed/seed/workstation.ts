import { prisma } from '../helpers/db';
import { seedMany } from '../helpers/upsert';
import { IDS } from '../constants/ids';
import { NOW, SIX_MONTHS_AGO, YESTERDAY } from '../constants/dates';

export async function seedWorkstations(): Promise<void> {
  console.log('Seeding workstations...');
  const workstations = [
    { id: IDS.WS_PRINCIPAL, name: 'Caja Principal', code: 'WS-001', registeredAt: SIX_MONTHS_AGO, lastSeenAt: NOW },
    { id: IDS.WS_SECUNDARIA, name: 'Caja Secundaria', code: 'WS-002', registeredAt: SIX_MONTHS_AGO, lastSeenAt: YESTERDAY },
    // Extra stations for multi-station dev testing (dev:multi --stations=N).
    // Deliberately WITHOUT WorkstationActivation rows: auth succeeds, but the
    // licensing layer must reject their activation because the seeded
    // PROFESSIONAL plan allows 2 workstations per location and both slots
    // are already taken by the activations above.
    { id: IDS.WS_TERCERA, name: 'Caja Tercera', code: 'WS-003', registeredAt: NOW, lastSeenAt: null },
    { id: IDS.WS_CUARTA, name: 'Caja Cuarta', code: 'WS-004', registeredAt: NOW, lastSeenAt: null },
  ];
  // Workstation is a shared catalog (no tenant column — the tenant lives on
  // WorkstationActivation in licensing), so no subscriptionId is stamped here.
  await seedMany(prisma.workstation, workstations);
  console.log('   4 workstations');
}
