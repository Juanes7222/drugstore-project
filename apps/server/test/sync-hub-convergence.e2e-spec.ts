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
const HUB_USERNAME = 'e2e-sync-hub@sync.test';
const ORIGIN_USERNAME = 'e2e-sync-origin@sync.test';
const TEST_PASSWORD = 'SyncPass123!';
const TEST_PRODUCT_ID = uuidFrom('e2e-sync-product-id');
const TEST_TAX_SCHEME_ID = uuidFrom('e2e-sync-tax-scheme-id');

/** Offline-created product: the POS sends the OFFLINE- sentinel as its code. */
const PRODUCT_CREATION_OP_UUID = uuidFrom('e2e-sync-op-product-creation');
const POS_LOCAL_PRODUCT_ID = uuidFrom('e2e-sync-pos-local-product-id');
const AUDIT_BATCH_OP_UUID = uuidFrom('e2e-sync-op-audit-batch');
const AUDIT_LOG_ENTRY_ID = uuidFrom('e2e-sync-audit-log-entry');
const AUDIT_LOG_ENTRY_ID_UPPER = uuidFrom('e2e-sync-audit-log-entry-upper');
const SHIFT_OPEN_OP_UUID = uuidFrom('e2e-sync-op-shift-open');
const SECOND_SHIFT_OPEN_OP_UUID = uuidFrom('e2e-sync-op-shift-open-second');
const TEST_SHIFT_ID = uuidFrom('e2e-sync-shift-id');
const SECOND_SHIFT_ID = uuidFrom('e2e-sync-shift-id-second');

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

  const createEvent = async (body: Record<string, unknown>): Promise<string> => {
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
      where: { userId: { in: [HUB_USER_ID, ORIGIN_USER_ID] } },
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
      where: { userId: { in: [HUB_USER_ID, ORIGIN_USER_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [HUB_USER_ID, ORIGIN_USER_ID] } },
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
      where: { userId: { in: [HUB_USER_ID, ORIGIN_USER_ID] } },
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
      where: { userId: { in: [HUB_USER_ID, ORIGIN_USER_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [HUB_USER_ID, ORIGIN_USER_ID] } },
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
      expect(queueEntry.payloadSize).toBe(JSON.stringify(operation.payload).length);

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

      const second = await sendBatch(originToken, [secondOperation]).expect(202);
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
      expect(
        ackRows.map((row) => row.workstationId).sort(),
      ).toEqual([HUB_WORKSTATION_ID, ORIGIN_WORKSTATION_ID].sort());
    }, 30000);
  });
});
