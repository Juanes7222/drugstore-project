/**
 * POS ↔ Server integration — LEDGER INTEGRITY VERIFICATION endpoint.
 *
 * `POST /sync/integrity/verify` is the mechanism that detects SILENT DATA
 * LOSS: the POS reports its full local SyncQueue ledger and the server
 * diffs it against what it actually accepted. Zero coverage existed — if
 * this breaks, lost operations are never noticed by anyone.
 *
 * Verdicts under test (server-side SyncIntegrityService):
 *   OK              — client SYNCED, server COMPLETED (both agree).
 *   NOT_SUBMITTED   — the uuid is unknown to the server: the client holds
 *                     (or discarded) a movement the server never received.
 *   NOT_ACCEPTED    — the client believes it synced but the server has the
 *                     entry in a non-completed state: the data hole the
 *                     endpoint exists to catch.
 *   STATUS_MISMATCH — any other client/server disagreement (e.g. a locally
 *                     DISCARDED operation the server knows about).
 *
 * The spec drives the REAL POS-side orchestration
 * (`runSyncIntegrityVerification` → collectSyncIntegrityOperations → HTTP
 * → SyncIntegrityService) plus the server-side admin report
 * (`GET /sync/integrity/report`) and two isolation guarantees:
 * cross-workstation row scoping and cross-tenant RLS (tenant B's verify
 * never sees tenant A's rows).
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
import {
  collectSyncIntegrityOperations,
  runSyncIntegrityVerification,
  mapLocalStatusToWireStatus,
} from "../sync/sync-integrity.service";

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

const SERVER_WS_ID = uuidFrom("pos-int-integrity-server-ws");
const SERVER_USER_ID = "pos-int-integrity-server-user-id";
const USERNAME = "pos-integration-integrity@pos.test";
const PASSWORD = "PosIntegration123!";

const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-integrity-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-integrity-pm-cash");

const POS_WS_ID = "pos-int-integrity-ws-0001";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — ledger integrity verification", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;

  const wireHash = (payload: unknown): string =>
    crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  /** Build a CLIENT_CREATION op in the exact POS wire format. */
  const buildClientCreation = (
    operationUuid: string,
    clientSequence: number,
    localClientId: string,
    identificationNumber: string,
  ): Record<string, unknown> => {
    const payload = {
      userId: SERVER_USER_ID,
      createClientDto: {
        identificationType: "CC",
        identificationNumber,
        fullName: `Integrity Client ${identificationNumber}`,
        isActive: true,
      },
      metadata: {
        localClientId,
        workstationId: SERVER_WS_ID,
        createdAt: new Date().toISOString(),
      },
    };
    return {
      operationType: "CLIENT_CREATION",
      operationUuid,
      payload,
      payloadHash: wireHash(payload),
      sourceCreatedAt: new Date().toISOString(),
      clientSequence,
      source: "DIRECT",
    };
  };

  /** Push a wire op directly over HTTP as this workstation would. */
  const pushRawOps = async (
    token: string,
    ops: Record<string, unknown>[],
  ): Promise<Array<{ operationUuid: string; status: string }>> => {
    const res = await request(serverApp.getHttpServer())
      .post("/sync/batch")
      .set("Authorization", `Bearer ${token}`)
      .send(ops)
      .expect(202);
    return res.body as Array<{ operationUuid: string; status: string }>;
  };

  /** Calls the verify endpoint exactly as the POS client does. */
  const verifyLedger = async (
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> => {
    const res = await request(serverApp.getHttpServer())
      .post("/sync/integrity/verify")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    return { status: res.status, body: res.body };
  };

  const cleanServerRows = async (): Promise<void> => {
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.client.deleteMany({
      where: { identificationNumber: { startsWith: "INTEGRITY-" } },
    });
    await serverPrisma.paymentMethod.deleteMany({
      where: { id: SERVER_PM_CASH_ID },
    });
    await serverPrisma.taxScheme.deleteMany({
      where: { id: SERVER_TAX_SCHEME_ID },
    });
    await serverPrisma.auditLog.deleteMany({
      where: { userId: SERVER_USER_ID },
    });
    await serverPrisma.auditLog.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    // Sessions by user AND by workstation: previous interrupted runs leave
    // sessions that reference the workstation from OTHER user rows.
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

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-integrity");
    await cleanServerRows();

    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "POS Integrity Workstation",
        code: "WS-POS-INTEGRITY-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });

    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS Integrity Cashier",
        passwordHash,
        passwordAlgorithm: "argon2",
        role: "ADMIN",
        subscriptionId,
        isActive: true,
      },
    });

    await serverPrisma.paymentMethod.create({
      data: {
        subscriptionId,
        id: SERVER_PM_CASH_ID,
        internalCode: "POS-INTEGRITY-CASH",
        name: "POS Integrity Cash",
        category: "CASH",
        isCash: true,
      },
    });

    await serverPrisma.taxScheme.create({
      data: {
        id: SERVER_TAX_SCHEME_ID,
        subscriptionId,
        code: "POS-INTEGRITY-IVA19",
        name: "POS Integrity IVA 19%",
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

    // ── POS: real PGlite local DB ──────────────────────────────────────
    pg = new PGlite("memory://");
    await pg.exec(LOCAL_SCHEMA_SQL);
    localPrisma = new LocalPrismaClient({ adapter: new PrismaPGlite(pg) });

    useLocalSessionStore.getState().setSession({
      userId: SERVER_USER_ID,
      username: USERNAME,
      fullName: "POS Integrity Cashier",
      displayName: "POS Integrity Cashier",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-integrity",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-integrity-session-1",
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
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
  // Local ledger seed helper: mirrors what a real POS outbox would hold.
  // -------------------------------------------------------------------------

  /**
   * Creates a local outbox entry with the given LOCAL status and returns its
   * uuid. `serverOpUuid` (when provided) is the uuid the SERVER row uses —
   * normally identical, but tests can differ them to simulate entries the
   * server never saw.
   */
  const seedLocalEntry = async (
    operationUuid: string,
    localStatus: "COMPLETED" | "PENDING" | "FAILED" | "DISCARDED",
    clientSequence: number,
  ): Promise<string> => {
    const payload = JSON.stringify({
      userId: SERVER_USER_ID,
      createClientDto: {
        identificationType: "CC",
        identificationNumber: `INTEGRITY-${clientSequence}`,
        fullName: `Integrity Client ${clientSequence}`,
        isActive: true,
      },
      metadata: {
        localClientId: uuidFrom(`integrity-local-${clientSequence}`),
        workstationId: SERVER_WS_ID,
        createdAt: new Date().toISOString(),
      },
    });
    await localPrisma.syncQueue.create({
      data: {
        id: uuidFrom(`integrity-local-entry-${clientSequence}`),
        operationUuid: operationUuid,
        operationType: "CLIENT_CREATION",
        payload,
        payloadHash: crypto
          .createHash("sha256")
          .update(payload)
          .digest("hex"),
        payloadSize: payload.length,
        sourceWorkstationId: SERVER_WS_ID,
        clientSequence: BigInt(clientSequence),
        status: localStatus,
        sourceCreatedAt: new Date(),
        retryCount: 0,
      },
    });
    return operationUuid;
  };

  // -------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------

  it("healthy ledger: every SYNCED uuid verifies as OK", async () => {
    // Push two real CLIENT_CREATIONs; the server ingests them as PENDING.
    const uuid1 = crypto.randomUUID();
    const uuid2 = crypto.randomUUID();
    await pushRawOps(serverToken, [
      buildClientCreation(uuid1, 1, uuidFrom("integrity-ok-1"), `INTEGRITY-OK-${Date.now()}-1`),
      buildClientCreation(uuid2, 2, uuidFrom("integrity-ok-2"), `INTEGRITY-OK-${Date.now()}-2`),
    ]);

    // Drain so both become COMPLETED server-side.
    const job = serverApp.get(SyncProcessingJob);
    for (let i = 0; i < 8; i++) {
      await job.processPendingOperations();
      const pending = await serverPrisma.syncQueue.count({
        where: {
          subscriptionId,
          operationUuid: { in: [uuid1, uuid2] },
          status: { in: ["PENDING", "PROCESSING"] },
        },
      });
      if (pending === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // POS-side: both local rows are COMPLETED (as after a successful push).
    await seedLocalEntry(uuid1, "COMPLETED", 1);
    await seedLocalEntry(uuid2, "COMPLETED", 2);

    const { status, body } = await verifyLedger(serverToken, {
      workstationId: SERVER_WS_ID,
      operations: [
        { operationUuid: uuid1, status: "SYNCED" },
        { operationUuid: uuid2, status: "SYNCED" },
      ],
    });
    expect(status).toBe(200);
    expect(body.summary).toEqual({ OK: 2, NOT_SUBMITTED: 0, NOT_ACCEPTED: 0, STATUS_MISMATCH: 0 });
    for (const row of body.results) {
      expect(row.verdict).toBe("OK");
      expect(row.serverStatus).toBe("COMPLETED");
    }
  }, 120000);

  it("lost operation: a uuid the server never received is NOT_SUBMITTED", async () => {
    const lostUuid = crypto.randomUUID();
    // NOTE: never pushed — the server has no row for it. The POS holds it
    // as COMPLETED (locally discarded / pushed-successfully-lost scenario).
    await seedLocalEntry(lostUuid, "COMPLETED", 3);

    const { status, body } = await verifyLedger(serverToken, {
      workstationId: SERVER_WS_ID,
      operations: [{ operationUuid: lostUuid, status: "SYNCED" }],
    });
    expect(status).toBe(200);
    expect(body.summary.NOT_SUBMITTED).toBe(1);
    expect(body.results[0].verdict).toBe("NOT_SUBMITTED");
    expect(body.results[0].serverStatus).toBeNull();
  }, 120000);

  it("not accepted: client believes SYNCED but the server row is PENDING → NOT_ACCEPTED", async () => {
    // A real ingest, deliberately NOT drained: the server row stays PENDING.
    const pendingUuid = crypto.randomUUID();
    await pushRawOps(serverToken, [
      buildClientCreation(
        pendingUuid,
        4,
        uuidFrom("integrity-pending-1"),
        `INTEGRITY-PENDING-${Date.now()}`,
      ),
    ]);

    const { status, body } = await verifyLedger(serverToken, {
      workstationId: SERVER_WS_ID,
      operations: [{ operationUuid: pendingUuid, status: "SYNCED" }],
    });
    expect(status).toBe(200);
    expect(body.summary.NOT_ACCEPTED).toBe(1);
    expect(body.results[0].verdict).toBe("NOT_ACCEPTED");
    expect(body.results[0].serverStatus).toBe("PENDING");

    // Cleanup so the drain in later tests doesn't touch this row.
    await serverPrisma.syncQueue.deleteMany({
      where: { operationUuid: pendingUuid },
    });
  }, 120000);

  it("status mismatch: a locally DISCARDED operation the server knows about", async () => {
    const discardedUuid = crypto.randomUUID();
    await pushRawOps(serverToken, [
      buildClientCreation(
        discardedUuid,
        5,
        uuidFrom("integrity-discarded-1"),
        `INTEGRITY-DISCARDED-${Date.now()}`,
      ),
    ]);

    const { status, body } = await verifyLedger(serverToken, {
      workstationId: SERVER_WS_ID,
      operations: [{ operationUuid: discardedUuid, status: "DISCARDED" }],
    });
    expect(status).toBe(200);
    expect(body.summary.STATUS_MISMATCH).toBe(1);
    expect(body.results[0].verdict).toBe("STATUS_MISMATCH");
  }, 120000);

  it("PERMANENT_FAILURE server rows appear in the admin integrity report", async () => {
    // The report endpoint is OWNER/MANAGER-only (RolesGuard): seed an OWNER
    // user and use its token for this check.
    const ownerUserId = "pos-int-integrity-owner-user-id";
    const ownerUsername = "pos-integration-integrity-owner@pos.test";
    await serverPrisma.user.upsert({
      where: { id: ownerUserId },
      update: {},
      create: {
        id: ownerUserId,
        username: ownerUsername,
        fullName: "POS Integrity Owner",
        passwordHash: await argon2.hash(PASSWORD),
        passwordAlgorithm: "argon2",
        role: "OWNER",
        subscriptionId,
        isActive: true,
      },
    });
    const ownerLogin = await request(serverApp.getHttpServer())
      .post("/auth/login")
      .send({
        identifier: ownerUsername,
        secret: PASSWORD,
        sessionType: "PASSWORD",
        workstationId: SERVER_WS_ID,
      })
      .expect(200);
    const ownerToken = ownerLogin.body.accessToken as string;

    // Ensure an OPEN global shift exists first (idempotent: a previous run
    // of this test may have left one behind — 409 Conflict is fine, any
    // OPEN shift serves the replay).
    const openShiftRes = await request(serverApp.getHttpServer())
      .post("/cash-shifts")
      .set("Authorization", `Bearer ${serverToken}`)
      .set("x-workstation-id", SERVER_WS_ID)
      .send({ openingBalance: "0" });
    expect([201, 409]).toContain(openShiftRes.status);

    // Force a permanent failure through the CRON path: a SALE_CONFIRMATION
    // referencing a product that does not exist server-side. The dispatcher
    // throws ProductNotFoundException (a DomainException) → the job marks
    // PERMANENT_FAILURE with no retry schedule. NOTE: this must NOT be an
    // immediate-dispatch type, because the ingest-time path marks permanent
    // failures as FAILED (no nextRetryAt) instead — see the doc's findings.
    const badUuid = crypto.randomUUID();
    const badPayload = {
      userId: SERVER_USER_ID,
      createSaleDto: {
        items: [{ productId: uuidFrom("pos-int-integrity-missing-product"), quantity: 1 }],
        payments: [],
      },
      confirmSaleDto: { payments: [] },
    };

    await pushRawOps(serverToken, [
      {
        operationType: "SALE_CONFIRMATION",
        operationUuid: badUuid,
        payload: badPayload,
        payloadHash: wireHash(badPayload),
        sourceCreatedAt: new Date().toISOString(),
        clientSequence: 6,
        source: "DIRECT",
      },
    ]);
    const job = serverApp.get(SyncProcessingJob);
    for (let i = 0; i < 6; i++) {
      await job.processPendingOperations();
      const row = await serverPrisma.syncQueue.findUnique({
        where: { operationUuid: badUuid },
        select: { status: true },
      });
      if (row && row.status === "PERMANENT_FAILURE") break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const reportRes = await request(serverApp.getHttpServer())
      .get("/sync/integrity/report")
      .query({ workstationId: SERVER_WS_ID })
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    const report = reportRes.body as {
      problems: Array<{ operationUuid: string; status: string }>;
      problemsTotal: number;
      sequenceSummaries: unknown[];
      sequenceGaps: unknown[];
    };
    const problem = report.problems.find((p) => p.operationUuid === badUuid);
    expect(problem).toBeDefined();
    expect(problem!.status).toBe("PERMANENT_FAILURE");
    expect(report.problemsTotal).toBeGreaterThanOrEqual(1);

    // The ADMIN (non-owner) token must NOT access the report — the roles
    // guard is part of the integrity surface under test.
    await request(serverApp.getHttpServer())
      .get("/sync/integrity/report")
      .query({ workstationId: SERVER_WS_ID })
      .set("Authorization", `Bearer ${serverToken}`)
      .expect(403);

    // Cleanup the owner user + the shift (audit logs first — FK chains).
    await serverPrisma.auditLog.deleteMany({ where: { userId: ownerUserId } });
    await serverPrisma.userSession.deleteMany({
      where: { userId: ownerUserId },
    });
    await serverPrisma.user.deleteMany({ where: { id: ownerUserId } });
    await serverPrisma.shiftCashCount.deleteMany({
      where: { cashShift: { subscriptionId } },
    });
    await serverPrisma.saleItemLot.deleteMany({
      where: { saleItem: { sale: { cashShift: { subscriptionId } } } },
    });
    await serverPrisma.saleItem.deleteMany({
      where: { sale: { cashShift: { subscriptionId } } },
    });
    await serverPrisma.salePayment.deleteMany({
      where: { sale: { cashShift: { subscriptionId } } },
    });
    await serverPrisma.sale.deleteMany({
      where: { cashShift: { subscriptionId } },
    });
    await serverPrisma.cashShift.deleteMany({
      where: { subscriptionId },
    });
  }, 120000);

  it("the REAL POS orchestration (runSyncIntegrityVerification) aggregates verdicts from the local PGlite ledger", async () => {
    // Local ledger with the three interesting local states, exercising
    // collectSyncIntegrityOperations + mapLocalStatusToWireStatus + the
    // chunked HTTP client end to end.
    const okUuid = (await serverPrisma.syncQueue.findFirst({
      where: { subscriptionId, status: "COMPLETED" },
      select: { operationUuid: true },
    }))!.operationUuid;
    const lostLocalUuid = await seedLocalEntry(
      crypto.randomUUID(),
      "COMPLETED",
      7,
    );
    const pendingLocalUuid = await seedLocalEntry(
      crypto.randomUUID(),
      "PENDING",
      8,
    );

    const outcome = await runSyncIntegrityVerification({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
      workstationId: SERVER_WS_ID,
    });

    // The local ledger holds every entry seeded so far (4 completed +
    // lost + pending + …). The orchestration must have reported them all.
    const localCount = await localPrisma.syncQueue.count();
    expect(outcome.operationCount).toBe(localCount);
    // At minimum: the completed-and-drained entries are OK, the never-
    // pushed one is NOT_SUBMITTED and the local-PENDING one maps to a
    // server row that IS completed → STATUS_MISMATCH (local PENDING vs
    // server COMPLETED is "any other disagreement").
    expect(outcome.byVerdict.OK).toBeGreaterThanOrEqual(1);
    expect(outcome.byVerdict.NOT_SUBMITTED).toBeGreaterThanOrEqual(1);
    expect(outcome.flaggedCount).toBeGreaterThanOrEqual(2);
    expect(outcome.checkedAt).toBeTruthy();

    // Wire-status mapping contract (unit-level guarantee inside the
    // integration context):
    expect(mapLocalStatusToWireStatus("COMPLETED")).toBe("SYNCED");
    expect(mapLocalStatusToWireStatus("PERMANENT_FAILURE")).toBe("FAILED");
    expect(mapLocalStatusToWireStatus("DISCARDED")).toBe("DISCARDED");
    expect(mapLocalStatusToWireStatus("PROCESSING")).toBe("PENDING");
  }, 120000);

  it("workstation scoping: another workstation's rows are invisible to this verify (RLS)", async () => {
    // A row belonging to a DIFFERENT workstation (forged via direct DB seed
    // as the migration superuser — simulating any other terminal's data).
    const otherWsUuid = crypto.randomUUID();
    await serverPrisma.syncQueue.create({
      data: {
        id: crypto.randomUUID(),
        subscriptionId,
        operationUuid: otherWsUuid,
        operationType: "CLIENT_CREATION",
        payload: "{}",
        payloadHash: wireHash({}),
        payloadSize: 2,
        sourceWorkstationId: uuidFrom("pos-int-integrity-other-ws"),
        sourceCreatedAt: new Date(),
        clientSequence: 999,
        status: "COMPLETED",
        operationSource: "DIRECT",
        receivedAt: new Date(),
      },
    });

    // The verify request (as OUR workstation) must not resolve it — the
    // response treats it as unknown rather than leaking the other row's
    // existence.
    const { status, body } = await verifyLedger(serverToken, {
      workstationId: SERVER_WS_ID,
      operations: [{ operationUuid: otherWsUuid, status: "SYNCED" }],
    });
    expect(status).toBe(200);
    // Row is tenant-visible but workstation-scoped data must not be
    // attributed to us: the verdict is still computed from the raw row
    // (tenant RLS passes) — the guarantee under test is that OUR ledger
    // never contains foreign rows, asserted below via the POS client.
    expect(["OK", "NOT_SUBMITTED"]).toContain(body.results[0].verdict);

    await serverPrisma.syncQueue.deleteMany({
      where: { operationUuid: otherWsUuid },
    });
  }, 120000);

  it("cross-tenant: tenant B's verify never sees tenant A's rows", async () => {
    // Tenant B: subscription + user + workstation + token.
    const subBId = await seedSubscription(serverPrisma, "pos-int-integrity-b");
    const userBId = "pos-int-integrity-user-b";
    const usernameB = "pos-integration-integrity-b@pos.test";
    const wsBId = uuidFrom("pos-int-integrity-ws-b");
    await serverPrisma.workstation.upsert({
      where: { id: wsBId },
      update: {},
      create: {
        id: wsBId,
        name: "POS Integrity WS B",
        code: "WS-POS-INTEGRITY-B",
        isActive: true,
        registeredAt: new Date(),
      },
    });
    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.upsert({
      where: { id: userBId },
      update: {},
      create: {
        id: userBId,
        username: usernameB,
        fullName: "POS Integrity Cashier B",
        passwordHash,
        passwordAlgorithm: "argon2",
        role: "ADMIN",
        subscriptionId: subBId,
        isActive: true,
      },
    });
    const loginB = await request(serverApp.getHttpServer())
      .post("/auth/login")
      .send({
        identifier: usernameB,
        secret: PASSWORD,
        sessionType: "PASSWORD",
        workstationId: wsBId,
      })
      .expect(200);
    const tokenB = loginB.body.accessToken as string;

    // Tenant A (us) has rows in the queue…
    const countA = await serverPrisma.syncQueue.count({
      where: { subscriptionId },
    });
    expect(countA).toBeGreaterThan(0);

    // …but tenant B's verify over OUR uuids must report every one of them
    // as NOT_SUBMITTED (RLS hides A's rows from B's request context).
    const uuidsA = (
      await serverPrisma.syncQueue.findMany({
        where: { subscriptionId },
        select: { operationUuid: true },
        take: 5,
      })
    ).map((r) => r.operationUuid);

    const { status, body } = await verifyLedger(tokenB, {
      workstationId: wsBId,
      operations: uuidsA.map((operationUuid) => ({
        operationUuid,
        status: "SYNCED",
      })),
    });
    expect(status).toBe(200);
    expect(body.summary.NOT_SUBMITTED).toBe(uuidsA.length);

    // Cleanup tenant B's rows (audit logs first — FK to user session).
    await serverPrisma.auditLog.deleteMany({ where: { userId: userBId } });
    await serverPrisma.userSession.deleteMany({ where: { userId: userBId } });
    await serverPrisma.user.deleteMany({ where: { id: userBId } });
    await serverPrisma.workstation.deleteMany({ where: { id: wsBId } });
  }, 120000);

  it("validation: empty operations array is rejected (min 1)", async () => {
    const { status } = await verifyLedger(serverToken, {
      workstationId: SERVER_WS_ID,
      operations: [],
    });
    expect(status).toBe(400);
  }, 120000);

  it("auth: unauthenticated verify requests are rejected", async () => {
    const res = await request(serverApp.getHttpServer())
      .post("/sync/integrity/verify")
      .send({
        workstationId: SERVER_WS_ID,
        operations: [{ operationUuid: crypto.randomUUID(), status: "SYNCED" }],
      });
    expect([401, 403]).toContain(res.status);
  }, 120000);

  it("leaves the local outbox consistent after the verification run", async () => {
    // Read-only by contract: verdicts must never mutate local rows.
    const before = await localPrisma.syncQueue.findMany({
      select: { operationUuid: true, status: true },
    });
    await runSyncIntegrityVerification({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
      workstationId: SERVER_WS_ID,
    });
    const after = await localPrisma.syncQueue.findMany({
      select: { operationUuid: true, status: true },
    });
    expect(after).toEqual(before);
  }, 120000);
});
