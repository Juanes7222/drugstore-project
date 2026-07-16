/**
 * PGlite schema and data-layer integration tests for inventory adjustments.
 *
 * These tests create a real in-memory PGlite database, apply the full DDL
 * from LOCAL_SCHEMA_SQL, seed data, and then execute SQL queries directly
 * against PGlite.  This catches schema/constraint bugs a mocked PrismaClient
 * would miss for the inventory-adjustments domain:
 *
 * - Lot state enum enforcement
 * - Lot → Product foreign key (RESTRICT on delete)
 * - InventoryMovement → Lot foreign key
 * - MovementType enum enforcement
 * - currentStock non-negative application-level invariant
 * - version optimistic-locking pattern
 * - SyncQueue payload shape for INVENTORY_ADJUSTMENT operations
 *
 * Note: InventoryAdjustmentDocument is a server-only model and does not
 * exist in LOCAL_SCHEMA_SQL.  InventoryMovement.adjustmentDocumentId is
 * a nullable TEXT column at the local level (no FK constraint because the
 * target table is server-only).
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { LOCAL_SCHEMA_SQL } from "@pharmacy/database/local-schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedLotDependencies(pg: PGlite): Promise<{
  productId: string;
  userId: string;
}> {
  const productId = crypto.randomUUID();
  const userId = "user-inv-01";
  const now = new Date().toISOString();

  // Product
  await pg.exec(`
    INSERT INTO "Product" (id, "internalCode", "commercialName", "genericName",
      "activePrinciple", "laboratory", "saleType", "isActive", "createdById",
      "createdAt", "updatedAt")
    VALUES ('${productId}', 'INV001', 'Ibuprofeno 400mg', 'Ibuprofeno',
      'Ibuprofeno', 'Laboratorio Genérico', 'FREE_SALE', true,
      '${userId}', '${now}', '${now}');
  `);

  return { productId, userId };
}

/**
 * Create an ACTIVE lot via SQL with the given currentStock.
 * Returns the created lot id.
 */
async function insertLot(
  pg: PGlite,
  productId: string,
  overrides?: {
    batchNumber?: string;
    currentStock?: number;
    state?: string;
    version?: number;
    expirationDate?: string;
    entryDate?: string;
    locationCode?: string;
  },
): Promise<string> {
  const lotId = crypto.randomUUID();
  const batchNumber = overrides?.batchNumber ?? "BATCH-001";
  const stock = overrides?.currentStock ?? 100;
  const state = overrides?.state ?? "ACTIVE";
  const version = overrides?.version ?? 1;
  const expireAt = overrides?.expirationDate ?? "2027-06-30T00:00:00.000Z";
  const entryAt = overrides?.entryDate ?? "2026-01-15T00:00:00.000Z";
  const locationCode = overrides?.locationCode ?? "A-01";
  const now = new Date().toISOString();

  await pg.exec(`
    INSERT INTO "Lot" (id, "batchNumber", "expirationDate", "entryDate",
      state, "currentStock", "version", "productId", "locationCode",
      "createdAt", "updatedAt")
    VALUES ('${lotId}', '${batchNumber}', '${expireAt}', '${entryAt}',
      '${state}'::"LotState", ${stock}, ${version}, '${productId}', '${locationCode}',
      '${now}', '${now}');
  `);

  return lotId;
}

/**
 * Create an InventoryMovement record via SQL.
 * Returns the movement id.
 */
