import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { YESTERDAY, SIX_MONTHS_AGO, NOW } from '../constants/dates';

/**
 * Seeds completed SyncQueue items representing operations that were
 * already ingested from offline workstations.
 */

async function seedSyncItems(): Promise<void> {
  const wsId = IDS.WS_PRINCIPAL;
  const today = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());

  // Sync item 1 — sale confirmation from a past date
  await prisma.syncQueue.upsert({
    where: { id: IDS.SYNC_SALE_001 },
    update: {},
    create: {
      id: IDS.SYNC_SALE_001,
      operationUuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      operationType: 'SALE_CONFIRMATION',
      payload: JSON.stringify({
        saleId: IDS.SALE_CLOSED_001,
        localNumber: 1,
        workstationId: wsId,
        totalAmount: '639875.00',
      }),
      payloadHash: 'sha256-00000000000000000000000000000000000000000000',
      payloadSize: 256,
      status: 'COMPLETED',
      sourceWorkstationId: wsId,
      sourceCreatedAt: new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 9, 15, 0),
      clientSequence: BigInt(1),
      receivedAt: new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 9, 16, 0),
      processedAt: new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 9, 17, 0),
      correlationId: IDS.SALE_CLOSED_001,
      workstationId: wsId,
    },
  });

  // Sync item 2 — another sale confirmation
  await prisma.syncQueue.upsert({
    where: { id: IDS.SYNC_SALE_002 },
    update: {},
    create: {
      id: IDS.SYNC_SALE_002,
      operationUuid: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      operationType: 'SALE_CONFIRMATION',
      payload: JSON.stringify({
        saleId: IDS.SALE_CLOSED_002,
        localNumber: 2,
        workstationId: wsId,
        totalAmount: '513000.00',
      }),
      payloadHash: 'sha256-11111111111111111111111111111111111111111111',
      payloadSize: 258,
      status: 'COMPLETED',
      sourceWorkstationId: wsId,
      sourceCreatedAt: new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 11, 30, 0),
      clientSequence: BigInt(2),
      receivedAt: new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 11, 31, 0),
      processedAt: new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 11, 32, 0),
      correlationId: IDS.SALE_CLOSED_002,
      workstationId: wsId,
    },
  });

  // Sync item 3 — client creation from offline
  await prisma.syncQueue.upsert({
    where: { id: IDS.SYNC_CLIENT_001 },
    update: {},
    create: {
      id: IDS.SYNC_CLIENT_001,
      operationUuid: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
      operationType: 'CLIENT_CREATION',
      payload: JSON.stringify({
        clientId: IDS.CLIENT_SOFIA,
        fullName: 'Sofía Hernández',
        identificationType: 'CC',
        identificationNumber: '8901234567',
      }),
      payloadHash: 'sha256-22222222222222222222222222222222222222222222',
      payloadSize: 180,
      status: 'COMPLETED',
      sourceWorkstationId: IDS.WS_SECUNDARIA,
      sourceCreatedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 15, 14, 0, 0),
      clientSequence: BigInt(1),
      receivedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 15, 14, 5, 0),
      processedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 15, 14, 6, 0),
      correlationId: IDS.CLIENT_SOFIA,
      workstationId: IDS.WS_SECUNDARIA,
    },
  });
}

export async function seedSyncQueue(): Promise<void> {
  console.log('Seeding sync queue...');
  await seedSyncItems();
  console.log('   3 sync queue items (2 sales, 1 client creation)');
}
