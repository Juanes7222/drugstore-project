import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TenantContextInterceptor } from '../src/modules/tenant/tenant-context.interceptor';
import { JwtService } from '@nestjs/jwt';
import { SyncProcessingJob } from '../src/modules/sync/jobs/sync-processing.job';
import { SyncHousekeepingJob } from '../src/modules/sync/jobs/sync-housekeeping.job';
import { seedSubscription } from './helpers/subscription-seed';

/**
 * End-to-end convergence test for the hub/workstation sync topology.
 *
 * The system runs several workstations on a pharmacy LAN; one of them acts as
 * the local hub and relays operations to the server. This spec exercises the
 * two directions of that flow against a real Postgres database and asserts on
 * persisted rows, never on HTTP codes alone:
 *
 *   workstation -> hub -> server : POST /sync/batch
 *   server -> hub -> workstation : GET /sync/events/pending + acknowledge
 *
 * Two distinct workstations and two distinct users are seeded on purpose: the
 * server attributes a batch to the origin workstation from the authenticated
 * session (`lastLoginWorkstationId`), so a single shared user would mask
 * cross-workstation mixing.
 */

// API DTOs validate ids as UUIDs (z.uuid()), so every seeded id must be
// UUID-shaped. Values are deterministic so reruns reuse the same rows.
const uuidFrom = (seed: string): string => {
  const h = crypto.createHash('sha256').update(seed).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `8${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join('-');
};

const HUB_WORKSTATION_ID = uuidFrom('e2e-sync-hub-workstation');
const ORIGIN_WORKSTATION_ID = uuidFrom('e2e-sync-origin-workstation');
const HUB_USER_ID = 'e2e-sync-hub-user-id';
const ORIGIN_USER_ID = 'e2e-sync-origin-user-id';
const SHARED_USER_ID = 'e2e-sync-shared-user-id';
const HUB_USERNAME = 'e2e-sync-hub@sync.test';
const ORIGIN_USERNAME = 'e2e-sync-origin@sync.test';
const SHARED_USERNAME = 'e2e-sync-shared@sync.test';
const TEST_PASSWORD = 'SyncPass123!';
const TEST_PRODUCT_ID = uuidFrom('e2e-sync-product-id');
const TEST_TAX_SCHEME_ID = uuidFrom('e2e-sync-tax-scheme-id');

/** Offline-created product: the POS sends the OFFLINE- sentinel as its code. */
const PRODUCT_CREATION_OP_UUID = uuidFrom('e2e-sync-op-product-creation');
const POS_LOCAL_PRODUCT_ID = uuidFrom('e2e-sync-pos-local-product-id');
const AUDIT_BATCH_OP_UUID = uuidFrom('e2e-sync-op-audit-batch');
const OFFLINE_BATCH_OP_UUID = uuidFrom('e2e-sync-op-offline-batch');
const FINGERPRINTLESS_OP_UUID = uuidFrom('e2e-sync-op-fingerprintless');
const EXPIRED_BEARER_OP_UUID = uuidFrom('e2e-sync-op-expired-bearer');
const BAD_OFFLINE_OP_UUID = uuidFrom('e2e-sync-op-bad-offline');
const AUDIT_LOG_ENTRY_ID = uuidFrom('e2e-sync-audit-log-entry');
const AUDIT_LOG_ENTRY_ID_UPPER = uuidFrom('e2e-sync-audit-log-entry-upper');
const SHIFT_OPEN_OP_UUID = uuidFrom('e2e-sync-op-shift-open');
const SECOND_SHIFT_OPEN_OP_UUID = uuidFrom('e2e-sync-op-shift-open-second');
const TEST_SHIFT_ID = uuidFrom('e2e-sync-shift-id');
const SECOND_SHIFT_ID = uuidFrom('e2e-sync-shift-id-second');
const TEST_LOT_ID = uuidFrom('e2e-sync-lot-id');
const TEST_LOT_BATCH = 'E2E-SYNC-CRON-LOT';
const CRON_ADJUSTMENT_OP_UUID = uuidFrom('e2e-sync-op-cron-adjustment');
const ADJUSTMENT_QUANTITY = 7;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sha256 = (value: unknown): string =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Payload for the single operation type used throughout this spec. */
const buildProductUpdatePayload = (note: string) => ({
  productId: TEST_PRODUCT_ID,
  updateProductDto: {
    commercialName: 'E2E Sync Product',
    internalNotes: note,
  },
  userId: ORIGIN_USER_ID,
});

interface OperationOverrides {
  operationUuid: string;
  clientSequence: number;
  source?: 'DIRECT' | 'LOCAL_HUB';
  operationType?: string;
  payload?: Record<string, unknown>;
  payloadHash?: string;
}

describe('Sync hub convergence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let subscriptionId: string;
  let hubToken: string;
  let originToken: string;

  /** Builds a wire-format operation whose hash matches its payload. */
  const buildOperation = (overrides: OperationOverrides) => {
    const payload =
      overrides.payload ?? buildProductUpdatePayload('synced-from-origin');
    return {
      operationType: overrides.operationType ?? 'PRODUCT_UPDATE',
      operationUuid: overrides.operationUuid,
      payload,
      payloadHash: overrides.payloadHash ?? sha256(payload),
      sourceCreatedAt: new Date().toISOString(),
      clientSequence: overrides.clientSequence,
      source: overrides.source ?? 'DIRECT',
    };
  };

  /**
   * Binds the session to a workstation. The workstation travels in the login
   * BODY: the `x-workstation-id` header is not read by POST /auth/login, and a
   * login without `workstationId` is silently attributed to the shared
   * WEB_ADMIN virtual workstation — which would make every operation this
   * spec pushes look like it came from the backoffice.
   */
  const login = async (
    identifier: string,
    workstationId: string,
  ): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        identifier,
        secret: TEST_PASSWORD,
        sessionType: 'PASSWORD',
        workstationId,
      })
      .expect(200);
    return res.body.accessToken as string;
  };

  const sendBatch = (token: string, operations: unknown[]) =>
    request(app.getHttpServer())
      .post('/sync/batch')
      .set('Authorization', `Bearer ${token}`)
      .send(operations);

  const pendingEvents = async (workstationId: string): Promise<string[]> => {
    const res = await request(app.getHttpServer())
      .get('/sync/events/pending')
      .query({ workstationId })
      .set('Authorization', `Bearer ${hubToken}`)
      .expect(200);
    return (res.body as Array<{ id: string }>).map((event) => event.id);
  };

  const createEvent = async (
    body: Record<string, unknown>,
  ): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/sync/events')
      .set('Authorization', `Bearer ${hubToken}`)
      .send(body)
      .expect(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await prisma.$connect();

    subscriptionId = await seedSubscription(prisma, 'sync');

    // Sync rows are scoped by tenant, not by workstation: an operation sent
    // without a workstation in the login body lands under the shared WEB_ADMIN
    // workstation, so cleaning by workstation id silently leaks rows whose
    // operationUuid then collides on the next run.
    await prisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await prisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await prisma.syncEventAcknowledgment.deleteMany({
      where: { subscriptionId },
    });
    await prisma.syncEvent.deleteMany({ where: { subscriptionId } });
    await prisma.syncConflictLog.deleteMany({ where: { subscriptionId } });
    await prisma.workstationHeartbeat.deleteMany({
      where: {
        workstationId: { in: [HUB_WORKSTATION_ID, ORIGIN_WORKSTATION_ID] },
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        userId: { in: [HUB_USER_ID, ORIGIN_USER_ID, SHARED_USER_ID] },
      },
    });
    // Offline audit rows arrive with a null userId (the local one is kept in
    // details), so they are not covered by the delete above.
    await prisma.auditLog.deleteMany({
      where: { id: { in: [AUDIT_LOG_ENTRY_ID, AUDIT_LOG_ENTRY_ID_UPPER] } },
    });
    await prisma.shiftCashCount.deleteMany({
      where: { cashShift: { id: { in: [TEST_SHIFT_ID, SECOND_SHIFT_ID] } } },
    });
    await prisma.cashShift.deleteMany({
      where: { id: { in: [TEST_SHIFT_ID, SECOND_SHIFT_ID] } },
    });
    // Movements reference the adjustment document and the lot, so they go first.
    await prisma.inventoryMovement.deleteMany({
      where: { lotId: TEST_LOT_ID },
    });
    await prisma.inventoryAdjustmentDocument.deleteMany({
      where: { subscriptionId },
    });
    await prisma.lot.deleteMany({ where: { id: TEST_LOT_ID } });
    await prisma.auditLog.deleteMany({
      where: { id: { in: [AUDIT_LOG_ENTRY_ID, AUDIT_LOG_ENTRY_ID_UPPER] } },
    });
    await prisma.productPriceHistory.deleteMany({
      where: { product: { sourceOperationUuid: PRODUCT_CREATION_OP_UUID } },
    });
    await prisma.productTaxHistory.deleteMany({
      where: { product: { sourceOperationUuid: PRODUCT_CREATION_OP_UUID } },
    });
    await prisma.product.deleteMany({
      where: { sourceOperationUuid: PRODUCT_CREATION_OP_UUID },
    });
    await prisma.product.deleteMany({ where: { id: TEST_PRODUCT_ID } });
    await prisma.taxScheme.deleteMany({ where: { id: TEST_TAX_SCHEME_ID } });
    await prisma.userSession.deleteMany({
      where: {
        userId: { in: [HUB_USER_ID, ORIGIN_USER_ID, SHARED_USER_ID] },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [HUB_USER_ID, ORIGIN_USER_ID, SHARED_USER_ID] },
      },
    });
    await prisma.workstation.deleteMany({
      where: { id: { in: [HUB_WORKSTATION_ID, ORIGIN_WORKSTATION_ID] } },
    });

    await prisma.workstation.createMany({
      data: [
        {
          id: HUB_WORKSTATION_ID,
          name: 'E2E Sync Hub Workstation',
          code: 'WS-E2E-SYNC-HUB',
          isActive: true,
          registeredAt: new Date(),
        },
        {
          id: ORIGIN_WORKSTATION_ID,
          name: 'E2E Sync Origin Workstation',
          code: 'WS-E2E-SYNC-ORIGIN',
          isActive: true,
          registeredAt: new Date(),
        },
      ],
    });

    const passwordHash = await argon2.hash(TEST_PASSWORD);
    await prisma.user.createMany({
      data: [
        {
          id: HUB_USER_ID,
          username: HUB_USERNAME,
          fullName: 'E2E Sync Hub Admin',
          passwordHash,
          passwordAlgorithm: 'argon2',
          role: 'ADMIN',
          subscriptionId,
          isActive: true,
        },
        {
          id: ORIGIN_USER_ID,
          username: ORIGIN_USERNAME,
          fullName: 'E2E Sync Origin Cashier',
          passwordHash,
          passwordAlgorithm: 'argon2',
          role: 'CASHIER',
          subscriptionId,
          isActive: true,
        },
        {
          id: SHARED_USER_ID,
          username: SHARED_USERNAME,
          fullName: 'E2E Sync Shared Cashier',
          passwordHash,
          passwordAlgorithm: 'argon2',
          role: 'CASHIER',
          subscriptionId,
          isActive: true,
        },
      ],
    });

    await prisma.product.create({
      data: {
        id: TEST_PRODUCT_ID,
        subscriptionId,
        internalCode: 'E2E-SYNC-001',
        commercialName: 'E2E Sync Product',
        laboratory: 'E2E Sync Lab',
        saleType: 'FREE_SALE',
        createdById: HUB_USER_ID,
      },
    });

    // PRODUCT_CREATION validates a full CreateProductDto, which requires an
    // initial price and a tax scheme to attach.
    await prisma.taxScheme.create({
      data: {
        id: TEST_TAX_SCHEME_ID,
        subscriptionId,
        code: 'E2E-SYNC-IVA19',
        name: 'E2E Sync IVA 19%',
        taxType: 'IVA',
        rate: new Prisma.Decimal('0.1900'),
        effectiveFrom: new Date('2024-01-01'),
        isActive: true,
        createdById: HUB_USER_ID,
      },
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(app.get(TenantContextInterceptor));
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    hubToken = await login(HUB_USERNAME, HUB_WORKSTATION_ID);
    originToken = await login(ORIGIN_USERNAME, ORIGIN_WORKSTATION_ID);
  }, 60000);

  afterAll(async () => {
    await prisma.syncOperationOutcome.deleteMany({ where: { subscriptionId } });
    await prisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await prisma.syncEventAcknowledgment.deleteMany({
      where: { subscriptionId },
    });
    await prisma.syncEvent.deleteMany({ where: { subscriptionId } });
    await prisma.syncConflictLog.deleteMany({ where: { subscriptionId } });
    await prisma.workstationHeartbeat.deleteMany({
      where: {
        workstationId: { in: [HUB_WORKSTATION_ID, ORIGIN_WORKSTATION_ID] },
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        userId: { in: [HUB_USER_ID, ORIGIN_USER_ID, SHARED_USER_ID] },
      },
    });
    // Offline audit rows arrive with a null userId (the local one is kept in
    // details), so they are not covered by the delete above.
    await prisma.auditLog.deleteMany({
      where: { id: { in: [AUDIT_LOG_ENTRY_ID, AUDIT_LOG_ENTRY_ID_UPPER] } },
    });
    await prisma.shiftCashCount.deleteMany({
      where: { cashShift: { id: { in: [TEST_SHIFT_ID, SECOND_SHIFT_ID] } } },
    });
    await prisma.cashShift.deleteMany({
      where: { id: { in: [TEST_SHIFT_ID, SECOND_SHIFT_ID] } },
    });
    // Movements reference the adjustment document and the lot, so they go first.
    await prisma.inventoryMovement.deleteMany({
      where: { lotId: TEST_LOT_ID },
    });
    await prisma.inventoryAdjustmentDocument.deleteMany({
      where: { subscriptionId },
    });
    await prisma.lot.deleteMany({ where: { id: TEST_LOT_ID } });
    await prisma.productPriceHistory.deleteMany({
      where: { product: { sourceOperationUuid: PRODUCT_CREATION_OP_UUID } },
    });
    await prisma.productTaxHistory.deleteMany({
      where: { product: { sourceOperationUuid: PRODUCT_CREATION_OP_UUID } },
    });
    await prisma.product.deleteMany({
      where: { sourceOperationUuid: PRODUCT_CREATION_OP_UUID },
    });
    await prisma.product.deleteMany({ where: { id: TEST_PRODUCT_ID } });
    await prisma.taxScheme.deleteMany({ where: { id: TEST_TAX_SCHEME_ID } });
    await prisma.userSession.deleteMany({
      where: {
        userId: { in: [HUB_USER_ID, ORIGIN_USER_ID, SHARED_USER_ID] },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [HUB_USER_ID, ORIGIN_USER_ID, SHARED_USER_ID] },
      },
    });
    await prisma.workstation.deleteMany({
      where: { id: { in: [HUB_WORKSTATION_ID, ORIGIN_WORKSTATION_ID] } },
    });

    await app.close();
    await prisma.$disconnect();
  }, 60000);

  describe('workstation -> hub -> server (POST /sync/batch)', () => {
    const appliedOperationUuid = uuidFrom('e2e-sync-op-applied');

    it('applies the operation to the server database and attributes it to the calling workstation', async () => {
      const note = 'applied-from-origin-workstation';
      const operation = buildOperation({
        operationUuid: appliedOperationUuid,
        clientSequence: 1,
        payload: buildProductUpdatePayload(note),
      });

      const res = await sendBatch(originToken, [operation]).expect(202);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toEqual({
        operationUuid: appliedOperationUuid,
        status: 'ACCEPTED',
      });

      // The change must be readable by a connection that does not belong to
      // the API process: this is the state the other workstations pull.
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: TEST_PRODUCT_ID },
        select: { internalNotes: true },
      });
      expect(product.internalNotes).toBe(note);

      const queueEntry = await prisma.syncQueue.findUniqueOrThrow({
        where: { operationUuid: appliedOperationUuid },
      });
      expect(queueEntry.status).toBe('COMPLETED');
      expect(queueEntry.sourceWorkstationId).toBe(ORIGIN_WORKSTATION_ID);
      expect(queueEntry.operationType).toBe('PRODUCT_UPDATE');
      expect(queueEntry.operationSource).toBe('DIRECT');
      expect(queueEntry.processedAt).not.toBeNull();
      expect(queueEntry.payloadSize).toBe(
        JSON.stringify(operation.payload).length,
      );

      // Server-side outcome ledger — the source of truth for sync health.
      const outcomes = await prisma.syncOperationOutcome.findMany({
        where: { operationUuid: appliedOperationUuid },
      });
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].outcome).toBe('ACCEPTED');
      expect(outcomes[0].workstationId).toBe(ORIGIN_WORKSTATION_ID);
    }, 30000);

    it('treats a re-sent batch as already accepted and never applies it twice', async () => {
      const operation = buildOperation({
        operationUuid: appliedOperationUuid,
        clientSequence: 1,
        payload: buildProductUpdatePayload('applied-from-origin-workstation'),
      });

      const res = await sendBatch(originToken, [operation]).expect(202);

      expect(res.body[0]).toEqual({
        operationUuid: appliedOperationUuid,
        status: 'ALREADY_ACCEPTED',
      });

      const queueCount = await prisma.syncQueue.count({
        where: { operationUuid: appliedOperationUuid },
      });
      expect(queueCount).toBe(1);

      const outcomeCount = await prisma.syncOperationOutcome.count({
        where: { operationUuid: appliedOperationUuid },
      });
      expect(outcomeCount).toBe(1);
    }, 30000);

    it('rejects an operation whose payload hash does not match and stores nothing', async () => {
      const tamperedUuid = uuidFrom('e2e-sync-op-tampered');
      const operation = buildOperation({
        operationUuid: tamperedUuid,
        clientSequence: 2,
        payload: buildProductUpdatePayload('tampered'),
        payloadHash: sha256({ productId: TEST_PRODUCT_ID, other: 'tampered' }),
      });

      const res = await sendBatch(originToken, [operation]).expect(202);

      expect(res.body[0].status).toBe('REJECTED');
      expect(res.body[0].error).toBe('PAYLOAD_HASH_MISMATCH');

      const queueCount = await prisma.syncQueue.count({
        where: { operationUuid: tamperedUuid },
      });
      expect(queueCount).toBe(0);
    }, 30000);

    it('records a hub-relayed operation as LOCAL_HUB and exposes it in the source statistics', async () => {
      const relayedUuid = uuidFrom('e2e-sync-op-relayed');
      const operation = buildOperation({
        operationUuid: relayedUuid,
        clientSequence: 3,
        source: 'LOCAL_HUB',
        payload: buildProductUpdatePayload('relayed-through-hub'),
      });

      const res = await sendBatch(hubToken, [operation]).expect(202);
      expect(res.body[0].status).toBe('ACCEPTED');

      const queueEntry = await prisma.syncQueue.findUniqueOrThrow({
        where: { operationUuid: relayedUuid },
      });
      expect(queueEntry.operationSource).toBe('LOCAL_HUB');
      expect(queueEntry.sourceWorkstationId).toBe(HUB_WORKSTATION_ID);

      const stats = await request(app.getHttpServer())
        .get('/sync/source-stats')
        .set('Authorization', `Bearer ${hubToken}`)
        .expect(200);

      expect(stats.body.windows['24h'].localHub).toBeGreaterThanOrEqual(1);
      const relayUuids = (
        stats.body.recentHubRelays as Array<{ operationUuid: string }>
      ).map((relay) => relay.operationUuid);
      expect(relayUuids).toContain(relayedUuid);
    }, 30000);
  });

  /**
   * Regression coverage for the four operation types that dispatch
   * synchronously inside the request (PRODUCT_CREATION, PRODUCT_UPDATE,
   * AUDIT_LOG_BATCH, SHIFT_OPEN).
   *
   * All four shared a bug where the queue row was never marked COMPLETED: the
   * immediate dispatch ran the status update in a nested $transaction, which
   * opens a second connection that cannot see the row the request transaction
   * has not committed yet. The row stayed PENDING forever, the background job
   * replayed it, and `*_CREATION` operations returned no entityId — which is
   * what made `assertProductsSynced` block the sale of a product the cashier
   * had just created offline. PRODUCT_UPDATE is covered above; these are the
   * other three.
   */
  describe('immediate-dispatch types (regression: rows stuck PENDING)', () => {
    it('returns the server id and code for an offline product creation and stamps them on the queue row', async () => {
      const operation = buildOperation({
        operationType: 'PRODUCT_CREATION',
        operationUuid: PRODUCT_CREATION_OP_UUID,
        clientSequence: 10,
        payload: {
          userId: ORIGIN_USER_ID,
          metadata: { productId: POS_LOCAL_PRODUCT_ID },
          createProductDto: {
            // The POS marks offline-created products with this sentinel; the
            // server replaces it with a short printable sequential code.
            internalCode: `OFFLINE-${POS_LOCAL_PRODUCT_ID}`,
            commercialName: 'Offline created product',
            laboratory: 'E2E Sync Lab',
            saleType: 'FREE_SALE',
            minimumStock: 0,
            initialPrice: '5000.00',
            initialTaxSchemeId: TEST_TAX_SCHEME_ID,
            commissionType: 'NONE',
            commissionValue: 0,
          },
        },
      });

      const res = await sendBatch(originToken, [operation]).expect(202);
      const [result] = res.body as Array<{
        operationUuid: string;
        status: string;
        entityId?: string;
        entityInternalCode?: string;
      }>;

      expect(result.status).toBe('ACCEPTED');
      // These two fields are what the POS stamps on its local row. Their
      // absence is the sales-blocking symptom described above.
      expect(result.entityId).toMatch(UUID_PATTERN);
      expect(result.entityInternalCode).toMatch(/^P\d+$/);

      const queueEntry = await prisma.syncQueue.findUniqueOrThrow({
        where: { operationUuid: PRODUCT_CREATION_OP_UUID },
      });
      expect(queueEntry.status).toBe('COMPLETED');
      expect(queueEntry.sourceWorkstationId).toBe(ORIGIN_WORKSTATION_ID);
      // A retry whose first response was lost reads these back, so they must
      // survive on the row, not only in the response.
      expect(queueEntry.entityId).toBe(result.entityId);
      expect(queueEntry.entityInternalCode).toBe(result.entityInternalCode);

      const product = await prisma.product.findUniqueOrThrow({
        where: { id: result.entityId },
        select: {
          internalCode: true,
          sourceOperationUuid: true,
          sourceProductId: true,
          subscriptionId: true,
        },
      });
      expect(product.internalCode).toBe(result.entityInternalCode);
      // The OFFLINE- sentinel must never reach the database.
      expect(product.internalCode.startsWith('OFFLINE-')).toBe(false);
      expect(product.sourceOperationUuid).toBe(PRODUCT_CREATION_OP_UUID);
      // The POS-local UUID is preserved so a later sale that references it
      // resolves to this server row.
      expect(product.sourceProductId).toBe(POS_LOCAL_PRODUCT_ID);
      expect(product.subscriptionId).toBe(subscriptionId);
    }, 30000);

    it('recovers the server-assigned ids when a lost-response retry arrives', async () => {
      const operation = buildOperation({
        operationType: 'PRODUCT_CREATION',
        operationUuid: PRODUCT_CREATION_OP_UUID,
        clientSequence: 10,
        payload: {
          userId: ORIGIN_USER_ID,
          metadata: { productId: POS_LOCAL_PRODUCT_ID },
          createProductDto: {
            internalCode: `OFFLINE-${POS_LOCAL_PRODUCT_ID}`,
            commercialName: 'Offline created product',
            laboratory: 'E2E Sync Lab',
            saleType: 'FREE_SALE',
            minimumStock: 0,
            initialPrice: '5000.00',
            initialTaxSchemeId: TEST_TAX_SCHEME_ID,
            commissionType: 'NONE',
            commissionValue: 0,
          },
        },
      });

      const res = await sendBatch(originToken, [operation]).expect(202);

      expect(res.body[0].status).toBe('ALREADY_ACCEPTED');
      // Without these, a POS whose first response was lost can never stamp
      // serverId and stays blocked.
      expect(res.body[0].entityId).toMatch(UUID_PATTERN);
      expect(res.body[0].entityInternalCode).toMatch(/^P\d+$/);

      const productCount = await prisma.product.count({
        where: { sourceOperationUuid: PRODUCT_CREATION_OP_UUID },
      });
      expect(productCount).toBe(1);
    }, 30000);

    it('applies an audit log batch and completes its queue row', async () => {
      const operation = buildOperation({
        operationType: 'AUDIT_LOG_BATCH',
        operationUuid: AUDIT_BATCH_OP_UUID,
        clientSequence: 11,
        payload: {
          logs: [
            {
              id: AUDIT_LOG_ENTRY_ID,
              action: 'UPDATE',
              category: 'INVENTORY',
              entityType: 'Product',
              entityId: TEST_PRODUCT_ID,
              entityName: 'E2E Sync Product',
              userId: ORIGIN_USER_ID,
              userRole: 'CASHIER',
              workstationId: ORIGIN_WORKSTATION_ID,
              createdAt: new Date().toISOString(),
            },
            {
              // Same category in a different case must land in the same
              // module instead of silently falling back to SYNC_OFFLINE.
              id: AUDIT_LOG_ENTRY_ID_UPPER,
              action: 'UPDATE',
              category: 'INVENTORY',
              entityType: 'Product',
              entityId: TEST_PRODUCT_ID,
              userId: ORIGIN_USER_ID,
              userRole: 'CASHIER',
              workstationId: ORIGIN_WORKSTATION_ID,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      });

      const res = await sendBatch(originToken, [operation]).expect(202);
      expect(res.body[0].status).toBe('ACCEPTED');

      const queueEntry = await prisma.syncQueue.findUniqueOrThrow({
        where: { operationUuid: AUDIT_BATCH_OP_UUID },
      });
      expect(queueEntry.status).toBe('COMPLETED');

      // The payload's `category` lands in the `module` column (SystemModule).
      const auditRows = await prisma.auditLog.findMany({
        where: { id: { in: [AUDIT_LOG_ENTRY_ID, AUDIT_LOG_ENTRY_ID_UPPER] } },
        select: { id: true, action: true, module: true, subscriptionId: true },
      });
      expect(auditRows).toHaveLength(2);
      for (const row of auditRows) {
        expect(row.action).toBe('UPDATE');
        expect(row.module).toBe('INVENTORY');
        expect(row.subscriptionId).toBe(subscriptionId);
      }
    }, 30000);

    it('opens a shift offline and refuses a second one for the same store', async () => {
      const shiftOperation = buildOperation({
        operationType: 'SHIFT_OPEN',
        operationUuid: SHIFT_OPEN_OP_UUID,
        clientSequence: 12,
        payload: {
          shiftId: TEST_SHIFT_ID,
          userId: ORIGIN_USER_ID,
          openingBalance: '100.00',
          openedAt: new Date().toISOString(),
          workstationId: ORIGIN_WORKSTATION_ID,
        },
      });

      const res = await sendBatch(originToken, [shiftOperation]).expect(202);
      expect(res.body[0].status).toBe('ACCEPTED');

      const queueEntry = await prisma.syncQueue.findUniqueOrThrow({
        where: { operationUuid: SHIFT_OPEN_OP_UUID },
      });
      expect(queueEntry.status).toBe('COMPLETED');

      const shift = await prisma.cashShift.findUniqueOrThrow({
        where: { id: TEST_SHIFT_ID },
        select: {
          state: true,
          workstationId: true,
          openingBalance: true,
          subscriptionId: true,
        },
      });
      // The POS-local shift id is preserved so the server shift and the local
      // shift are the same entity on both sides.
      expect(shift.state).toBe('OPEN');
      expect(shift.workstationId).toBe(ORIGIN_WORKSTATION_ID);
      expect(Number(shift.openingBalance)).toBe(100);
      expect(shift.subscriptionId).toBe(subscriptionId);

      // One global shift per store: a second offline open is a permanent
      // failure, so the queue row must be FAILED and the POS told REJECTED
      // instead of retrying forever.
      const secondOperation = buildOperation({
        operationType: 'SHIFT_OPEN',
        operationUuid: SECOND_SHIFT_OPEN_OP_UUID,
        clientSequence: 13,
        payload: {
          shiftId: SECOND_SHIFT_ID,
          userId: ORIGIN_USER_ID,
          openingBalance: '0.00',
          openedAt: new Date().toISOString(),
          workstationId: ORIGIN_WORKSTATION_ID,
        },
      });

      const second = await sendBatch(originToken, [secondOperation]).expect(
        202,
      );
      expect(second.body[0].status).toBe('REJECTED');

      const failedEntry = await prisma.syncQueue.findUniqueOrThrow({
        where: { operationUuid: SECOND_SHIFT_OPEN_OP_UUID },
      });
      expect(failedEntry.status).toBe('FAILED');
      expect(failedEntry.lastErrorMessage).toContain('already open');
      expect(
        await prisma.cashShift.count({ where: { id: SECOND_SHIFT_ID } }),
      ).toBe(0);
    }, 30000);
  });

  describe('server -> hub -> workstation (GET /sync/events/pending)', () => {
    it('delivers a broadcast event to every workstation', async () => {
      const eventId = await createEvent({
        eventType: 'PRICE_UPDATE',
        entityType: 'Product',
        entityId: TEST_PRODUCT_ID,
        payload: { unitPrice: '16000.00' },
        severity: 'INFO',
        sourceWorkstationId: null,
      });

      expect(await pendingEvents(HUB_WORKSTATION_ID)).toContain(eventId);
      expect(await pendingEvents(ORIGIN_WORKSTATION_ID)).toContain(eventId);
    }, 30000);

    it('keeps a workstation-targeted event hidden from the other workstation', async () => {
      const eventId = await createEvent({
        eventType: 'FORCED_SYNC',
        entityType: 'SystemConfig',
        entityId: ORIGIN_WORKSTATION_ID,
        severity: 'WARNING',
        sourceWorkstationId: ORIGIN_WORKSTATION_ID,
      });

      expect(await pendingEvents(ORIGIN_WORKSTATION_ID)).toContain(eventId);
      expect(await pendingEvents(HUB_WORKSTATION_ID)).not.toContain(eventId);
    }, 30000);

    it('records the acknowledgement per workstation and stays idempotent', async () => {
      const eventId = await createEvent({
        eventType: 'PRODUCT_DEACTIVATED',
        entityType: 'Product',
        entityId: TEST_PRODUCT_ID,
        sourceWorkstationId: ORIGIN_WORKSTATION_ID,
      });

      expect(await pendingEvents(ORIGIN_WORKSTATION_ID)).toContain(eventId);

      await request(app.getHttpServer())
        .post(`/sync/events/${eventId}/acknowledge`)
        .set('Authorization', `Bearer ${originToken}`)
        .expect(200);

      expect(await pendingEvents(ORIGIN_WORKSTATION_ID)).not.toContain(eventId);

      const firstAck = await prisma.syncEventAcknowledgment.findUniqueOrThrow({
        where: {
          eventId_workstationId: {
            eventId,
            workstationId: ORIGIN_WORKSTATION_ID,
          },
        },
        select: { acknowledgedAt: true, acknowledgedById: true },
      });
      expect(firstAck.acknowledgedById).toBe(ORIGIN_USER_ID);

      // A second acknowledgement must neither add a row nor move the
      // original timestamp.
      await request(app.getHttpServer())
        .post(`/sync/events/${eventId}/acknowledge`)
        .set('Authorization', `Bearer ${originToken}`)
        .expect(200);

      const ackRows = await prisma.syncEventAcknowledgment.findMany({
        where: { eventId },
      });
      expect(ackRows).toHaveLength(1);
      expect(ackRows[0].acknowledgedAt.getTime()).toBe(
        firstAck.acknowledgedAt.getTime(),
      );
    }, 30000);

    /**
     * Regression test for a broadcast event being acknowledged globally.
     *
     * `SyncEvent` used to carry a single `acknowledgedAt` column that
     * `getPendingEvents` filtered on, so the first workstation to acknowledge
     * a broadcast event removed it for every other workstation: in a branch
     * with a hub plus terminals, a `PRODUCT_DEACTIVATED` or `PRICE_UPDATE`
     * only ever reached one machine.
     */
    it('keeps a broadcast event pending for other workstations after one acknowledges it', async () => {
      const eventId = await createEvent({
        eventType: 'CONFIG_CHANGE',
        entityType: 'SystemConfig',
        entityId: uuidFrom('e2e-sync-config-broadcast'),
        severity: 'CRITICAL',
        sourceWorkstationId: null,
      });

      expect(await pendingEvents(HUB_WORKSTATION_ID)).toContain(eventId);
      expect(await pendingEvents(ORIGIN_WORKSTATION_ID)).toContain(eventId);

      // Explicit param: a hub acknowledging on behalf of a peer workstation.
      await request(app.getHttpServer())
        .post(`/sync/events/${eventId}/acknowledge`)
        .query({ workstationId: ORIGIN_WORKSTATION_ID })
        .set('Authorization', `Bearer ${originToken}`)
        .expect(200);

      expect(await pendingEvents(ORIGIN_WORKSTATION_ID)).not.toContain(eventId);
      // The hub has not applied this event yet, and the other terminal's
      // acknowledgement must not remove it from this one's queue.
      expect(await pendingEvents(HUB_WORKSTATION_ID)).toContain(eventId);

      // The hub still has to acknowledge it for itself.
      await request(app.getHttpServer())
        .post(`/sync/events/${eventId}/acknowledge`)
        .set('Authorization', `Bearer ${hubToken}`)
        .expect(200);

      expect(await pendingEvents(HUB_WORKSTATION_ID)).not.toContain(eventId);

      const ackRows = await prisma.syncEventAcknowledgment.findMany({
        where: { eventId },
      });
      expect(ackRows.map((row) => row.workstationId).sort()).toEqual(
        [HUB_WORKSTATION_ID, ORIGIN_WORKSTATION_ID].sort(),
      );
    }, 30000);
  });

  /**
   * The cron is the only thing that applies an operation outside
   * IMMEDIATE_DISPATCH_TYPES (PRODUCT_CREATION, PRODUCT_UPDATE,
   * AUDIT_LOG_BATCH, SHIFT_OPEN): every other type is inserted PENDING and
   * waits for SyncProcessingJob. Nothing exercised that path, and it is where
   * a replay turns into a double application.
   */
  describe('cron replay (SyncProcessingJob)', () => {
    let job: SyncProcessingJob;

    /** Offline stock correction, the shape the POS ships for the cron to apply. */
    const buildAdjustmentPayload = () => ({
      createAdjustmentDto: {
        reason: 'E2E cron replay',
        items: [
          {
            lotId: TEST_LOT_ID,
            movementType: 'POSITIVE_ADJUSTMENT',
            quantity: ADJUSTMENT_QUANTITY,
            reason: 'E2E cron replay',
            lot: {
              productId: TEST_PRODUCT_ID,
              batchNumber: TEST_LOT_BATCH,
              expirationDate: '2027-01-01T00:00:00.000Z',
              currentStock: 0,
              locationCode: null,
            },
          },
        ],
      },
      userId: ORIGIN_USER_ID,
    });

    const lotStock = async (): Promise<number> => {
      const lot = await prisma.lot.findUniqueOrThrow({
        where: { id: TEST_LOT_ID },
      });
      return lot.currentStock;
    };

    const movementsForLot = () =>
      prisma.inventoryMovement.count({ where: { lotId: TEST_LOT_ID } });

    const queueRow = () =>
      prisma.syncQueue.findFirst({
        where: { operationUuid: CRON_ADJUSTMENT_OP_UUID },
      });

    /**
     * Asserts the domain outcome while surfacing why it failed: a bare status
     * assertion reports `FAILED` without the handler's reason, which is the one
     * thing worth reading when the application of an operation breaks.
     */
    const expectApplied = async (): Promise<void> => {
      const applied = await queueRow();
      expect({
        status: applied?.status,
        lastErrorMessage: applied?.lastErrorMessage,
      }).toEqual({ status: 'COMPLETED', lastErrorMessage: null });
    };

    /**
     * Ticks the job until the row leaves PENDING. A tick is skipped while an
     * earlier one is still running (`processing` flag) and the real cron can
     * beat this call to the row, so the loop keeps the test about the domain
     * outcome instead of about who processed it first.
     */
    const tickUntilProcessed = async (): Promise<void> => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await job.processPendingOperations();
        if ((await queueRow())?.status === 'COMPLETED') return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };

    beforeAll(async () => {
      job = app.get(SyncProcessingJob);
      await prisma.lot.create({
        data: {
          id: TEST_LOT_ID,
          subscriptionId,
          batchNumber: TEST_LOT_BATCH,
          expirationDate: new Date('2027-01-01'),
          entryDate: new Date('2026-01-01'),
          productId: TEST_PRODUCT_ID,
          currentStock: 0,
          version: 0,
        },
      });
    });

    it('applies an operation that is not immediately dispatched, exactly once', async () => {
      const res = await sendBatch(originToken, [
        buildOperation({
          operationType: 'INVENTORY_ADJUSTMENT',
          operationUuid: CRON_ADJUSTMENT_OP_UUID,
          clientSequence: 900,
          payload: buildAdjustmentPayload(),
        }),
      ]).expect(202);

      // Not an immediate-dispatch type: accepted, still PENDING, stock untouched.
      expect(res.body[0]).toEqual({
        operationUuid: CRON_ADJUSTMENT_OP_UUID,
        status: 'ACCEPTED',
      });
      expect((await queueRow())?.status).toBe('PENDING');
      expect(await lotStock()).toBe(0);
      expect(await movementsForLot()).toBe(0);

      await tickUntilProcessed();

      await expectApplied();
      expect(await lotStock()).toBe(ADJUSTMENT_QUANTITY);
      expect(await movementsForLot()).toBe(1);
    }, 60000);

    /**
     * The dispatch sets are the only thing that decides whether an operation is
     * ever applied: the batch endpoint dispatches four types synchronously and
     * the cron selects the rest. A type the dispatcher implements but that sits
     * in neither set is queued and never applied — which is how CLIENT_UPDATE,
     * CLIENT_DEACTIVATE, CLIENT_CREDIT_PAYMENT, CLIENT_CREDIT_PAYMENT_ANNULMENT
     * and INVOICE_TRANSMISSION behaved before.
     *
     * The payloads are deliberately minimal and the handlers fail on them: what
     * is asserted is that the job SELECTS each type, so a handler error is
     * expected and irrelevant. A PENDING row is the failure this test looks for.
     */
    it('selects every operation type the dispatcher implements', async () => {
      const absentClientId = uuidFrom('e2e-sync-absent-client');
      const absentPaymentId = uuidFrom('e2e-sync-absent-payment');
      const cases: Array<{ type: string; payload: Record<string, unknown> }> = [
        {
          type: 'CLIENT_UPDATE',
          payload: {
            userId: ORIGIN_USER_ID,
            clientId: absentClientId,
            updateClientDto: { commercialName: 'E2E' },
          },
        },
        {
          type: 'CLIENT_DEACTIVATE',
          payload: {
            userId: ORIGIN_USER_ID,
            deactivateClientDto: { clientId: absentClientId },
          },
        },
        {
          type: 'CLIENT_CREDIT_PAYMENT',
          payload: {
            clientId: absentClientId,
            amount: '1000',
            paymentMethodId: TEST_TAX_SCHEME_ID,
            createdById: ORIGIN_USER_ID,
            cashShiftId: TEST_SHIFT_ID,
            workstationId: ORIGIN_WORKSTATION_ID,
            metadata: { localPaymentId: absentPaymentId },
          },
        },
        {
          type: 'CLIENT_CREDIT_PAYMENT_ANNULMENT',
          payload: {
            clientId: absentClientId,
            annulledById: ORIGIN_USER_ID,
            annulmentReason: 'E2E coverage',
            metadata: { localPaymentId: absentPaymentId },
          },
        },
        { type: 'INVOICE_TRANSMISSION', payload: {} },
      ];

      const operations = cases.map((entry, index) =>
        buildOperation({
          operationType: entry.type,
          operationUuid: uuidFrom(`e2e-sync-dispatch-coverage-${entry.type}`),
          clientSequence: 950 + index,
          payload: entry.payload,
        }),
      );

      const res = await sendBatch(originToken, operations).expect(202);
      for (const entry of res.body as Array<{ status: string }>) {
        expect(entry.status).toBe('ACCEPTED');
      }

      // None of these is immediately dispatched, so all five start queued.
      const queued = await prisma.syncQueue.findMany({
        where: {
          operationUuid: {
            in: operations.map((op) => op.operationUuid as string),
          },
        },
        select: { operationUuid: true, status: true },
      });
      expect(queued).toHaveLength(cases.length);
      expect(queued.map((row) => row.status)).toEqual(
        Array(cases.length).fill('PENDING'),
      );

      await job.processPendingOperations();

      const processed = await prisma.syncQueue.findMany({
        where: {
          operationUuid: {
            in: operations.map((op) => op.operationUuid as string),
          },
        },
        select: { operationUuid: true, status: true },
      });
      expect(processed).toHaveLength(cases.length);
      const stillPending = processed
        .filter((row) => row.status === 'PENDING')
        .map((row) => row.operationUuid);
      expect(stillPending).toEqual([]);
    }, 60000);

    it('never applies the same operation twice when its queue row is still PENDING', async () => {
      // The replay trigger is a documented production state, not an invention:
      // a queue row survives as PENDING when its status write is lost, which is
      // exactly why PRODUCT_CREATION carries an operationUuid guard (11
      // duplicate "uy, uy" products with sequential P-codes came from it).
      await prisma.syncQueue.updateMany({
        where: { operationUuid: CRON_ADJUSTMENT_OP_UUID },
        data: { status: 'PENDING', processedAt: null },
      });

      // Fail loudly if the real cron already took the row between the flip and
      // the tick below, rather than passing on a row someone else completed.
      expect((await queueRow())?.status).toBe('PENDING');

      await tickUntilProcessed();

      await expectApplied();
      expect(await lotStock()).toBe(ADJUSTMENT_QUANTITY);
      expect(await movementsForLot()).toBe(1);
    }, 60000);
  });

  /**
   * Retention. `SyncEvent.deleteExpired()` and `WorkstationHeartbeat.deleteOld()`
   * existed, were documented as housekeeping and had no caller, so both tables
   * grew for the whole life of a deployment while `SyncQueue` was the only one
   * with a job behind its window. The expiry filters on the read path
   * (`getPendingEvents`, `countPending`) are what hid it: stale rows never reach
   * a workstation, they just never leave the database either.
   */
  describe('housekeeping (SyncHousekeepingJob)', () => {
    const EXPIRED_EVENT_ID = uuidFrom('e2e-sync-expired-event');
    const LIVE_EVENT_ID = uuidFrom('e2e-sync-live-event');
    const OLD_HEARTBEAT_ID = uuidFrom('e2e-sync-old-heartbeat');
    const FRESH_HEARTBEAT_ID = uuidFrom('e2e-sync-fresh-heartbeat');

    beforeAll(async () => {
      const now = Date.now();
      await prisma.syncEvent.deleteMany({
        where: { id: { in: [EXPIRED_EVENT_ID, LIVE_EVENT_ID] } },
      });
      await prisma.syncEvent.createMany({
        data: [
          {
            id: EXPIRED_EVENT_ID,
            subscriptionId,
            eventType: 'PRICE_UPDATE',
            entityType: 'Product',
            entityId: TEST_PRODUCT_ID,
            expiresAt: new Date(now - 60_000),
          },
          {
            id: LIVE_EVENT_ID,
            subscriptionId,
            eventType: 'PRICE_UPDATE',
            entityType: 'Product',
            entityId: TEST_PRODUCT_ID,
            expiresAt: new Date(now + 3_600_000),
          },
        ],
      });
      // An acknowledgement on the expired event: the purge has to take it too.
      await prisma.syncEventAcknowledgment.deleteMany({
        where: { eventId: EXPIRED_EVENT_ID },
      });
      await prisma.syncEventAcknowledgment.create({
        data: {
          subscriptionId,
          eventId: EXPIRED_EVENT_ID,
          workstationId: ORIGIN_WORKSTATION_ID,
        },
      });
      await prisma.workstationHeartbeat.deleteMany({
        where: { id: { in: [OLD_HEARTBEAT_ID, FRESH_HEARTBEAT_ID] } },
      });
      await prisma.workstationHeartbeat.createMany({
        data: [
          {
            id: OLD_HEARTBEAT_ID,
            workstationId: ORIGIN_WORKSTATION_ID,
            reportedBy: ORIGIN_WORKSTATION_ID,
            // Past the 72h default window.
            receivedAt: new Date(now - 100 * 3_600_000),
          },
          {
            id: FRESH_HEARTBEAT_ID,
            workstationId: ORIGIN_WORKSTATION_ID,
            reportedBy: ORIGIN_WORKSTATION_ID,
            receivedAt: new Date(now - 60_000),
          },
        ],
      });
    });

    it('collects expired events and old heartbeats while keeping the live rows', async () => {
      // Control first: with the fixture missing, "count is 0 after the purge"
      // would pass for the wrong reason.
      expect(
        await prisma.syncEvent.count({
          where: { id: { in: [EXPIRED_EVENT_ID, LIVE_EVENT_ID] } },
        }),
      ).toBe(2);
      expect(
        await prisma.syncEventAcknowledgment.count({
          where: { eventId: EXPIRED_EVENT_ID },
        }),
      ).toBe(1);
      expect(
        await prisma.workstationHeartbeat.count({
          where: { id: { in: [OLD_HEARTBEAT_ID, FRESH_HEARTBEAT_ID] } },
        }),
      ).toBe(2);

      await app.get(SyncHousekeepingJob).purgeExpiredRows();

      expect(
        await prisma.syncEvent.count({ where: { id: EXPIRED_EVENT_ID } }),
      ).toBe(0);
      // The cascade takes the acknowledgement rows with the event.
      expect(
        await prisma.syncEventAcknowledgment.count({
          where: { eventId: EXPIRED_EVENT_ID },
        }),
      ).toBe(0);
      // Inside its TTL: still deliverable, so it must stay.
      expect(
        await prisma.syncEvent.count({ where: { id: LIVE_EVENT_ID } }),
      ).toBe(1);

      expect(
        await prisma.workstationHeartbeat.count({
          where: { id: OLD_HEARTBEAT_ID },
        }),
      ).toBe(0);
      expect(
        await prisma.workstationHeartbeat.count({
          where: { id: FRESH_HEARTBEAT_ID },
        }),
      ).toBe(1);
    }, 60000);
  });

  /**
   * clientSequence collision between two workstations.
   *
   * The POS numbers its operations per terminal, so the server only has a
   * guarantee WITHIN one sourceWorkstationId — the (sourceWorkstationId,
   * clientSequence) index is deliberately non-unique and the local-number-hint
   * endpoint hands back the max per workstation. Two terminals WILL send the
   * same sequence numbers and the hub must keep their streams independent:
   * any global constraint or cross-workstation mixing corrupts the hint the
   * terminals use to continue their own numbering.
   */
  describe('clientSequence collision across workstations', () => {
    const COLLI_BASE = 1000;

    const productUpdateFor = (userId: string, note: string) => ({
      ...buildProductUpdatePayload(note),
      userId,
    });

    const hintFor = async (
      token: string,
      workstationId: string,
    ): Promise<number | null> => {
      const res = await request(app.getHttpServer())
        .get('/sync/local-number-hint')
        .query({ workstationId })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return res.body.maxLocalNumber as number | null;
    };

    it('keeps two interleaved workstation streams independent when they share the same sequence numbers', async () => {
      // Origin: 1001, 1002, 1003. Hub: 1001, 1002 — interleaved so the same
      // clientSequence values arrive from both streams.
      const plan: Array<{
        token: string;
        workstationId: string;
        userId: string;
        seq: number;
      }> = [
        {
          token: originToken,
          workstationId: ORIGIN_WORKSTATION_ID,
          userId: ORIGIN_USER_ID,
          seq: COLLI_BASE + 1,
        },
        {
          token: hubToken,
          workstationId: HUB_WORKSTATION_ID,
          userId: HUB_USER_ID,
          seq: COLLI_BASE + 1,
        },
        {
          token: originToken,
          workstationId: ORIGIN_WORKSTATION_ID,
          userId: ORIGIN_USER_ID,
          seq: COLLI_BASE + 2,
        },
        {
          token: hubToken,
          workstationId: HUB_WORKSTATION_ID,
          userId: HUB_USER_ID,
          seq: COLLI_BASE + 2,
        },
        {
          token: originToken,
          workstationId: ORIGIN_WORKSTATION_ID,
          userId: ORIGIN_USER_ID,
          seq: COLLI_BASE + 3,
        },
      ];

      for (const step of plan) {
        const res = await sendBatch(step.token, [
          buildOperation({
            operationUuid: uuidFrom(
              `e2e-sync-collision-${step.workstationId}-${step.seq}`,
            ),
            clientSequence: step.seq,
            payload: productUpdateFor(
              step.userId,
              `collision-${step.workstationId.slice(0, 8)}-${step.seq}`,
            ),
          }),
        ]).expect(202);
        expect(res.body[0].status).toBe('ACCEPTED');
      }

      // The same clientSequence from two workstations must coexist: exactly
      // one row per workstation, never merged or dropped.
      const collisionRows = await prisma.syncQueue.findMany({
        where: { clientSequence: BigInt(COLLI_BASE + 1) },
        select: {
          sourceWorkstationId: true,
          subscriptionId: true,
          status: true,
        },
      });
      expect(collisionRows).toHaveLength(2);
      expect(
        collisionRows.map((row) => row.sourceWorkstationId).sort(),
      ).toEqual([HUB_WORKSTATION_ID, ORIGIN_WORKSTATION_ID].sort());
      for (const row of collisionRows) {
        expect(row.subscriptionId).toBe(subscriptionId);
        expect(row.status).toBe('COMPLETED');
      }

      // The hint each terminal reads to continue its numbering must reflect
      // ONLY its own stream: origin's highest sent is 1003, hub's is 1002.
      expect(await hintFor(originToken, ORIGIN_WORKSTATION_ID)).toBe(
        COLLI_BASE + 3,
      );
      expect(await hintFor(hubToken, HUB_WORKSTATION_ID)).toBe(COLLI_BASE + 2);

      // Cross-tenant safety net: no other tenant's row may leak into the hint
      // aggregate, so its scope must be the workstation (which belongs to one
      // tenant) — nothing here is tenant-ambiguous, but a wrong global max
      // would break both terminals' numbering on a multi-tenant server.
      const allCollisionRows = await prisma.syncQueue.count({
        where: { clientSequence: BigInt(COLLI_BASE + 3) },
      });
      expect(allCollisionRows).toBe(1);
    }, 30000);

    it('accepts two concurrent batches with the same clientSequence from different workstations', async () => {
      const seq = COLLI_BASE + 20;
      const build = (workstationId: string, token: string, userId: string) =>
        sendBatch(token, [
          buildOperation({
            operationUuid: uuidFrom(
              `e2e-sync-concurrent-${workstationId}-${seq}`,
            ),
            clientSequence: seq,
            payload: productUpdateFor(userId, `concurrent-${seq}`),
          }),
        ]);

      // True race: both in flight at once, not sequential sends.
      const [originRes, hubRes] = await Promise.all([
        build(ORIGIN_WORKSTATION_ID, originToken, ORIGIN_USER_ID),
        build(HUB_WORKSTATION_ID, hubToken, HUB_USER_ID),
      ]);
      expect(originRes.status).toBe(202);
      expect(hubRes.status).toBe(202);
      expect(originRes.body[0].status).toBe('ACCEPTED');
      expect(hubRes.body[0].status).toBe('ACCEPTED');

      const rows = await prisma.syncQueue.findMany({
        where: { clientSequence: BigInt(seq) },
        select: { sourceWorkstationId: true },
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.sourceWorkstationId).sort()).toEqual(
        [HUB_WORKSTATION_ID, ORIGIN_WORKSTATION_ID].sort(),
      );
    }, 30000);

    /**
     * The terminal that logged in FIRST keeps selling with its first session:
     * batches must be attributed to the workstation of the SESSION that sent
     * them, not to wherever the user happened to log in last. The user row's
     * `lastLoginWorkstationId` is mutated by every login, so an attribution
     * that reads it at request time pins both terminals' streams onto one
     * workstation — merging their clientSequence spaces and poisoning both
     * local-number-hints.
     */
    it('attributes a batch to the session workstation even after the same user logs in elsewhere', async () => {
      const seq = COLLI_BASE + 30;

      // One cashier, two terminals: hub first, then origin.
      const sharedHubToken = await login(SHARED_USERNAME, HUB_WORKSTATION_ID);
      const sharedOriginToken = await login(
        SHARED_USERNAME,
        ORIGIN_WORKSTATION_ID,
      );

      const res = await sendBatch(sharedHubToken, [
        buildOperation({
          operationUuid: uuidFrom(`e2e-sync-shared-user-${seq}`),
          clientSequence: seq,
          payload: productUpdateFor(SHARED_USER_ID, `shared-user-${seq}`),
        }),
      ]).expect(202);
      expect(res.body[0].status).toBe('ACCEPTED');

      const row = await prisma.syncQueue.findUniqueOrThrow({
        where: {
          operationUuid: uuidFrom(`e2e-sync-shared-user-${seq}`),
        },
        select: { sourceWorkstationId: true },
      });
      // The session was created at the hub workstation; the origin login must
      // not steal the attribution of the hub session's in-flight batches.
      expect(row.sourceWorkstationId).toBe(HUB_WORKSTATION_ID);
    }, 30000);
  });

  /**
   * The offline window: the 15-minute access token is expected to expire while
   * a workstation keeps selling, and the long-lived offline token is what keeps
   * it authenticated (`SyncAuthGuard` dual path). No spec sent
   * `X-Offline-Token` before this one, so the fallback, the `request.user` it
   * produces and the RLS reads behind it were never exercised end to end — a
   * guard that silently returned an empty tenant would have looked identical to
   * a healthy one.
   */
  describe('offline window (X-Offline-Token)', () => {
    let offlineToken: string;
    let fingerprintlessOfflineToken: string;
    let expiredAccessToken: string;

    const batchOf = (operationUuid: string, clientSequence: number) => [
      buildOperation({ operationUuid, clientSequence }),
    ];

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          identifier: ORIGIN_USERNAME,
          secret: TEST_PASSWORD,
          sessionType: 'PASSWORD',
          workstationId: ORIGIN_WORKSTATION_ID,
          hardwareFingerprint: ORIGIN_WORKSTATION_ID,
        })
        .expect(200);
      offlineToken = res.body.offlineToken.token as string;
      expect(offlineToken).toBeTruthy();

      // QuickSwitch logs in without a hardware fingerprint (the POS passes
      // `undefined` there), which used to mint an offline token carrying
      // `wfp: ''` — rejected by the server verifier and by the POS's own
      // offline-login binding check.
      const quickSwitch = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          identifier: ORIGIN_USERNAME,
          secret: TEST_PASSWORD,
          sessionType: 'PASSWORD',
          workstationId: ORIGIN_WORKSTATION_ID,
        })
        .expect(200);
      fingerprintlessOfflineToken = quickSwitch.body.offlineToken
        .token as string;

      // Signed with the real secret and a negative TTL: exactly the token the
      // POS still holds when its 15-minute access token has run out.
      expiredAccessToken = await app.get(JwtService).signAsync(
        {
          sub: ORIGIN_USER_ID,
          tokenHash: 'expired-session-hash',
          sessionId: null,
        },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: -60 },
      );
    });

    it('accepts a batch carrying only the offline token', async () => {
      const res = await request(app.getHttpServer())
        .post('/sync/batch')
        .set('X-Offline-Token', offlineToken)
        .send(batchOf(OFFLINE_BATCH_OP_UUID, 700))
        .expect(202);

      expect(res.body[0]).toEqual({
        operationUuid: OFFLINE_BATCH_OP_UUID,
        status: 'ACCEPTED',
      });
      // Attribution comes from the authenticated session, so a wrong fallback
      // path would still accept the batch under the wrong workstation.
      const queued = await prisma.syncQueue.findUnique({
        where: { operationUuid: OFFLINE_BATCH_OP_UUID },
      });
      expect(queued?.sourceWorkstationId).toBe(ORIGIN_WORKSTATION_ID);
      expect(queued?.subscriptionId).toBe(subscriptionId);
    });

    it('falls back to the offline token when the access token is expired', async () => {
      const res = await request(app.getHttpServer())
        .post('/sync/batch')
        .set('Authorization', `Bearer ${expiredAccessToken}`)
        .set('X-Offline-Token', offlineToken)
        .send(batchOf(EXPIRED_BEARER_OP_UUID, 701))
        .expect(202);

      expect(res.body[0].status).toBe('ACCEPTED');
    });

    /**
     * A login without a hardware fingerprint (QuickSwitch, the 2FA step, the web
     * backoffice) must still yield a usable offline token: the server binds it to
     * the resolved workstation, which is the fingerprint the POS compares
     * against when it logs in offline.
     */
    it('accepts a batch whose offline token was issued without a fingerprint', async () => {
      const res = await request(app.getHttpServer())
        .post('/sync/batch')
        .set('X-Offline-Token', fingerprintlessOfflineToken)
        .send(batchOf(FINGERPRINTLESS_OP_UUID, 703))
        .expect(202);

      expect(res.body[0].status).toBe('ACCEPTED');
    });

    it('rejects a batch when neither credential is valid', async () => {
      await request(app.getHttpServer())
        .post('/sync/batch')
        .set('X-Offline-Token', 'not-a-jwt')
        .send(batchOf(BAD_OFFLINE_OP_UUID, 702))
        .expect(401);

      expect(
        await prisma.syncQueue.count({
          where: { operationUuid: BAD_OFFLINE_OP_UUID },
        }),
      ).toBe(0);
    });

    /**
     * The read the POS performs on every resync. `@Public()` + SyncAuthGuard
     * means the tenant reaches the query only through the guard's request.user:
     * if the guard stops populating it, the interceptor skips the tenant
     * transaction and RLS fails closed, answering 200 with an empty catalog.
     */
    it('reads the tenant catalog with the offline token alone', async () => {
      const res = await request(app.getHttpServer())
        .get('/catalog/products')
        .set('X-Offline-Token', offlineToken)
        .expect(200);

      const ids = (res.body.items as Array<{ id: string }>).map((i) => i.id);
      expect(ids).toContain(TEST_PRODUCT_ID);
    });

    it('returns no catalog at all without credentials (fails closed, no leak)', async () => {
      const res = await request(app.getHttpServer())
        .get('/catalog/products')
        .expect(200);

      expect(res.body.items).toEqual([]);
    });

    it('exchanges the offline token for fresh credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/token/exchange')
        .send({ offlineToken })
        .expect(200);

      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.offlineToken.token).toBeTruthy();

      // The fresh access token must work on a tenant-scoped read.
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });
  });
});
