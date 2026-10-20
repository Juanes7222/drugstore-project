/**
 * POS ↔ Server integration — the store's LAN relay between two workstations.
 *
 * The scenario this covers is the one the product exists for: a store whose
 * INTERNET IS DOWN keeps selling, and those sales must survive until the
 * connection returns — without being applied twice, and without one terminal
 * stealing another terminal's sales.
 *
 * Components
 * ----------
 *  - TWO real POS databases (PGlite ×2) with independent workstations, the
 *    real `LocalSyncEngine` (the LAN relay) and the real sale services.
 *  - ONE real NestJS server over real Postgres: the only place where
 *    business logic is replayed.
 *  - A FAKE HUB: an in-memory implementation of the Rust hub's wire contract
 *    (`src-tauri/src/local_sync_server.rs`). The hub is a relay, not a
 *    business component, and the two behaviours this spec depends on are
 *    exactly the ones the fake reproduces: the dedup by `operationUuid` and
 *    the nanosecond cursor with its strict `>` filter.
 *
 * What is asserted
 * ----------------
 *  1. A sale made while the internet is down reaches the peer through the
 *     hub, and the peer adopts it EXACTLY ONCE.
 *  2. The relay applies NO business logic locally: the peer's stock and
 *     books stay untouched until the server says so.
 *  3. When the internet returns, both stations push the same operation and
 *     the server applies it ONCE: one sale, one stock decrement, one
 *     invoice, one inventory movement, one queue row.
 *  4. The sale keeps the identity of the station that MADE it, even when
 *     the peer is the one that pushes it first.
 *  5. The new value converges on both sides: the peer's sales pull brings
 *     the server's sale into its own mirror.
 *  6. A station never adopts an operation that claims its own workstation
 *     id — a misconfigured terminal must not launder its operations under
 *     another terminal's identity.
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
import type { LocalOperation } from "@pharmacy/shared-types";
// The workspace hoists the server's dependencies into .pnpm/node_modules;
// vitest resolves these paths relative to this file.
import request from "../../../../../node_modules/.pnpm/node_modules/supertest/index.js";
// Server side (real AppModule)
import { Test } from "../../../../../node_modules/.pnpm/node_modules/@nestjs/testing";
import {
  INestApplication,
  ValidationPipe,
} from "../../../../../node_modules/.pnpm/node_modules/@nestjs/common";
import * as argon2 from "../../../../../node_modules/.pnpm/node_modules/argon2";
// The server-side Prisma client: the same prebuilt CJS bundle of
// packages/database the server e2e suite uses (real full client, loadable
// from vitest without jest's resolution tricks).
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

// Server env must be set BEFORE the AppModule (and its ConfigModule) loads.
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

// Dynamic import: AppModule must evaluate AFTER setServerEnv() has run.
const { AppModule } = await import("../../../../server/src/app.module");
const { HttpExceptionFilter } =
  await import("../../../../server/src/common/filters/http-exception.filter");
const { TenantContextInterceptor } =
  await import("../../../../server/src/modules/tenant/tenant-context.interceptor");
const { SyncProcessingJob } =
  await import("../../../../server/src/modules/sync/jobs/sync-processing.job");
const { seedSubscription } =
  await import("../../../../server/test/helpers/subscription-seed");

// POS side (real domain code)
import {
  SalesPosService,
  createSalesPosService,
} from "../sales-pos/sales-pos.service";
import { createInventoryLotsService } from "../inventory-lots/inventory-lots.service";
import {
  CashShiftService,
  createCashShiftService,
} from "../cash-shift/cash-shift.service";
import { useLocalSessionStore } from "../auth/local-session.store";
import { createSyncPushService } from "../sync/sync-push.service";
import { createSalesSyncService } from "../sales-pos/sales-sync.service";

// ---------------------------------------------------------------------------
// The fake hub
// ---------------------------------------------------------------------------

/**
 * An in-memory stand-in for the Rust hub, implementing the wire contract of
 * `src-tauri/src/local_sync_server.rs`:
 *
 *  - `push` dedupes by `operationUuid` (first write wins) and answers with
 *    the uuids it durably accepted, so the sender can stamp `lanRelayedAt`.
 *  - `pull` returns the operations received AFTER the cursor and EXCLUDING
 *    the pulling station's own, and advances the cursor to the newest
 *    `received_at`.
 *
 * The cursor is an RFC3339 timestamp with NANOSECOND precision, like the
 * Rust one. That precision is not cosmetic: the pull filter is a strict `>`,
 * so a millisecond-truncated cursor would re-deliver — or skip — every
 * operation that shares a millisecond with another.
 */
class FakeHub {
  private readonly buffer: Array<{
    op: LocalOperation;
    receivedAt: string;
  }> = [];
  private readonly known = new Set<string>();
  private readonly baseMs: number;
  private seq = 0;
  /** Off by default, exactly like the Rust hub. See deliverOwnOperationsToEveryone. */
  private deliverOwnOperations = false;

