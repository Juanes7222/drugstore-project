/**
 * POS ↔ Server integration — CLIENT_UPDATE, CLIENT_DEACTIVATE, AUDIT_LOG_BATCH.
 *
 * Three dispatcher operation types had no full-flow coverage. This spec
 * drives the REAL POS services (PGlite) over real HTTP into the real
 * NestJS dispatcher:
 *
 *   1. CLIENT_UPDATE — an offline edit replays server-side; a server-side
 *      (backoffice) edit made while the POS was offline loses to the POS's
 *      later edit (last-writer-wins is the documented conflict strategy).
 *   2. CLIENT_DEACTIVATE — the deactivation reaches the server as a soft
 *      delete (isActive=false), never a row deletion.
 *   3. AUDIT_LOG_BATCH — the local audit writer + enqueueUnsynced() path
 *      produces a batch the server materializes with the ORIGINAL local ids
 *      (idempotency key) and tenant stamp.
 *   4. AUDIT_LOG_BATCH with ONE malformed row inside — documents the real
 *      failure granularity (whole-batch validation vs per-row isolation),
 *      which the backlog assumed was per-row.
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import {
  PrismaClient as LocalPrismaClient,
  Prisma,
} from "@pharmacy/database/local";
import { LOCAL_SCHEMA_SQL } from "@pharmacy/database/local-schema";
import request from "../../../../../node_modules/.pnpm/node_modules/supertest/index.js";
import { Test } from "../../../../../node_modules/.pnpm/node_modules/@nestjs/testing";
import {
  INestApplication,
  ValidationPipe,
} from "../../../../../node_modules/.pnpm/node_modules/@nestjs/common";
import * as argon2 from "../../../../../node_modules/.pnpm/node_modules/argon2";
import { createRequire } from "node:module";
const serverRequire = createRequire(import.meta.url);
const { PrismaClient: ServerPrismaClient } = serverRequire(
  "../../../../server/test/generated/database-cjs/database.cjs",
) as {
  PrismaClient: new (args: Record<string, unknown>) => ServerPrismaClientType;
};
type ServerPrismaClientType = import("@pharmacy/database").PrismaClient;
const { PrismaPg } = serverRequire(
  "../../../../../node_modules/.pnpm/node_modules/@prisma/adapter-pg",
) as { PrismaPg: new (args: Record<string, unknown>) => unknown };
import * as crypto from "node:crypto";

const setServerEnv = (): void => {
  process.env.DATABASE_URL ??=
    "postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db";
  process.env.APP_DATABASE_URL ??=
    "postgresql://pharmacy_app:pharmacy_app@localhost:5433/pharmacy_test_db";
  process.env.JWT_ACCESS_SECRET ??= "test-access-secret-key-32-chars-minimum!!";
  process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-key-32-chars-minimum";
  process.env.JWT_ACCESS_TTL_SECONDS ??= "900";
  process.env.JWT_REFRESH_TTL_SECONDS ??= "604800";
  process.env.PORT ??= "3001";
  process.env.NODE_ENV = "test";
  process.env.REDIS_URL ??= "redis://localhost:6380";
};
setServerEnv();

const { AppModule } = await import("../../../../server/src/app.module");
const { HttpExceptionFilter } =
  await import("../../../../server/src/common/filters/http-exception.filter");
const { TenantContextInterceptor } =
  await import("../../../../server/src/modules/tenant/tenant-context.interceptor");
const { SyncProcessingJob } =
  await import("../../../../server/src/modules/sync/jobs/sync-processing.job");
const { seedSubscription } =
  await import("../../../../server/test/helpers/subscription-seed");

import { useLocalSessionStore } from "../auth/local-session.store";
import { createSyncPushService } from "../sync/sync-push.service";
import { createClientsService } from "../clients/clients.service";
import { createLocalAuditWriter, LocalAuditEvent } from "../audit/local-audit-writer.service";
import { createAuditSyncService } from "../audit/audit-sync.service";

// ---------------------------------------------------------------------------
// Deterministic ids
// ---------------------------------------------------------------------------

const uuidFrom = (seed: string): string => {
  const h = crypto.createHash("sha256").update(seed).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `8${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join("-");
};

const SERVER_WS_ID = uuidFrom("pos-int-cops-server-ws");
const SERVER_USER_ID = "pos-int-cops-server-user-id";
const USERNAME = "pos-integration-cops@pos.test";
const PASSWORD = "PosIntegration123!";

const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-cops-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-cops-pm-cash");

const POS_WS_ID = "pos-int-cops-ws-0001";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — client + audit operation types", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;
  let clients: ReturnType<typeof createClientsService>;
  let auditWriter: ReturnType<typeof createLocalAuditWriter>;
  let auditSync: ReturnType<typeof createAuditSyncService>;

  const auth = {
    requireRole: () => useLocalSessionStore.getState().session!,
  } as any;

  const push = (): ReturnType<typeof createSyncPushService> =>
    createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });

  const drainServerQueue = async (maxTicks = 12): Promise<void> => {
    const job = serverApp.get(SyncProcessingJob);
    for (let i = 0; i < maxTicks; i++) {
      await job.processPendingOperations();
      const pending = await serverPrisma.syncQueue.count({
        where: {
          subscriptionId,
          OR: [
            { status: "PENDING" },
            { status: "PROCESSING" },
            { status: "FAILED", nextRetryAt: { not: null } },
          ],
        },
      });
      if (pending === 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const pushAndDrain = async (): Promise<void> => {
    await push().pushPending();
    await drainServerQueue();
  };

  const cleanServerRows = async (): Promise<void> => {
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.client.deleteMany({
      where: { identificationNumber: { startsWith: "COPS-" } },
    });
    await serverPrisma.auditLog.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.taxScheme.deleteMany({
      where: { id: SERVER_TAX_SCHEME_ID },
    });
    await serverPrisma.paymentMethod.deleteMany({
      where: { id: SERVER_PM_CASH_ID },
    });
    await serverPrisma.auditLog.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    await serverPrisma.userSession.deleteMany({
      where: { userId: SERVER_USER_ID },
    });
    await serverPrisma.userSession.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
    await serverPrisma.workstation.deleteMany({
      where: { id: SERVER_WS_ID },
    });
  };

  beforeAll(async () => {
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-cops");
    await cleanServerRows();

    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "POS COps Workstation",
        code: "WS-POS-COPS-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });

    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS COps Cashier",
        passwordHash,
        passwordAlgorithm: "argon2",
        role: "ADMIN",
        subscriptionId,
        isActive: true,
      },
    });

    await serverPrisma.taxScheme.create({
      data: {
        id: SERVER_TAX_SCHEME_ID,
        subscriptionId,
        code: "POS-COPS-IVA19",
        name: "POS COps IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: new Date("2024-01-01"),
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    serverApp = moduleFixture.createNestApplication();
    serverApp.useGlobalFilters(new HttpExceptionFilter());
    serverApp.useGlobalInterceptors(serverApp.get(TenantContextInterceptor));
    serverApp.useGlobalPipes(new ValidationPipe({ transform: true }));
    await serverApp.listen(0);
    serverPort = serverApp.getHttpServer().address().port;

    const loginRes = await request(serverApp.getHttpServer())
      .post("/auth/login")
      .send({
        identifier: USERNAME,
        secret: PASSWORD,
        sessionType: "PASSWORD",
        workstationId: SERVER_WS_ID,
      })
      .expect(200);
    serverToken = loginRes.body.accessToken as string;

    pg = new PGlite("memory://");
    await pg.exec(LOCAL_SCHEMA_SQL);
    localPrisma = new LocalPrismaClient({ adapter: new PrismaPGlite(pg) });

    useLocalSessionStore.getState().setSession({
      userId: SERVER_USER_ID,
      username: USERNAME,
      fullName: "POS COps Cashier",
      displayName: "POS COps Cashier",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-cops",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-cops-session-1",
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
    });

    clients = createClientsService(localPrisma, auth);
    auditWriter = createLocalAuditWriter(localPrisma);
    auditSync = createAuditSyncService({
      prisma: localPrisma,
      workstationId: POS_WS_ID,
    });
  }, 180000);

  afterAll(async () => {
    if (localPrisma) await localPrisma.$disconnect();
    if (pg) await pg.close();
    if (serverPrisma) {
      await cleanServerRows();
      await serverPrisma.$disconnect();
    }
    if (serverApp) await serverApp.close();
  }, 120000);

  // -------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------

  it("CLIENT_UPDATE: the offline edit wins over a backoffice edit made while offline", async () => {
    const idNumber = `COPS-UPD-${Date.now()}`;
    const client = (await clients.create({
      fullName: "Cliente Update V1",
      identificationType: "CC",
      identificationNumber: idNumber,
    })) as { id: string };
    await pushAndDrain();

    // Baseline reached the server.
    const created = await serverPrisma.client.findUniqueOrThrow({
      where: { id: client.id },
    });
    expect(created.fullName).toBe("Cliente Update V1");

    // Backoffice edit while the POS is offline…
    await serverPrisma.client.update({
      where: { id: client.id },
      data: { fullName: "Backoffice Edit" },
    });

    // …then the cashier edits locally and syncs: last writer wins.
    await clients.update(client.id, {
      fullName: "Cliente Update V2",
      phone: "3001234567",
    });
    const updateEntry = await localPrisma.syncQueue.findFirstOrThrow({
      where: { operationType: "CLIENT_UPDATE", status: "PENDING" },
    });
    expect(updateEntry).toBeDefined();

    await pushAndDrain();

    const merged = await serverPrisma.client.findUniqueOrThrow({
      where: { id: client.id },
    });
    expect(merged.fullName).toBe("Cliente Update V2");
    expect(merged.phone).toBe("3001234567");

    // The local entry completed — no retries left behind.
    const entry = await localPrisma.syncQueue.findUniqueOrThrow({
      where: { id: updateEntry.id },
    });
    expect(entry.status).toBe("COMPLETED");
  }, 180000);

  it("CLIENT_DEACTIVATE: soft-deletes on the server, never deletes the row", async () => {
    const idNumber = `COPS-DEACT-${Date.now()}`;
    const client = (await clients.create({
      fullName: "Cliente Deactivate",
      identificationType: "CC",
      identificationNumber: idNumber,
    })) as { id: string };
    await pushAndDrain();

    await clients.deactivate(client.id);
    const deactivateEntry = await localPrisma.syncQueue.findFirstOrThrow({
      where: { operationType: "CLIENT_DEACTIVATE", status: "PENDING" },
    });
    await pushAndDrain();

    const serverClient = await serverPrisma.client.findUniqueOrThrow({
      where: { id: client.id },
    });
    expect(serverClient.isActive).toBe(false);
    // Soft delete only: the row still exists for historical references.
    expect(serverClient.id).toBe(client.id);

    const entry = await localPrisma.syncQueue.findUniqueOrThrow({
      where: { id: deactivateEntry.id },
    });
    expect(entry.status).toBe("COMPLETED");
  }, 180000);

  it("AUDIT_LOG_BATCH: the local audit batch reaches the server with its original ids", async () => {
    await auditWriter.write(LocalAuditEvent.SALE_CONFIRMED, {
      category: "sale",
      entityType: "Sale",
      entityId: uuidFrom("cops-audit-sale"),
      userId: SERVER_USER_ID,
      userRole: "ADMIN",
      workstationId: POS_WS_ID,
    });
    await auditWriter.write(LocalAuditEvent.CLIENT_CREATED, {
      category: "client",
      entityType: "Client",
      entityId: uuidFrom("cops-audit-client"),
      userId: SERVER_USER_ID,
      userRole: "ADMIN",
      workstationId: POS_WS_ID,
    });

    const enqueued = await auditSync.enqueueUnsynced();
    expect(enqueued).toBe(2);

    await pushAndDrain();

    const serverLogs = await serverPrisma.auditLog.findMany({
      where: { subscriptionId, entityType: { in: ["Sale", "Client"] } },
      select: { id: true, entityType: true, subscriptionId: true },
    });
    const auditRows = await localPrisma.localAuditLog.findMany({
      select: { id: true, entityType: true },
    });
    expect(auditRows).toHaveLength(2);
    // Original local ids are reused as server ids (retry-safe idempotency).
    for (const local of auditRows) {
      expect(serverLogs.some((s) => s.id === local.id)).toBe(true);
    }
    // Tenant stamp comes from the server context, never the payload.
    expect(serverLogs.every((l) => l.subscriptionId === subscriptionId)).toBe(
      true,
    );

    // Local rows marked synced → a second enqueue is a no-op.
    const secondEnqueue = await auditSync.enqueueUnsynced();
    expect(secondEnqueue).toBe(0);
  }, 180000);

  it("AUDIT_LOG_BATCH with a malformed row: documents the real failure granularity", async () => {
    // 2 valid rows + 1 row violating the wire schema (missing `action`).
    const validA = crypto.randomUUID();
    const validB = crypto.randomUUID();
    const payload = {
      logs: [
        {
          id: validA,
          action: "SALE_CONFIRMED",
          category: "sale",
          createdAt: new Date().toISOString(),
        },
        {
          id: validB,
          action: "CLIENT_CREATED",
          category: "client",
          createdAt: new Date().toISOString(),
        },
        {
          // Malformed: `action` is required by AuditLogBatchEntrySchema.
          id: crypto.randomUUID(),
          category: "sync",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const wireHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    const opUuid = crypto.randomUUID();
    await request(serverApp.getHttpServer())
      .post("/sync/batch")
      .set("Authorization", `Bearer ${serverToken}`)
      .send([
        {
          operationType: "AUDIT_LOG_BATCH",
          operationUuid: opUuid,
          payload,
          payloadHash: wireHash,
          sourceCreatedAt: new Date().toISOString(),
          clientSequence: 900,
          source: "DIRECT",
        },
      ])
      .expect(202);

    await drainServerQueue();

    const row = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: opUuid },
    });

    // OBSERVED BEHAVIOR (documented, not idealized): the payload is
    // validated as ONE Zod object, so a single malformed row fails the
    // whole batch — NONE of the valid rows are stored. The backlog expected
    // per-row isolation (savepoint-style); that isolation does NOT exist for
    // schema violations (only for runtime DB errors inside the handler).
    //
    // FINDING: the terminal status differs by dispatch path. AUDIT_LOG_BATCH
    // is an IMMEDIATE_DISPATCH_TYPE, so the ingest-time path marks the row
    // FAILED (no nextRetryAt) while the cron path would mark
    // PERMANENT_FAILURE. Both are terminal and both are surfaced by the
    // integrity report (PROBLEM_STATUSES), but the inconsistency is worth
    // knowing when triaging server queue rows.
    expect(row.status).toBe("FAILED");
    expect(row.nextRetryAt).toBeNull();
    expect(row.lastErrorMessage).toContain("validation");

    // Neither valid row was persisted.
    const storedA = await serverPrisma.auditLog.count({
      where: { id: validA },
    });
    const storedB = await serverPrisma.auditLog.count({
      where: { id: validB },
    });
    expect(storedA).toBe(0);
    expect(storedB).toBe(0);

    // A healthy batch (no malformed row) DOES complete — the failure is
    // caused by the bad row, not by the batch shape.
    const healthyId = crypto.randomUUID();
    const healthyPayload = {
      logs: [
        {
          id: healthyId,
          action: "SYNC_PUSH_COMPLETED",
          category: "sync",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const healthyUuid = crypto.randomUUID();
    await request(serverApp.getHttpServer())
      .post("/sync/batch")
      .set("Authorization", `Bearer ${serverToken}`)
      .send([
        {
          operationType: "AUDIT_LOG_BATCH",
          operationUuid: healthyUuid,
          payload: healthyPayload,
          payloadHash: crypto
            .createHash("sha256")
            .update(JSON.stringify(healthyPayload))
            .digest("hex"),
          sourceCreatedAt: new Date().toISOString(),
          clientSequence: 901,
          source: "DIRECT",
        },
      ])
      .expect(202);
    await drainServerQueue();

    const healthyRow = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: healthyUuid },
    });
    expect(healthyRow.status).toBe("COMPLETED");
    const storedHealthy = await serverPrisma.auditLog.count({
      where: { id: healthyId },
    });
    expect(storedHealthy).toBe(1);
  }, 180000);

  it("drains the local outbox completely — no operation is left behind", async () => {
    const pending = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(pending).toBe(0);
  });
});