async function insertMovement(
  pg: PGlite,
  lotId: string,
  overrides?: {
    movementType?: string;
    quantity?: number;
    previousStock?: number;
    resultingStock?: number;
    createdById?: string;
    reason?: string | null;
  },
): Promise<string> {
  const movementId = crypto.randomUUID();
  const movementType = overrides?.movementType ?? "POSITIVE_ADJUSTMENT";
  const quantity = overrides?.quantity ?? 10;
  const previousStock = overrides?.previousStock ?? 100;
  const resultingStock = overrides?.resultingStock ?? 110;
  const createdById = overrides?.createdById ?? "user-inv-01";
  const now = new Date().toISOString();
  const reason = overrides?.reason ?? null;

  await pg.exec(`
    INSERT INTO "InventoryMovement" (id, "movementType", quantity,
      "previousStock", "resultingStock", "createdById", "createdAt",
      "lotId", reason)
    VALUES ('${movementId}', '${movementType}'::"MovementType", ${quantity},
      ${previousStock}, ${resultingStock}, '${createdById}', '${now}',
      '${lotId}', ${reason === null ? "NULL" : `'${reason.replace(/'/g, "''")}'`});
  `);

  return movementId;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Inventory adjustments — PGlite data layer", () => {
  let pg: PGlite;
  let seeds: Awaited<ReturnType<typeof seedLotDependencies>>;

  beforeEach(async () => {
    pg = new PGlite("memory://");
    await pg.exec(LOCAL_SCHEMA_SQL);
    seeds = await seedLotDependencies(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  // -----------------------------------------------------------------------
  // Lot table
  // -----------------------------------------------------------------------
  describe("Lot table", () => {
    it("creates a lot with ACTIVE state and default version 0", async () => {
      const now = new Date().toISOString();
      const lotId = crypto.randomUUID();

      // Use DEFAULT for version and state
      await pg.exec(`
        INSERT INTO "Lot" (id, "batchNumber", "expirationDate", "entryDate",
          "currentStock", "productId", "createdAt", "updatedAt")
        VALUES ('${lotId}', 'B-DEFAULT', '2027-12-31T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z', 50, '${seeds.productId}',
          '${now}', '${now}');
      `);

      const result = await pg.query(
        `SELECT state, version, "currentStock" FROM "Lot" WHERE id = $1`,
        [lotId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(row.state).toBe("ACTIVE");
      expect(row.version).toBe(0);
      expect(row.currentStock).toBe(50);
    });

    it("enforces LotState enum — rejects invalid state values", async () => {
      const now = new Date().toISOString();
      const lotId = crypto.randomUUID();

      await expect(
        pg.exec(`
          INSERT INTO "Lot" (id, "batchNumber", "expirationDate", "entryDate",
            state, "currentStock", "productId", "createdAt", "updatedAt")
          VALUES ('${lotId}', 'B-BAD-STATE', '2027-12-31T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z', 'INVALID_STATE'::"LotState",
            50, '${seeds.productId}', '${now}', '${now}');
        `),
      ).rejects.toThrow();
    });

    it("transitions state from ACTIVE to EXHAUSTED", async () => {
      const lotId = await insertLot(pg, seeds.productId, { currentStock: 10 });

      await pg.exec(`
        UPDATE "Lot" SET state = 'EXHAUSTED'::"LotState",
          "currentStock" = 0,
          "updatedAt" = '${new Date().toISOString()}'
        WHERE id = '${lotId}';
      `);

      const result = await pg.query(
        `SELECT state FROM "Lot" WHERE id = $1`,
        [lotId],
      );
      expect((result.rows[0] as Record<string, unknown>).state).toBe("EXHAUSTED");
    });

    it("transitions state from ACTIVE to EXPIRED", async () => {
      const lotId = await insertLot(pg, seeds.productId);

      await pg.exec(`
        UPDATE "Lot" SET state = 'EXPIRED'::"LotState",
          "updatedAt" = '${new Date().toISOString()}'
        WHERE id = '${lotId}';
      `);

      const result = await pg.query(
        `SELECT state FROM "Lot" WHERE id = $1`,
        [lotId],
      );
      expect((result.rows[0] as Record<string, unknown>).state).toBe("EXPIRED");
    });

    it("transitions state from ACTIVE to BLOCKED with block metadata", async () => {
      const lotId = await insertLot(pg, seeds.productId);

      const now = new Date().toISOString();
      await pg.exec(`
        UPDATE "Lot" SET state = 'BLOCKED'::"LotState",
          "blockedAt" = '${now}',
          "blockedByUserId" = 'user-admin-01',
          "blockReason" = 'Quality hold — temperature excursion',
          "updatedAt" = '${now}'
        WHERE id = '${lotId}';
      `);

      const result = await pg.query(
        `SELECT state, "blockedAt", "blockedByUserId", "blockReason" FROM "Lot" WHERE id = $1`,
        [lotId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(row.state).toBe("BLOCKED");
      expect(row.blockedByUserId).toBe("user-admin-01");
      expect(row.blockReason).toMatch(/temperature/i);
    });

    it("rejects transition to an invalid state value", async () => {
      const lotId = await insertLot(pg, seeds.productId);

      await expect(
        pg.exec(`
          UPDATE "Lot" SET state = 'BOGUS'::"LotState"
          WHERE id = '${lotId}';
        `),
      ).rejects.toThrow();
    });

    it("supports the version optimistic-locking column", async () => {
      const lotId = await insertLot(pg, seeds.productId, { version: 5, currentStock: 100 });

      // Update with matching version — stock goes from 100 to 200, version 5→6
      await pg.exec(`
        UPDATE "Lot" SET "currentStock" = 200,
          version = version + 1,
          "updatedAt" = '${new Date().toISOString()}'
        WHERE id = '${lotId}' AND version = 5;
      `);

      const row1 = (
        await pg.query(`SELECT "currentStock", version FROM "Lot" WHERE id = $1`, [lotId])
      ).rows[0] as Record<string, unknown>;
      expect(row1.currentStock).toBe(200);
      expect(row1.version).toBe(6);

      // Stale version (5) — no rows updated because version is now 6
      await pg.exec(`
        UPDATE "Lot" SET "currentStock" = 999,
          version = version + 1,
          "updatedAt" = '${new Date().toISOString()}'
        WHERE id = '${lotId}' AND version = 5;
      `);

      // Verify stock is still 200 (not 999), version still 6
      const row2 = (
        await pg.query(`SELECT "currentStock", version FROM "Lot" WHERE id = $1`, [lotId])
      ).rows[0] as Record<string, unknown>;
      expect(row2.currentStock).toBe(200);
      expect(row2.version).toBe(6);
    });

    it("enforces foreign key to Product (ON DELETE RESTRICT)", async () => {
      const lotId = await insertLot(pg, seeds.productId);

      await expect(
        pg.exec(`DELETE FROM "Product" WHERE id = '${seeds.productId}'`),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });

    it("orders lots by expirationDate (FEFO)", async () => {
      const earlyId = await insertLot(pg, seeds.productId, {
        batchNumber: "B-EARLY",
        expirationDate: "2026-06-01T00:00:00.000Z",
        currentStock: 10,
      });
      const lateId = await insertLot(pg, seeds.productId, {
        batchNumber: "B-LATE",
        expirationDate: "2027-01-01T00:00:00.000Z",
        currentStock: 20,
      });

      const result = await pg.query(`
        SELECT id FROM "Lot"
        WHERE "productId" = '${seeds.productId}' AND state = 'ACTIVE'
        ORDER BY "expirationDate" ASC;
      `);

      expect(result.rows).toHaveLength(2);
      expect((result.rows[0] as Record<string, unknown>).id).toBe(earlyId);
      expect((result.rows[1] as Record<string, unknown>).id).toBe(lateId);
    });

    it("does not enforce non-negative currentStock at the DB level", async () => {
      // currentStock is INTEGER with no CHECK constraint — the POS is
      // responsible for preventing over-consumption at the application layer.
      const lotId = await insertLot(pg, seeds.productId, { currentStock: 5 });

      // This should succeed because there's no CHECK(currentStock >= 0)
      await pg.exec(`
        UPDATE "Lot" SET "currentStock" = -3,
          "updatedAt" = '${new Date().toISOString()}'
        WHERE id = '${lotId}';
      `);

      const result = await pg.query(
        `SELECT "currentStock" FROM "Lot" WHERE id = $1`,
        [lotId],
      );
      expect((result.rows[0] as Record<string, unknown>).currentStock).toBe(-3);
    });

    it("stores multiple lots for the same product", async () => {
      const lot1 = await insertLot(pg, seeds.productId, { batchNumber: "B-01" });
      const lot2 = await insertLot(pg, seeds.productId, { batchNumber: "B-02" });
      const lot3 = await insertLot(pg, seeds.productId, { batchNumber: "B-03" });

      const result = await pg.query(
        `SELECT COUNT(*) as cnt FROM "Lot" WHERE "productId" = $1`,
        [seeds.productId],
      );
      expect(Number((result.rows[0] as Record<string, unknown>).cnt)).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // InventoryMovement table
  // -----------------------------------------------------------------------
  describe("InventoryMovement table", () => {
    it("creates a POSITIVE_ADJUSTMENT movement linked to a lot", async () => {
      const lotId = await insertLot(pg, seeds.productId);

      const movementId = await insertMovement(pg, lotId, {
        movementType: "POSITIVE_ADJUSTMENT",
        quantity: 10,
        previousStock: 100,
        resultingStock: 110,
      });

      const result = await pg.query(
        `SELECT "movementType", quantity, "previousStock", "resultingStock",
                "lotId", "createdById"
         FROM "InventoryMovement" WHERE id = $1`,
        [movementId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(row.movementType).toBe("POSITIVE_ADJUSTMENT");
      expect(row.quantity).toBe(10);
      expect(row.previousStock).toBe(100);
      expect(row.resultingStock).toBe(110);
      expect(row.lotId).toBe(lotId);
    });

    it("creates a NEGATIVE_ADJUSTMENT movement", async () => {
      const lotId = await insertLot(pg, seeds.productId, { currentStock: 50 });

      const movementId = await insertMovement(pg, lotId, {
        movementType: "NEGATIVE_ADJUSTMENT",
        quantity: 5,
        previousStock: 50,
        resultingStock: 45,
      });

      const result = await pg.query(
        `SELECT "movementType" FROM "InventoryMovement" WHERE id = $1`,
        [movementId],
      );
      expect((result.rows[0] as Record<string, unknown>).movementType).toBe(
        "NEGATIVE_ADJUSTMENT",
      );
    });

    it("creates movements with other valid MovementType values", async () => {
      const lotId = await insertLot(pg, seeds.productId);

      const movementTypes = [
        "PURCHASE_RECEIPT",
        "SALE",
        "CLIENT_RETURN",
        "SUPPLIER_RETURN",
        "ADMIN_BLOCK",
        "ADMIN_UNBLOCK",
        "AUTO_EXPIRATION",
        "PHYSICAL_COUNT",
        "INITIAL_STOCK",
      ];

      for (const mt of movementTypes) {
        const mid = await insertMovement(pg, lotId, {
          movementType: mt,
          quantity: 1,
          previousStock: 100,
          resultingStock: mt === "PURCHASE_RECEIPT" ? 101 : 99,
        });

        const result = await pg.query(
          `SELECT "movementType" FROM "InventoryMovement" WHERE id = $1`,
          [mid],
        );
        expect((result.rows[0] as Record<string, unknown>).movementType).toBe(mt);
      }
    });

    it("enforces MovementType enum — rejects invalid values", async () => {
      const lotId = await insertLot(pg, seeds.productId);
      const movementId = crypto.randomUUID();
      const now = new Date().toISOString();

      await expect(
        pg.exec(`
          INSERT INTO "InventoryMovement" (id, "movementType", quantity,
            "previousStock", "resultingStock", "createdById", "createdAt", "lotId")
          VALUES ('${movementId}', 'BOGUS_MOVE'::"MovementType",
            1, 100, 101, 'user-inv-01', '${now}', '${lotId}');
        `),
      ).rejects.toThrow();
    });

    it("enforces foreign key to Lot", async () => {
      const fakeLotId = crypto.randomUUID();
      const movementId = crypto.randomUUID();
      const now = new Date().toISOString();

      await expect(
        pg.exec(`
          INSERT INTO "InventoryMovement" (id, "movementType", quantity,
            "previousStock", "resultingStock", "createdById", "createdAt", "lotId")
          VALUES ('${movementId}', 'POSITIVE_ADJUSTMENT'::"MovementType",
            1, 100, 101, 'user-inv-01', '${now}', '${fakeLotId}');
        `),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });

    it("records createdById and createdAt timestamps", async () => {
      const lotId = await insertLot(pg, seeds.productId);
      const movementId = crypto.randomUUID();

      await pg.exec(`
        INSERT INTO "InventoryMovement" (id, "movementType", quantity,
          "previousStock", "resultingStock", "createdById", "createdAt", "lotId")
        VALUES ('${movementId}', 'PHYSICAL_COUNT'::"MovementType",
          1, 100, 101, 'user-counter-02', NOW(), '${lotId}');
      `);

      const result = await pg.query(
        `SELECT "createdById", "createdAt" FROM "InventoryMovement" WHERE id = $1`,
        [movementId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(row.createdById).toBe("user-counter-02");
      // PGlite returns TIMESTAMP(3) values as Date objects; verify the
      // stored timestamp is valid (not NaN) and recent.
      const stored = row.createdAt;
      expect(stored).toBeInstanceOf(Date);
      expect(isNaN((stored as Date).getTime())).toBe(false);
      expect((stored as Date).getTime()).toBeGreaterThan(0);
    });

    it("stores optional reason text", async () => {
      const lotId = await insertLot(pg, seeds.productId);

      const movementId = await insertMovement(pg, lotId, {
        movementType: "NEGATIVE_ADJUSTMENT",
        reason: "Damaged packaging — markdown write-off",
      });

      const result = await pg.query(
        `SELECT reason FROM "InventoryMovement" WHERE id = $1`,
        [movementId],
      );
      expect((result.rows[0] as Record<string, unknown>).reason).toBe(
        "Damaged packaging — markdown write-off",
      );
    });

    it("allows null reason", async () => {
      const lotId = await insertLot(pg, seeds.productId);

      const movementId = await insertMovement(pg, lotId, { reason: null });

      const result = await pg.query(
        `SELECT reason FROM "InventoryMovement" WHERE id = $1`,
        [movementId],
      );
      expect((result.rows[0] as Record<string, unknown>).reason).toBeNull();
    });

    it("enforces NOT NULL on required columns", async () => {
      const movementId = crypto.randomUUID();

      await expect(
        pg.exec(`
          INSERT INTO "InventoryMovement" (id, "movementType", quantity,
            "previousStock", "resultingStock", "createdAt", "lotId")
          VALUES ('${movementId}', 'POSITIVE_ADJUSTMENT'::"MovementType",
            1, 100, 101, '${new Date().toISOString()}', '${crypto.randomUUID()}');
        `),
      ).rejects.toThrow(/null|null constraint/i);

      // createdById is required (NOT NULL) but was omitted above
    });

    it("stores integer quantity values correctly", async () => {
      const lotId = await insertLot(pg, seeds.productId);

      const mov1 = await insertMovement(pg, lotId, { quantity: 0 });
      const mov2 = await insertMovement(pg, lotId, { quantity: 9999 });

      const r1 = await pg.query(
        `SELECT quantity FROM "InventoryMovement" WHERE id = $1`,
        [mov1],
      );
      const r2 = await pg.query(
        `SELECT quantity FROM "InventoryMovement" WHERE id = $1`,
        [mov2],
      );
      expect((r1.rows[0] as Record<string, unknown>).quantity).toBe(0);
      expect((r2.rows[0] as Record<string, unknown>).quantity).toBe(9999);
    });
  });

  // -----------------------------------------------------------------------
  // Lot + InventoryMovement combined scenarios
  // -----------------------------------------------------------------------
  describe("Lot + InventoryMovement integration", () => {
    it("tracks stock deltas correctly across multiple movements", async () => {
      const lotId = await insertLot(pg, seeds.productId, {
        batchNumber: "B-TRACK",
        currentStock: 100,
        version: 1,
      });
      const now = new Date().toISOString();

      // Positive adjustment: +10
      const stockAfterPos = 110;
      const versionAfterPos = 2;
      await pg.exec(`
        UPDATE "Lot" SET "currentStock" = ${stockAfterPos},
          version = ${versionAfterPos},
          "updatedAt" = '${now}'
        WHERE id = '${lotId}' AND version = 1;
      `);
      await insertMovement(pg, lotId, {
        movementType: "POSITIVE_ADJUSTMENT",
        quantity: 10,
        previousStock: 100,
        resultingStock: stockAfterPos,
      });

      // Negative adjustment: -30
      const stockAfterNeg = 80;
      const versionAfterNeg = 3;
      await pg.exec(`
        UPDATE "Lot" SET "currentStock" = ${stockAfterNeg},
          version = ${versionAfterNeg},
          "updatedAt" = '${now}'
        WHERE id = '${lotId}' AND version = ${versionAfterPos};
      `);
      await insertMovement(pg, lotId, {
        movementType: "NEGATIVE_ADJUSTMENT",
        quantity: 30,
        previousStock: stockAfterPos,
        resultingStock: stockAfterNeg,
      });

      // Verify final stock
      const lot = (
        await pg.query(`SELECT "currentStock" FROM "Lot" WHERE id = $1`, [lotId])
      ).rows[0] as Record<string, unknown>;
      expect(lot.currentStock).toBe(80);

      // Verify two movements recorded
      const movements = await pg.query(
        `SELECT "movementType", quantity FROM "InventoryMovement"
         WHERE "lotId" = $1 ORDER BY "createdAt" ASC`,
        [lotId],
      );
      expect(movements.rows).toHaveLength(2);
      expect(
        (movements.rows[0] as Record<string, unknown>).movementType,
      ).toBe("POSITIVE_ADJUSTMENT");
      expect(
        (movements.rows[1] as Record<string, unknown>).movementType,
      ).toBe("NEGATIVE_ADJUSTMENT");
    });

    it("rejects deletion of a Lot that has InventoryMovement references", async () => {
      const lotId = await insertLot(pg, seeds.productId, { version: 1 });
      await insertMovement(pg, lotId);

      // ON DELETE RESTRICT on InventoryMovement.lotId → Lot
      await expect(
        pg.exec(`DELETE FROM "Lot" WHERE id = '${lotId}'`),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });
  });

  // -----------------------------------------------------------------------
  // SyncQueue — INVENTORY_ADJUSTMENT operation type
  // -----------------------------------------------------------------------
  describe("SyncQueue — INVENTORY_ADJUSTMENT", () => {
    it("enforces unique operationUuid (idempotency key)", async () => {
      const operationUuid = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.exec(`
        INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload,
          "payloadHash", "payloadSize", "sourceWorkstationId", "sourceCreatedAt",
          "clientSequence", status)
        VALUES ('${crypto.randomUUID()}', '${operationUuid}',
          'INVENTORY_ADJUSTMENT'::"SyncOperationType", '{}', 'abc', 2,
          'ws-001', '${now}', 1, 'PENDING');
      `);

      await expect(
        pg.exec(`
          INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload,
            "payloadHash", "payloadSize", "sourceWorkstationId", "sourceCreatedAt",
            "clientSequence", status)
          VALUES ('${crypto.randomUUID()}', '${operationUuid}',
            'INVENTORY_ADJUSTMENT'::"SyncOperationType", '{}', 'abc', 2,
            'ws-001', '${now}', 2, 'PENDING');
        `),
      ).rejects.toThrow();
    });

    it("stores and retrieves a full INVENTORY_ADJUSTMENT payload matching server expectations", async () => {
      const now = new Date().toISOString();
      const lotId = crypto.randomUUID();
      const payload = JSON.stringify({
        userId: "user-inv-01",
        createAdjustmentDto: {
          reason: "Physical count discrepancy — shelf A-12",
          notes: "Count found 90, system showed 100",
          items: [
            {
              lotId,
              movementType: "NEGATIVE_ADJUSTMENT",
              quantity: 10,
              reason: "Stock overage correction",
            },
          ],
        },
        metadata: {
          adjustmentId: crypto.randomUUID(),
          sequentialNumber: 42,
          workstationId: "ws-001",
          appliedAt: now,
        },
      });

      await pg.exec(`
        INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload,
          "payloadHash", "payloadSize", "sourceWorkstationId", "sourceCreatedAt",
          "clientSequence", status)
        VALUES ('${crypto.randomUUID()}', '${crypto.randomUUID()}',
          'INVENTORY_ADJUSTMENT'::"SyncOperationType",
          '${payload.replace(/'/g, "''")}', 'sha256hex', ${payload.length},
          'ws-001', '${now}', 1, 'PENDING');
      `);

      const result = await pg.query(
        `SELECT payload, "operationType" FROM "SyncQueue"
         WHERE "operationType" = 'INVENTORY_ADJUSTMENT'`,
      );
      const stored = JSON.parse(
        (result.rows[0] as Record<string, unknown>).payload as string,
      ) as Record<string, unknown>;

      // The server-side handler (handleInventoryAdjustment) reads these keys:
      //   payload.userId
      //   payload.createAdjustmentDto.reason
      //   payload.createAdjustmentDto.items[].lotId
      //   payload.createAdjustmentDto.items[].movementType
      //   payload.createAdjustmentDto.items[].quantity
      //   payload.metadata.adjustmentId
      expect(stored).toHaveProperty("userId", "user-inv-01");
      expect(stored).toHaveProperty("createAdjustmentDto");
      expect(stored).toHaveProperty("metadata");

      const dto = stored.createAdjustmentDto as Record<string, unknown>;
      expect(dto).toHaveProperty("reason");
      expect(dto).toHaveProperty("notes");
      expect(Array.isArray(dto.items)).toBe(true);
      expect((dto.items as Array<Record<string, unknown>>)[0]).toMatchObject({
        lotId,
        movementType: "NEGATIVE_ADJUSTMENT",
        quantity: 10,
      });

      const meta = stored.metadata as Record<string, unknown>;
      expect(meta).toHaveProperty("adjustmentId");
      expect(meta).toHaveProperty("sequentialNumber", 42);
    });

    it("stores multiple INVENTORY_ADJUSTMENT entries with different operationUuids", async () => {
      const now = new Date().toISOString();
      const uid1 = crypto.randomUUID();
      const uid2 = crypto.randomUUID();

      await pg.exec(`
        INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload,
          "payloadHash", "payloadSize", "sourceWorkstationId", "sourceCreatedAt",
          "clientSequence", status)
        VALUES ('${crypto.randomUUID()}', '${uid1}',
          'INVENTORY_ADJUSTMENT'::"SyncOperationType", '{}', 'a', 2,
          'ws-001', '${now}', 1, 'PENDING');
      `);
      await pg.exec(`
        INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload,
          "payloadHash", "payloadSize", "sourceWorkstationId", "sourceCreatedAt",
          "clientSequence", status)
        VALUES ('${crypto.randomUUID()}', '${uid2}',
          'INVENTORY_ADJUSTMENT'::"SyncOperationType", '{}', 'b', 2,
          'ws-001', '${now}', 2, 'PENDING');
      `);

      const count = await pg.query(
        `SELECT COUNT(*) as cnt FROM "SyncQueue"
         WHERE "operationType" = 'INVENTORY_ADJUSTMENT'`,
      );
      expect(Number((count.rows[0] as Record<string, unknown>).cnt)).toBe(2);
    });

    it("rejects invalid SyncOperationType values", async () => {
      const now = new Date().toISOString();

      await expect(
        pg.exec(`
          INSERT INTO "SyncQueue" (id, "operationUuid", "operationType", payload,
            "payloadHash", "payloadSize", "sourceWorkstationId", "sourceCreatedAt",
            "clientSequence", status)
          VALUES ('${crypto.randomUUID()}', '${crypto.randomUUID()}',
            'INVALID_TYPE'::"SyncOperationType", '{}', 'x', 2,
            'ws-001', '${now}', 1, 'PENDING');
        `),
      ).rejects.toThrow();
    });
  });

  // NOTE: Schema idempotency (re-applying LOCAL_SCHEMA_SQL) is intentionally
  // not tested here because the DDL uses CREATE TYPE/CREATE TABLE without
  // IF NOT EXISTS — re-application always fails with "already exists".  The
  // sales-pos PGlite test covers the same schema in a single application,
  // which is sufficient.  A future enhancement could use CREATE OR REPLACE
  // or IF NOT EXISTS patterns for true idempotency.
});