  constructor(baseMs = Date.parse("2026-01-01T00:00:00.000Z")) {
    this.baseMs = baseMs;
  }

  /** One millisecond per operation, so two ops never share a cursor value. */
  private stamp(): string {
    this.seq += 1;
    return new Date(this.baseMs + this.seq)
      .toISOString()
      .replace("Z", "000000Z");
  }

  push(operations: LocalOperation[]): {
    accepted: number;
    rejected: number;
    conflicts: Array<{
      operationUuid: string;
      reason: string;
      winningOperationUuid: string;
    }>;
    acceptedOperationUuids: string[];
  } {
    const acceptedOperationUuids: string[] = [];
    for (const op of operations) {
      // The hub's idempotency set: a replayed push is answered as accepted
      // (the hub durably holds the operation) without storing a second copy.
      if (this.known.has(op.operationUuid)) {
        acceptedOperationUuids.push(op.operationUuid);
        continue;
      }
      this.known.add(op.operationUuid);
      this.buffer.push({ op, receivedAt: this.stamp() });
      acceptedOperationUuids.push(op.operationUuid);
    }
    return {
      accepted: acceptedOperationUuids.length,
      rejected: 0,
      conflicts: [],
      acceptedOperationUuids,
    };
  }

  pull(
    since: string,
    workstationId: string,
  ): { operations: LocalOperation[]; nextSince: string } {
    const matched = this.buffer
      .filter(
        (entry) =>
          (this.deliverOwnOperations ||
            entry.op.sourceWorkstationId !== workstationId) &&
          entry.receivedAt > since,
      )
      .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1));
    let latest = since;
    for (const entry of matched) {
      if (entry.receivedAt > latest) latest = entry.receivedAt;
    }
    return { operations: matched.map((entry) => entry.op), nextSince: latest };
  }

  /**
   * Make the hub hand a station the operations that claim ITS OWN id.
   *
   * The Rust hub never does that — it filters the pulling station's own
   * operations out — so this is off by default. It exists to exercise the
   * engine's own guard (the defence in depth that matters if a hub ever
   * changes its filtering).
   */
  deliverOwnOperationsToEveryone(deliver: boolean): void {
    this.deliverOwnOperations = deliver;
  }

  /** How many copies of an operation the hub holds. */
  countFor(operationUuid: string): number {
    return this.buffer.filter((e) => e.op.operationUuid === operationUuid).length;
  }
}

