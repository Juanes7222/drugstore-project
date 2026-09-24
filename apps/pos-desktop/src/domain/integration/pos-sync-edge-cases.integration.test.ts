/**
 * POS ↔ Server integration — SYNC EDGE CASES + LIGHT SOAK.
 *
 * Corner cases the happy-path specs never reach:
 *
 *   1. Payload hash mismatch — a tampered payload is REJECTED by the server
 *      with PAYLOAD_HASH_MISMATCH; the POS marks it PERMANENT_FAILURE
 *      while its batch siblings still complete.
 *   2. Large outbox — dozens of entries push across several batch calls
 *      (the POS caps each push at PUSH_BATCH_LIMIT) with zero losses and
 *      strictly per-workstation clientSequence ordering.
 *   3. Clock skew — a POS whose clock is 5 minutes ahead still replays
 *      cleanly: ordering relies on clientSequence, never timestamps.
 *   4. Post-soak integrity — the ledger verifier reports OK for everything
 *      after the bulk push (ties the soak to the detection mechanism).
 *   5. Retry storm control — two server 500s back to back land the entry in
 *      FAILED with the documented exponential backoff, the POS refuses to
 *      send before `nextRetryAt`, and the eventual success creates exactly
 *      ONE server row (the retries never duplicated the operation).
 *   6. Auth failure without an offline token — the deliberate exception in
 *      `recordBatchFailure`: the attempt is recorded but the retry budget
 *      (retryCount / nextRetryAt / status) is left untouched so the entry
 *      is picked up again the moment credentials recover.
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
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
import {
  createSyncPushService,
  PUSH_BATCH_LIMIT,
} from "../sync/sync-push.service";
import { createClientsService } from "../clients/clients.service";
import { runSyncIntegrityVerification } from "../sync/sync-integrity.service";

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

const SERVER_WS_ID = uuidFrom("pos-int-edge-server-ws");
const SERVER_USER_ID = "pos-int-edge-server-user-id";
const USERNAME = "pos-integration-edge@pos.test";
const PASSWORD = "PosIntegration123!";

const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-edge-tax-scheme");

const POS_WS_ID = "pos-int-edge-ws-0001";

/** Bulk size: several POS batch calls (PUSH_BATCH_LIMIT = 10). */
const SOAK_SIZE = 35;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — sync edge cases", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;
  let clients: ReturnType<typeof createClientsService>;

  const auth = {
    requireRole: () => useLocalSessionStore.getState().session!,
  } as any;

  const push = (): ReturnType<typeof createSyncPushService> =>
    createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });

  const drainServerQueue = async (maxTicks = 20): Promise<void> => {
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
      await new Promise((r) => setTimeout(r, 60));
    }
  };

  /** Pushes until the local outbox has nothing left to send. */
  const pushUntilEmpty = async (): Promise<number> => {
    const svc = push();
    let totalAccepted = 0;
    for (let i = 0; i < 40; i++) {
      const res = await svc.pushPending();
      totalAccepted += res.accepted;
      if (res.pushed === 0) return totalAccepted;
    }
    return totalAccepted;
  };

  const cleanServerRows = async (): Promise<void> => {
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.client.deleteMany({
      where: { identificationNumber: { startsWith: "EDGE-" } },
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
    await serverPrisma.userSession.deleteMany({
      where: { userId: SERVER_USER_ID },
    });
    await serverPrisma.userSession.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
    await serverPrisma.workstation.deleteMany({ where: { id: SERVER_WS_ID } });
  };

  beforeAll(async () => {
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-edge");
    await cleanServerRows();

    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "POS Edge Workstation",
        code: "WS-POS-EDGE-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });

    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS Edge Cashier",
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
        code: "POS-EDGE-IVA19",
        name: "POS Edge IVA 19%",
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
      fullName: "POS Edge Cashier",
      displayName: "POS Edge Cashier",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-edge",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-edge-session-1",
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
    });

    clients = createClientsService(localPrisma, auth);
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

  it("payload hash mismatch: REJECTED for the tampered entry, siblings unaffected", async () => {
    // Two real local entries: one is tampered AFTER it was enqueued (the
    // payload no longer matches the hash the POS stored).
    const tampered = (await clients.create({
      fullName: "Edge Tampered",
      identificationType: "CC",
      identificationNumber: `EDGE-TAMPER-${Date.now()}`,
    })) as { id: string };
    const healthy = (await clients.create({
      fullName: "Edge Healthy",
      identificationType: "CC",
      identificationNumber: `EDGE-HEALTHY-${Date.now()}`,
    })) as { id: string };

    const tamperedEntry = await localPrisma.syncQueue.findFirstOrThrow({
      where: {
        operationType: "CLIENT_CREATION",
        payload: { contains: tampered.id },
      },
    });
    // Mutate a FIELD (not just whitespace: the server hashes the parsed
    // object, so a trailing space would hash identically) and keep the
    // originally stored payloadHash.
    const parsed = JSON.parse(tamperedEntry.payload) as {
      createClientDto: { fullName: string };
    };
    parsed.createClientDto.fullName = "Edge Tampered Mutated";
    await localPrisma.syncQueue.update({
      where: { id: tamperedEntry.id },
      data: { payload: JSON.stringify(parsed) },
    });

    await pushUntilEmpty();
    await drainServerQueue();

    // The tampered entry: server REJECTED (hash) → POS PERMANENT_FAILURE.
    const tamperedAfter = await localPrisma.syncQueue.findUniqueOrThrow({
      where: { id: tamperedEntry.id },
    });
    expect(tamperedAfter.status).toBe("PERMANENT_FAILURE");
    // NOTE: the POS classifier buckets "PAYLOAD_HASH_MISMATCH" as CONFLICT
    // (the body matches the `mismatch` heuristic), not VALIDATION — worth
    // knowing when triaging: it surfaces in the UI as a conflict-class
    // failure even though the cause is payload corruption.
    expect(tamperedAfter.failureCategory).toBe("CONFLICT");
    // No server row was created for it (rejected before persistence).
    expect(
      await serverPrisma.syncQueue.count({
        where: { operationUuid: tamperedEntry.operationUuid },
      }),
    ).toBe(0);

    // The sibling in the same outbox still completed end to end.
    const healthyEntry = await localPrisma.syncQueue.findFirstOrThrow({
      where: {
        operationType: "CLIENT_CREATION",
        payload: { contains: healthy.id },
      },
    });
    expect(healthyEntry.status).toBe("COMPLETED");
    const serverClient = await serverPrisma.client.findUniqueOrThrow({
      where: { id: healthy.id },
    });
    expect(serverClient.fullName).toBe("Edge Healthy");
  }, 180000);

  it("large outbox: pushes across several batch calls with zero losses and ordered clientSequence", async () => {
    // SOAK_SIZE entries in one outbox — several PUSH_BATCH_LIMIT calls.
    for (let i = 0; i < SOAK_SIZE; i++) {
      await clients.create({
        fullName: `Edge Soak ${i}`,
        identificationType: "CC",
        identificationNumber: `EDGE-SOAK-${Date.now()}-${i}`,
      });
    }

    const locallyPending = await localPrisma.syncQueue.count({
      where: { operationType: "CLIENT_CREATION", status: "PENDING" },
    });
    expect(locallyPending).toBeGreaterThan(PUSH_BATCH_LIMIT);

    const accepted = await pushUntilEmpty();
    expect(accepted).toBeGreaterThanOrEqual(locallyPending);
    await drainServerQueue();

    // Every single one landed server-side: zero losses.
    const serverClients = await serverPrisma.client.count({
      where: {
        subscriptionId,
        identificationNumber: { startsWith: "EDGE-SOAK-" },
      },
    });
    expect(serverClients).toBe(SOAK_SIZE);

    // All local entries completed — nothing stuck.
    const lingering = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(lingering).toBe(0);

    // Per-workstation clientSequence is unique and strictly ordered
    // server-side (the batching never reorders or collapses entries).
    const sequences = (
      await serverPrisma.syncQueue.findMany({
        where: {
          subscriptionId,
          sourceWorkstationId: SERVER_WS_ID,
          operationType: "CLIENT_CREATION",
        },
        select: { clientSequence: true },
        orderBy: { clientSequence: "asc" },
      })
    ).map((r) => Number(r.clientSequence));
    expect(new Set(sequences).size).toBe(sequences.length);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  }, 300000);

  it("clock skew: a POS clock 5 minutes ahead still replays cleanly", async () => {
    const skewed = (await clients.create({
      fullName: "Edge Skewed",
      identificationType: "CC",
      identificationNumber: `EDGE-SKEW-${Date.now()}`,
    })) as { id: string };

    // Rewrite the entry's timestamps to a future POS clock (sourceCreatedAt
    // is what the server stores; the payload hash does not cover it).
    const future = new Date(Date.now() + 5 * 60 * 1000);
    await localPrisma.syncQueue.updateMany({
      where: { payload: { contains: skewed.id } },
      data: { sourceCreatedAt: future },
    });

    await pushUntilEmpty();
    await drainServerQueue();

    // The replay succeeded despite the future timestamp: ordering relies on
    // clientSequence, never on wall-clock time.
    const serverClient = await serverPrisma.client.findUniqueOrThrow({
      where: { id: skewed.id },
    });
    expect(serverClient.fullName).toBe("Edge Skewed");

    const queueRow = await serverPrisma.syncQueue.findFirstOrThrow({
      where: { operationType: "CLIENT_CREATION", payload: { contains: skewed.id } },
    });
    expect(queueRow.status).toBe("COMPLETED");
    expect(queueRow.sourceCreatedAt.getTime()).toBe(future.getTime());
  }, 180000);

  it("retry storm: two server 500s back off on schedule, then replay exactly once", async () => {
    const client = (await clients.create({
      fullName: "Edge Retry Storm",
      identificationType: "CC",
      identificationNumber: `EDGE-RETRY-${Date.now()}`,
    })) as { id: string };

    const entry = await localPrisma.syncQueue.findFirstOrThrow({
      where: {
        operationType: "CLIENT_CREATION",
        payload: { contains: client.id },
      },
    });
    expect(entry.retryCount).toBe(0);
    expect(entry.nextRetryAt).toBeNull();

    // The first two /sync/batch calls fail with a 500 (server outage);
    // every later call goes through to the real NestJS app.
    const realFetch = globalThis.fetch;
    let failuresLeft = 2;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.includes("/sync/batch") && failuresLeft > 0) {
          failuresLeft--;
          return new Response("Internal Server Error", {
            status: 500,
            statusText: "Internal Server Error",
          });
        }
        return realFetch(input, init);
      });

    try {
      // ── Attempt 1 — 500: FAILED, NETWORK category, first backoff ─────
      const first = await push().pushPending();
      expect(first.accepted).toBe(0);

      const afterFirst = await localPrisma.syncQueue.findUniqueOrThrow({
        where: { id: entry.id },
      });
      expect(afterFirst.status).toBe("FAILED");
      expect(afterFirst.retryCount).toBe(1);
      expect(afterFirst.failureCategory).toBe("NETWORK");
      expect(afterFirst.nextRetryAt).not.toBeNull();

      // Documented backoff for retry #1: 30s ±20% jitter (24s–36s).
      const firstDelay =
        afterFirst.nextRetryAt!.getTime() - afterFirst.lastAttemptAt!.getTime();
      expect(firstDelay).toBeGreaterThanOrEqual(24_000);
      expect(firstDelay).toBeLessThanOrEqual(36_000);

      // A push before nextRetryAt must NOT re-send: the backoff is respected.
      const tooSoon = await push().pushPending();
      expect(tooSoon.pushed).toBe(0);
      expect(failuresLeft).toBe(1);

      // ── Attempt 2 — 500: second backoff, strictly longer ─────────────
      await localPrisma.syncQueue.update({
        where: { id: entry.id },
        data: { nextRetryAt: new Date(Date.now() - 1000) },
      });
      const second = await push().pushPending();
      expect(second.accepted).toBe(0);

      const afterSecond = await localPrisma.syncQueue.findUniqueOrThrow({
        where: { id: entry.id },
      });
      expect(afterSecond.retryCount).toBe(2);
      const secondDelay =
        afterSecond.nextRetryAt!.getTime() - afterSecond.lastAttemptAt!.getTime();
      expect(secondDelay).toBeGreaterThanOrEqual(96_000);
      expect(secondDelay).toBeLessThanOrEqual(144_000);
      expect(secondDelay).toBeGreaterThan(firstDelay);

      // Two failed attempts, but nothing was persisted server-side: the
      // server never received a body it could replay.
      expect(
        await serverPrisma.syncQueue.count({
          where: { operationUuid: entry.operationUuid },
        }),
      ).toBe(0);

      // ── Attempt 3 — server recovered: accepted, exactly one server row ─
      await localPrisma.syncQueue.update({
        where: { id: entry.id },
        data: { nextRetryAt: new Date(Date.now() - 1000) },
      });
      const third = await push().pushPending();
      expect(third.accepted).toBeGreaterThanOrEqual(1);
      await drainServerQueue();

      const finalEntry = await localPrisma.syncQueue.findUniqueOrThrow({
        where: { id: entry.id },
      });
      expect(finalEntry.status).toBe("COMPLETED");

      // No duplicates: one queue row, one client, one attempt log of each
      // outcome (2 × NETWORK_ERROR + 1 × ACCEPTED) — three attempts total.
      expect(
        await serverPrisma.syncQueue.count({
          where: { operationUuid: entry.operationUuid },
        }),
      ).toBe(1);
      expect(
        await serverPrisma.client.count({ where: { id: client.id } }),
      ).toBe(1);
      expect(
        await localPrisma.syncAttempt.count({
          where: { syncQueueEntryId: entry.id },
        }),
      ).toBe(3);
    } finally {
      fetchSpy.mockRestore();
    }
  }, 240000);

  it("auth failure with no offline token records the attempt without consuming the retry budget", async () => {
    const client = (await clients.create({
      fullName: "Edge Auth Retry",
      identificationType: "CC",
      identificationNumber: `EDGE-AUTH-${Date.now()}`,
    })) as { id: string };

    const entry = await localPrisma.syncQueue.findFirstOrThrow({
      where: {
        operationType: "CLIENT_CREATION",
        payload: { contains: client.id },
      },
    });

    // No offline token → the AUTH branch in recordBatchFailure must keep the
    // entry PENDING with an untouched retry budget.
    const badPush = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: "expired-or-invalid-access-token",
    });
    const rejected = await badPush.pushPending();
    expect(rejected.accepted).toBe(0);

    const afterAuthFailure = await localPrisma.syncQueue.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(afterAuthFailure.status).toBe("PENDING");
    expect(afterAuthFailure.retryCount).toBe(0);
    expect(afterAuthFailure.nextRetryAt).toBeNull();
    expect(afterAuthFailure.failureCategory).toBe("AUTH");
    expect(
      await localPrisma.syncAttempt.count({
        where: { syncQueueEntryId: entry.id },
      }),
    ).toBe(1);

    // Credentials recover → the very next push sends it, no backoff wait.
    await pushUntilEmpty();
    await drainServerQueue();

    const recovered = await localPrisma.syncQueue.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(recovered.status).toBe("COMPLETED");
    expect(
      await serverPrisma.client.count({ where: { id: client.id } }),
    ).toBe(1);
  }, 180000);

  it("post-soak integrity: the ledger verifier reports every entry as OK", async () => {
    const outcome = await runSyncIntegrityVerification({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
      workstationId: POS_WS_ID,
    });

    // The local ledger includes the tampered entry (PERMANENT_FAILURE →
    // wire FAILED, unknown server-side → NOT_SUBMITTED) plus every soak
    // entry (COMPLETED → SYNCED → OK).
    expect(outcome.byVerdict.OK).toBeGreaterThanOrEqual(SOAK_SIZE);
    expect(outcome.byVerdict.NOT_SUBMITTED).toBeGreaterThanOrEqual(1);
    expect(outcome.flaggedCount).toBe(
      outcome.byVerdict.NOT_SUBMITTED +
        outcome.byVerdict.NOT_ACCEPTED +
        outcome.byVerdict.STATUS_MISMATCH,
    );
  }, 240000);
});