// The mock factory is hoisted above the imports, so the hub is reached through
// a holder the factory closes over and only READS when a command runs.
const { hubRef } = vi.hoisted(() => ({
  hubRef: { current: null as FakeHub | null },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (
    command: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> => {
    const hub = hubRef.current;
    if (!hub) throw new Error("the fake hub is not installed");
    if (command === "get_local_sync_status") {
      return { currentHubAddress: "hub://fake-hub", backoffUntil: null };
    }
    if (command === "push_to_hub") {
      return hub.push((args as { operations: LocalOperation[] }).operations);
    }
    if (command === "pull_from_hub") {
      return hub.pull(
        (args as { since: string }).since,
        (args as { workstationId?: string }).workstationId ?? "",
      );
    }
    throw new Error(`unexpected Tauri command: ${command}`);
  },
}));

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

// Server-side workstation rows (one per terminal).
const SERVER_WS_A_ID = uuidFrom("pos-int-lan-server-ws-a");
const SERVER_WS_B_ID = uuidFrom("pos-int-lan-server-ws-b");
const SERVER_USER_ID = uuidFrom("pos-int-lan-server-user-id");
const USERNAME = "pos-integration-lan@pos.test";
const PASSWORD = "PosIntegrationLan123!";

const SERVER_PRODUCT_ID = uuidFrom("pos-int-lan-server-product");
const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-lan-server-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-lan-server-pm-cash");
const SERVER_LOT_ID = uuidFrom("pos-int-lan-server-lot");
const SERVER_SUPPLIER_ID = uuidFrom("pos-int-lan-server-supplier");
const SERVER_RECEPTION_ID = uuidFrom("pos-int-lan-server-reception");
const SERVER_RECEPTION_ITEM_ID = uuidFrom("pos-int-lan-server-reception-item");
const LOT_UNIT_COST = new Prisma.Decimal("8000");

const SERVER_RESOLUTION_A_ID = uuidFrom("pos-int-lan-fiscal-resolution-a");
const SERVER_ALLOCATION_A_ID = uuidFrom("pos-int-lan-fiscal-allocation-a");
const SERVER_RESOLUTION_B_ID = uuidFrom("pos-int-lan-fiscal-resolution-b");
const SERVER_ALLOCATION_B_ID = uuidFrom("pos-int-lan-fiscal-allocation-b");

/** The generic consumer every anonymous sale falls back to. */
const GENERIC_CLIENT_ID = "00000000-0000-0000-0000-000000000001";

// Local (POS) ids. The local product row mirrors the server product with the
// SAME id (established-pharmacy case).
const PRODUCT_ID = SERVER_PRODUCT_ID;
const PM_CASH_ID = SERVER_PM_CASH_ID;
// The POS's workstation id IS the server's: the app registers the terminal
// under its own UUID, so the id a station stamps on its operations is the id
// the server knows it by. A relayed operation carries that id in its
// payload, and the server needs it to file the operation under the
// ORIGIN instead of under the station that delivered it.
const POS_WS_A_ID = SERVER_WS_A_ID;
const POS_WS_B_ID = SERVER_WS_B_ID;

const UNIT_PRICE = 15000;
const SALE_QTY = 2;
const TOTAL = 35700; // 2 × 15000 × 1.19
const LOT_INITIAL_STOCK = 50;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — the LAN relay between two workstations", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let tokenA: string;
  let tokenB: string;

  // POS terminal A
  let pgA: PGlite;
  let localPrismaA: LocalPrismaClient;
  let salesPosA: SalesPosService;
  let cashShiftA: CashShiftService;

  // POS terminal B
  let pgB: PGlite;
  let localPrismaB: LocalPrismaClient;
  let salesPosB: SalesPosService;
  let cashShiftB: CashShiftService;

  /** The one hub both stations talk to. */
  let hub: FakeHub;

  /** The operation A's sale produced — the uuid every assertion keys on. */
  let saleOperationUuid: string;

  const cleanServerRows = async (): Promise<void> => {
    const wsIds = [SERVER_WS_A_ID, SERVER_WS_B_ID];
    const resolutionIds = [SERVER_RESOLUTION_A_ID, SERVER_RESOLUTION_B_ID];
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.shiftCashCount.deleteMany({
      where: { cashShift: { workstationId: { in: wsIds } } },
    });
    await serverPrisma.saleItemLot.deleteMany({ where: { lotId: SERVER_LOT_ID } });
    await serverPrisma.saleItem.deleteMany({
      where: { sale: { cashShift: { workstationId: { in: wsIds } } } },
    });
    await serverPrisma.salePayment.deleteMany({
      where: { sale: { cashShift: { workstationId: { in: wsIds } } } },
    });
    await serverPrisma.sale.deleteMany({
      where: { cashShift: { workstationId: { in: wsIds } } },
    });
    await serverPrisma.cashShift.deleteMany({
      where: { workstationId: { in: wsIds } },
    });
    await serverPrisma.inventoryMovement.deleteMany({
      where: { lotId: SERVER_LOT_ID },
    });
    await serverPrisma.lot.deleteMany({ where: { id: SERVER_LOT_ID } });
    await serverPrisma.purchaseReceptionItem.deleteMany({
      where: { id: SERVER_RECEPTION_ITEM_ID },
    });
    await serverPrisma.purchaseReception.deleteMany({
      where: { id: SERVER_RECEPTION_ID },
    });
    await serverPrisma.supplier.deleteMany({ where: { id: SERVER_SUPPLIER_ID } });
    await serverPrisma.fiscalDocument.deleteMany({
      where: { subscriptionId, resolutionId: { in: resolutionIds } },
    });
    await serverPrisma.fiscalResolutionAllocation.deleteMany({
      where: { workstationId: { in: wsIds } },
    });
    await serverPrisma.fiscalResolution.deleteMany({
      where: { id: { in: resolutionIds } },
    });
    await serverPrisma.productPriceHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.productTaxHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.product.deleteMany({ where: { id: SERVER_PRODUCT_ID } });
    await serverPrisma.taxScheme.deleteMany({ where: { id: SERVER_TAX_SCHEME_ID } });
    await serverPrisma.paymentMethod.deleteMany({
      where: { id: SERVER_PM_CASH_ID },
    });
    await serverPrisma.auditLog.deleteMany({ where: { userId: SERVER_USER_ID } });
    await serverPrisma.auditLog.deleteMany({
      where: { workstationId: { in: wsIds } },
    });
    await serverPrisma.userSession.deleteMany({ where: { userId: SERVER_USER_ID } });
    await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
    await serverPrisma.workstation.deleteMany({ where: { id: { in: wsIds } } });
  };

  beforeAll(async () => {
    // =====================================================================
    // 1. SERVER — real NestJS app, real Postgres, TWO workstations
    // =====================================================================
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-lan");
    await cleanServerRows();

    for (const [id, name, code] of [
      [SERVER_WS_A_ID, "POS LAN Terminal A", "WS-POS-LAN-A"],
      [SERVER_WS_B_ID, "POS LAN Terminal B", "WS-POS-LAN-B"],
    ] as const) {
      await serverPrisma.workstation.create({
        data: { id, name, code, isActive: true, registeredAt: new Date() },
      });
    }

    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS LAN Integration Cashier",
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
        code: "POS-LAN-IVA19",
        name: "POS LAN IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: new Date("2024-01-01"),
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    // The generic consumer every anonymous sale falls back to. Its id is
    // shared by every suite (it is the primary key), so it is created here
    // rather than assumed: the sale replay resolves it by that id.
    await serverPrisma.client.upsert({
      where: { id: GENERIC_CLIENT_ID },
      update: { subscriptionId },
      create: {
        id: GENERIC_CLIENT_ID,
        subscriptionId,
        identificationType: "NIT",
        identificationNumber: "222222222222",
        fullName: "CONSUMIDOR FINAL",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    await serverPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_ID,
        subscriptionId,
        internalCode: "POS-LAN-001",
        commercialName: "POS LAN Integration Product",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    const priceHistory = await serverPrisma.productPriceHistory.create({
      data: {
        id: uuidFrom("pos-int-lan-server-price-hist"),
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        changedById: SERVER_USER_ID,
        changedAt: new Date(),
      },
    });
    const taxHistory = await serverPrisma.productTaxHistory.create({
      data: {
        id: uuidFrom("pos-int-lan-server-tax-hist"),
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        taxSchemeId: SERVER_TAX_SCHEME_ID,
        effectiveFrom: new Date(),
        changedById: SERVER_USER_ID,
        changedAt: new Date(),
      },
    });
    await serverPrisma.product.update({
      where: { id: SERVER_PRODUCT_ID },
      data: { currentPriceId: priceHistory.id, currentTaxHistoryId: taxHistory.id },
    });

    await serverPrisma.lot.create({
      data: {
        id: SERVER_LOT_ID,
        subscriptionId,
        batchNumber: "POS-LAN-BATCH",
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date("2026-01-01"),
        state: "ACTIVE",
        currentStock: LOT_INITIAL_STOCK,
        version: 0,
        productId: SERVER_PRODUCT_ID,
      },
    });

    await serverPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_ID,
        subscriptionId,
        identificationType: "NIT",
        identificationNumber: "900123456-3",
        businessName: "POS LAN Integration Supplier",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    await serverPrisma.purchaseReception.create({
      data: {
        id: SERVER_RECEPTION_ID,
        subscriptionId,
        sequentialNumber: 1,
        state: "CONFIRMED",
        receivedAt: new Date("2026-01-02"),
        createdById: SERVER_USER_ID,
        supplierId: SERVER_SUPPLIER_ID,
      },
    });
    await serverPrisma.purchaseReceptionItem.create({
      data: {
        id: SERVER_RECEPTION_ITEM_ID,
        subscriptionId,
        purchaseReceptionId: SERVER_RECEPTION_ID,
        productId: SERVER_PRODUCT_ID,
        lotId: SERVER_LOT_ID,
        receivedQuantity: LOT_INITIAL_STOCK,
        lotNumber: "POS-LAN-BATCH",
        expirationDate: new Date("2027-12-31"),
        realUnitCost: LOT_UNIT_COST,
        taxSchemeId: SERVER_TAX_SCHEME_ID,
      },
    });

    for (const [wsId, resId, allocId, prefix] of [
      [SERVER_WS_A_ID, SERVER_RESOLUTION_A_ID, SERVER_ALLOCATION_A_ID, "POS-LANA"],
      [SERVER_WS_B_ID, SERVER_RESOLUTION_B_ID, SERVER_ALLOCATION_B_ID, "POS-LANB"],
    ] as const) {
      await serverPrisma.fiscalResolution.create({
        data: {
          id: resId,
          subscriptionId,
          resolutionNumber: `187640${prefix.length}${resId.slice(0, 6)}`,
          documentType: "INVOICE",
          prefix,
          rangeFrom: 1,
          rangeTo: 1000,
          validFrom: new Date("2026-01-01"),
          validTo: new Date("2027-12-31"),
          state: "ACTIVE",
          workstationId: wsId,
        },
      });
      await serverPrisma.fiscalResolutionAllocation.create({
        data: {
          id: allocId,
          subscriptionId,
          resolutionId: resId,
          workstationId: wsId,
          rangeFrom: 1,
          rangeTo: 1000,
          allocatedAt: new Date("2026-01-01"),
          allocatedByUserId: SERVER_USER_ID,
        },
      });
    }

    await serverPrisma.paymentMethod.create({
      data: {
        subscriptionId,
        id: SERVER_PM_CASH_ID,
        internalCode: "POS-LAN-CASH",
        name: "POS LAN Integration Cash",
        category: "CASH",
        isCash: true,
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

    const login = async (workstationId: string): Promise<string> => {
      const res = await request(serverApp.getHttpServer())
        .post("/auth/login")
        .send({
          identifier: USERNAME,
          secret: PASSWORD,
          sessionType: "PASSWORD",
          workstationId,
        })
        .expect(200);
      return res.body.accessToken as string;
    };
    tokenA = await login(SERVER_WS_A_ID);
    tokenB = await login(SERVER_WS_B_ID);

    // =====================================================================
    // 2. TWO POS terminals — two real PGlite databases, fully independent
    // =====================================================================
    const bootTerminal = async (
      suffix: string,
    ): Promise<{ pg: PGlite; prisma: LocalPrismaClient }> => {
      const pg = new PGlite("memory://");
      await pg.exec(LOCAL_SCHEMA_SQL);
      const prisma = new LocalPrismaClient({ adapter: new PrismaPGlite(pg) });
      const now = new Date();
      await prisma.client.create({
        data: {
          id: GENERIC_CLIENT_ID,
          identificationType: "NIT",
          identificationNumber: "222222222222",
          fullName: "CONSUMIDOR FINAL",
          isActive: true,
          createdById: SERVER_USER_ID,
        },
      });
      await prisma.product.create({
        data: {
          id: PRODUCT_ID,
          internalCode: "POS-LAN-001",
          commercialName: "POS LAN Integration Product",
          laboratory: "E2E Lab",
          saleType: "FREE_SALE",
          isActive: true,
          createdById: SERVER_USER_ID,
          createdAt: now,
          updatedAt: now,
        },
      });
      await prisma.productPriceHistory.create({
        data: {
          id: uuidFrom(`pos-int-lan-local-price-hist-${suffix}`),
          productId: PRODUCT_ID,
          price: new Prisma.Decimal(UNIT_PRICE),
          effectiveFrom: now,
          changedById: SERVER_USER_ID,
          changedAt: now,
        },
      });
      await prisma.taxScheme.create({
        data: {
          id: SERVER_TAX_SCHEME_ID,
          code: "IVA-19",
          name: "IVA 19",
          taxType: "IVA",
          rate: new Prisma.Decimal("19"),
          effectiveFrom: now,
          createdById: SERVER_USER_ID,
        },
      });
      await prisma.productTaxHistory.create({
        data: {
          id: uuidFrom(`pos-int-lan-local-tax-hist-${suffix}`),
          productId: PRODUCT_ID,
          taxSchemeId: SERVER_TAX_SCHEME_ID,
          effectiveFrom: now,
          changedById: SERVER_USER_ID,
          changedAt: now,
        },
      });
      await prisma.lot.create({
        data: {
          // The SAME id as the server's lot: the lot pull brings the server's
          // id down, and a pulled sale carries its lots by that id. A local
          // lot with a different id would make the peer's mirror unable to
          // apply the sale (SaleItemLot_lotId_fkey).
          id: SERVER_LOT_ID,
          batchNumber: "POS-LAN-BATCH",
          expirationDate: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
          entryDate: now,
          state: "ACTIVE",
          currentStock: LOT_INITIAL_STOCK,
          productId: PRODUCT_ID,
        },
      });
      await prisma.paymentMethod.create({
        data: {
          id: PM_CASH_ID,
          internalCode: "POS-LAN-CASH",
          name: "POS LAN Integration Cash",
          category: "CASH",
          isCash: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      });
      return { pg, prisma };
    };

    const terminalA = await bootTerminal("a");
    pgA = terminalA.pg;
    localPrismaA = terminalA.prisma;
    const terminalB = await bootTerminal("b");
    pgB = terminalB.pg;
    localPrismaB = terminalB.prisma;

    // The one hub of the store.
    hub = new FakeHub();
    hubRef.current = hub;
  }, 180000);

  afterAll(async () => {
    hubRef.current = null;
    if (localPrismaA) await localPrismaA.$disconnect();
    if (pgA) await pgA.close();
    if (localPrismaB) await localPrismaB.$disconnect();
    if (pgB) await pgB.close();

    if (serverPrisma) {
      await cleanServerRows();
      await serverPrisma.$disconnect();
    }
    if (serverApp) await serverApp.close();
  }, 120000);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * The local session store is global to the POS process: point it at a
   * terminal before driving that terminal's services (this is exactly what
   * the app does — the logged-in session decides the workstation).
   */
  const useTerminalSession = (
    localWsId: string,
    token: string,
    sessionId: string,
  ): void => {
    useLocalSessionStore.getState().setSession({
      userId: SERVER_USER_ID,
      username: USERNAME,
      fullName: "POS LAN Integration Cashier",
      displayName: "POS LAN Integration Cashier",
      role: "ADMIN",
      subscriptionId: subscriptionId!,
      workstationId: localWsId,
      accessToken: token,
      refreshToken: `refresh-${sessionId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId,
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
    });
  };

  const makeTerminalServices = (
    prisma: LocalPrismaClient,
  ): {
    salesPos: SalesPosService;
    cashShift: CashShiftService;
  } => {
    const auth = {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any;
    return {
      salesPos: createSalesPosService(
        prisma,
        auth,
        createInventoryLotsService(prisma),
      ),
      cashShift: createCashShiftService(prisma, auth),
    };
  };

  /**
   * A relay engine for one station.
   *
   * The module is re-imported for every station on purpose: in production
   * each terminal is its own process with its own pull cursor, and the
   * in-memory cursor fallback lives in the module. Two instances of the same
   * module would share ONE cursor, and the peer would then miss the
   * operations that arrived before the cursor moved — the relay would look
   * broken when it is not.
   */
  const makeEngine = async (
    prisma: LocalPrismaClient,
    workstationId: string,
  ): Promise<{
    runCycle: () => Promise<{
      outcome: string;
      pushedToHub: number;
      adoptedFromHub: number;
      identityCollisions?: number;
    }>;
  }> => {
    vi.resetModules();
    const mod = await import("../local-sync/local-sync-engine.service");
    const engine = mod.createLocalSyncEngine({
      prisma,
      workstationId,
      intervalMs: 60_000,
    });
    return engine;
  };

  const drainServerQueue = async (): Promise<void> => {
    const job = serverApp.get(SyncProcessingJob);
    for (let i = 0; i < 10; i++) {
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

  const pushToServer = async (
    prisma: LocalPrismaClient,
    token: string,
    workstationId: string,
  ): Promise<{ pushed: number; accepted: number }> => {
    const push = createSyncPushService({
      prisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: token,
      // The app tells the push service which station it is, so the entries it
      // adopted from the hub can be marked as relayed.
      workstationId,
    });
    return push.pushPending();
  };

  // -------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------

  it("relays a sale made while the internet is down to the peer station", async () => {
    // ── Terminal A: open a shift and sell, with NO internet ─────────────
    useTerminalSession(POS_WS_A_ID, tokenA, "pos-int-lan-session-a");
    const servicesA = makeTerminalServices(localPrismaA);
    salesPosA = servicesA.salesPos;
    cashShiftA = servicesA.cashShift;

    const shiftA = await cashShiftA.openShift({
      openingBalance: new Prisma.Decimal("100000"),
    });
    expect(shiftA.state).toBe("OPEN");

    const saleA = (await salesPosA.create({
      items: [{ productId: PRODUCT_ID, quantity: SALE_QTY }],
    })) as { id: string };
    await salesPosA.confirm(saleA.id, {
      payments: [{ paymentMethodId: PM_CASH_ID, amount: TOTAL }],
    });

    // The sale is in A's outbox, still PENDING: the internet is down, so
    // nothing has been pushed to the server yet.
    const aSaleEntry = await localPrismaA.syncQueue.findFirstOrThrow({
      where: { operationType: "SALE_CONFIRMATION" },
    });
    expect(aSaleEntry.status).toBe("PENDING");
    expect(aSaleEntry.lanRelayedAt).toBeNull();
    saleOperationUuid = aSaleEntry.operationUuid;

    // A's own stock moved locally; the server's did not.
    const aLot = await localPrismaA.lot.findFirstOrThrow();
    expect(aLot.currentStock).toBe(LOT_INITIAL_STOCK - SALE_QTY);
    const serverLotBefore = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(serverLotBefore.currentStock).toBe(LOT_INITIAL_STOCK);

    // ── The relay: A pushes its outbox to the store's hub ─────────────
    const engineA = await makeEngine(localPrismaA, POS_WS_A_ID);
    const cycleA = await engineA.runCycle();
    expect(cycleA.outcome).toBe("ok");
    expect(cycleA.pushedToHub).toBeGreaterThan(0);

    const relayedEntry = await localPrismaA.syncQueue.findUniqueOrThrow({
      where: { operationUuid: saleOperationUuid },
    });
    // The hub durably holds it, so A knows it is safe in the store.
    expect(relayedEntry.lanRelayedAt).not.toBeNull();
    // The hub keeps ONE copy, no matter how many times a station pushes it.
    expect(hub.countFor(saleOperationUuid)).toBe(1);

    // ── The peer: B pulls the hub and adopts the operation ─────────────
    const engineB = await makeEngine(localPrismaB, POS_WS_B_ID);
    const cycleB = await engineB.runCycle();
    expect(cycleB.outcome).toBe("ok");
    expect(cycleB.adoptedFromHub).toBeGreaterThan(0);

    const bAdopted = await localPrismaB.syncQueue.findFirstOrThrow({
      where: { operationUuid: saleOperationUuid },
    });
    // The payload is forwarded byte-for-byte and keeps its ORIGIN: the peer
    // is a courier, not the author.
    expect(bAdopted.sourceWorkstationId).toBe(POS_WS_A_ID);
    expect(bAdopted.operationType).toBe("SALE_CONFIRMATION");
    expect(bAdopted.status).toBe("PENDING");
    expect(bAdopted.payload).toBe(relayedEntry.payload);
    expect(bAdopted.payloadHash).toBe(relayedEntry.payloadHash);

    // ── The relay applies NO business logic locally ─────────────────────
    // B has the operation, but its own books are untouched: the server is
    // the only component that replays stock, fiscal numbering and credit.
    const bSales = await localPrismaB.sale.count();
    expect(bSales).toBe(0);
    const bLot = await localPrismaB.lot.findFirstOrThrow();
    expect(bLot.currentStock).toBe(LOT_INITIAL_STOCK);
  }, 120000);

  it("adopts the relayed operation only once, even when the hub re-sends it", async () => {
    // The hub can re-deliver what it already holds: a restarted hub, a lost
    // pull cursor, a peer that re-reads the whole buffer. The adoption must
    // be idempotent — the peer keeps ONE copy of the operation.
    const before = await localPrismaB.syncQueue.count({
      where: { operationUuid: saleOperationUuid },
    });
    expect(before).toBe(1);

    // Re-deliver: the hub answers a pull from the epoch with everything it
    // holds, including the operation B already has.
    const engineB = await makeEngine(localPrismaB, POS_WS_B_ID);
    const cycleB = await engineB.runCycle();
    expect(cycleB.outcome).toBe("ok");

    const after = await localPrismaB.syncQueue.count({
      where: { operationUuid: saleOperationUuid },
    });
    expect(after).toBe(1);
  }, 60000);

  it("applies the relayed sale on the server exactly once when the internet returns", async () => {
    // The internet is back. BOTH stations push the same operation — the
    // origin has its own copy and the peer holds the relayed one.
    const pushA = await pushToServer(localPrismaA, tokenA, POS_WS_A_ID);
    expect(pushA.pushed).toBeGreaterThan(0);

    const pushB = await pushToServer(localPrismaB, tokenB, POS_WS_B_ID);
    expect(pushB.pushed).toBeGreaterThan(0);

    await drainServerQueue();

    // ── ONE sale ────────────────────────────────────────────────────────
    const serverSales = await serverPrisma.sale.findMany({
      where: { sourceWorkstationId: SERVER_WS_A_ID },
      include: { items: true, payments: true },
    });
    expect(serverSales).toHaveLength(1);
    const serverSale = serverSales[0];
    expect(serverSale.operationalState).toBe("CONFIRMED");
    expect(Number(serverSale.totalAmount)).toBe(TOTAL);

    // ── The stock moved ONCE ────────────────────────────────────────────
    const serverLot = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(serverLot.currentStock).toBe(LOT_INITIAL_STOCK - SALE_QTY);

    // ── ONE inventory movement ─────────────────────────────────────────
    const movements = await serverPrisma.inventoryMovement.findMany({
      where: { lotId: SERVER_LOT_ID },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].movementType).toBe("SALE");
    expect(movements[0].quantity).toBe(SALE_QTY);

    // ── ONE invoice ─────────────────────────────────────────────────────
    const invoices = await serverPrisma.fiscalDocument.findMany({
      where: { saleId: serverSale.id },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].documentType).toBe("INVOICE");
    // The invoice is numbered from the resolution of the station that OPENED
    // the shift — the sale belongs to that shift, wherever it was pushed from.
    expect(invoices[0].resolutionId).toBe(SERVER_RESOLUTION_A_ID);
    expect(invoices[0].fullNumber).toBe("POS-LANA1");

    // ── ONE queue row and ONE outcome for the operation ─────────────────
    const queueRows = await serverPrisma.syncQueue.findMany({
      where: { operationUuid: saleOperationUuid },
    });
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0].status).toBe("COMPLETED");

    const outcomes = await serverPrisma.syncOperationOutcome.findMany({
      where: { operationUuid: saleOperationUuid },
    });
    expect(outcomes).toHaveLength(1);

    // ── The relay did not create a second shift ─────────────────────────
    const shifts = await serverPrisma.cashShift.findMany({
      where: { workstationId: { in: [SERVER_WS_A_ID, SERVER_WS_B_ID] } },
    });
    expect(shifts).toHaveLength(1);
    expect(shifts[0].id).toBe(serverSale.cashShiftId);
  }, 120000);

  it("keeps the sale attributed to the station that made it", async () => {
    // The peer pushed the relayed copy; the sale must still belong to the
    // station that MADE it — its numbering scope, its own local number.
    const serverSale = await serverPrisma.sale.findFirstOrThrow({
      where: { sourceWorkstationId: SERVER_WS_A_ID },
    });
    expect(serverSale.workstationId).toBe(SERVER_WS_A_ID);
    expect(Number(serverSale.localNumber)).toBe(1);

    // And the station that made it keeps its own copy in step with the
    // server: the local sale and the server sale agree on the money.
    const localSale = await localPrismaA.sale.findFirstOrThrow({
      where: { operationalState: "CONFIRMED" },
    });
    expect(Number(localSale.totalAmount)).toBe(TOTAL);
    expect(localSale.cashShiftId).toBe(serverSale.cashShiftId);
  }, 60000);

  it("keeps the sale attributed to the station that made it even when the peer pushes it first", async () => {
    // The race: when the internet returns, the origin and the peer both hold
    // the operation, and whichever pushes first wins the race to the server.
    // The peer pushing first is the interesting case — the server knows the
    // operation from the PEER's session, but the sale belongs to the station
    // that MADE it.
    useTerminalSession(POS_WS_A_ID, tokenA, "pos-int-lan-session-a2");
    const servicesA = makeTerminalServices(localPrismaA);
    salesPosA = servicesA.salesPos;
    cashShiftA = servicesA.cashShift;

    const secondSale = (await salesPosA.create({
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
    })) as { id: string };
    await salesPosA.confirm(secondSale.id, {
      payments: [{ paymentMethodId: PM_CASH_ID, amount: 17850 }],
    });

    const secondEntry = await localPrismaA.syncQueue.findFirstOrThrow({
      where: { operationType: "SALE_CONFIRMATION" },
      orderBy: { clientSequence: "desc" },
    });
    const secondOperationUuid = secondEntry.operationUuid;

    // A relays it to the hub, B adopts it.
    const engineA = await makeEngine(localPrismaA, POS_WS_A_ID);
    await engineA.runCycle();
    const engineB = await makeEngine(localPrismaB, POS_WS_B_ID);
    await engineB.runCycle();

    const adoptedOnB = await localPrismaB.syncQueue.findFirstOrThrow({
      where: { operationUuid: secondOperationUuid },
    });
    expect(adoptedOnB.status).toBe("PENDING");

    // ── THE PEER PUSHES FIRST ───────────────────────────────────────────
    const pushB = await pushToServer(localPrismaB, tokenB, POS_WS_B_ID);
    expect(pushB.pushed).toBeGreaterThan(0);
    // The server ACCEPTED it — the peer is a legitimate courier, not a
    // rejected stranger.
    expect(pushB.accepted).toBeGreaterThan(0);
    await drainServerQueue();

    // Now the origin pushes the same operation.
    const pushA = await pushToServer(localPrismaA, tokenA, POS_WS_A_ID);
    expect(pushA.pushed).toBeGreaterThan(0);
    await drainServerQueue();

    // ── ONE sale for the second operation, and it is A's ────────────────
    const rows = await serverPrisma.syncQueue.findMany({
      where: { operationUuid: secondOperationUuid },
    });
    expect(rows).toHaveLength(1);
    // The server knows the operation came through the store's LAN…
    expect(rows[0].operationSource).toBe("LOCAL_HUB");
    // …and filed it under the station that ORIGINATED it, not under the
    // station that delivered it.
    expect(rows[0].sourceWorkstationId).toBe(SERVER_WS_A_ID);

    const serverSale = await serverPrisma.sale.findFirstOrThrow({
      where: { sourceOperationUuid: secondOperationUuid },
    });
    expect(serverSale.operationalState).toBe("CONFIRMED");
    // The sale belongs to the station that MADE it: its numbering scope and
    // its local number are A's, not the peer's.
    expect(serverSale.sourceWorkstationId).toBe(SERVER_WS_A_ID);
    expect(Number(serverSale.localNumber)).toBe(2);

    // And the stock moved once more, not twice.
    const serverLot = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(serverLot.currentStock).toBe(LOT_INITIAL_STOCK - SALE_QTY - 1);
  }, 120000);

  it("converges the relayed sale on the peer's own mirror", async () => {
    // The peer holds the operation but not the sale: until the server
    // applies it, B's books do not show it. The sales pull is what closes
    // the gap.
    const salesSync = createSalesSyncService(localPrismaB, {
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: tokenB,
    });
    const rows = await salesSync.fetchSales();
    await salesSync.applySales(rows);

    const mirrored = await localPrismaB.sale.findFirst({
      where: { sourceWorkstationId: SERVER_WS_A_ID },
    });
    expect(mirrored).not.toBeNull();
    expect(Number(mirrored!.totalAmount)).toBe(TOTAL);
  }, 60000);

  it("never adopts an operation that claims the station's own id", async () => {
    // A terminal misconfigured with another terminal's workstation id would
    // make that terminal adopt foreign operations under its own identity.
    // The Rust hub filters the pulling station's own operations out, so this
    // is the engine's own guard being exercised: the hub is asked to deliver
    // the colliding operation anyway.
    const foreignOperation = {
      operationUuid: crypto.randomUUID(),
      operationType: "SALE_CONFIRMATION",
      payload: JSON.stringify({ fake: true }),
      payloadHash: "hash-of-a-foreign-operation",
      sourceWorkstationId: POS_WS_B_ID,
      sourceCreatedAt: new Date().toISOString(),
      retryCount: 0,
    };
    hub.push([foreignOperation]);
    hub.deliverOwnOperationsToEveryone(true);

    const engineB = await makeEngine(localPrismaB, POS_WS_B_ID);
    const cycleB = await engineB.runCycle();
    expect(cycleB.outcome).toBe("ok");
    // The engine counted it as a collision…
    expect(cycleB.identityCollisions).toBeGreaterThan(0);
    // …and did NOT adopt it: adopting would launder a foreign operation
    // under this station's identity.
    const adopted = await localPrismaB.syncQueue.findFirst({
      where: { operationUuid: foreignOperation.operationUuid },
    });
    expect(adopted).toBeNull();

    hub.deliverOwnOperationsToEveryone(false);
  }, 60000);
});
