/**
 * PGlite schema and data-layer integration tests for cash shifts.
 *
 * These tests create a real in-memory PGlite database, apply the full DDL
 * from LOCAL_SCHEMA_SQL, seed data, and then execute SQL queries directly
 * against PGlite.  This catches schema/constraint bugs a mocked PrismaClient
 * would miss for the cash-shift domain:
 *
 * - CashShift row creation and ShiftState enum enforcement
 * - OPEN → CLOSED / FORCED_CLOSE state transitions
 * - ShiftCashCount FK constraints (CashShift, PaymentMethod)
 * - CashCountType enum enforcement
 * - DenominationsBreakdown JSONB storage in ShiftCashCount
 * - Decimal column precision for amounts
 * - Index query by workstationId + state
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { LOCAL_SCHEMA_SQL } from "@pharmacy/database/local-schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedCashShiftDependencies(pg: PGlite): Promise<{
  userId: string;
  workstationId: string;
  paymentMethodId: string;
}> {
  const userId = "user-cashier-01";
  const workstationId = "ws-001";
  const now = new Date().toISOString();

  // Cash payment method
  const paymentMethodId = crypto.randomUUID();
  await pg.exec(`
    INSERT INTO "PaymentMethod" (id, "internalCode", "name", "category",
      "isActive", "isCash", "createdAt", "updatedAt")
    VALUES ('${paymentMethodId}', 'CASH01', 'Efectivo', 'CASH',
      true, true, '${now}', '${now}');
  `);

  return { userId, workstationId, paymentMethodId };
}

/**
 * Create an OPEN cash shift via SQL.
 * Returns the created shift id.
 */
async function insertOpenShift(
  pg: PGlite,
  seeds: { userId: string; workstationId: string },
  overrides?: {
    openingBalance?: string;
    openingNotes?: string | null;
  },
): Promise<string> {
  const shiftId = crypto.randomUUID();
  const now = new Date().toISOString();
  const openingBalance = overrides?.openingBalance ?? "500000.00";
  const openingNotes = overrides?.openingNotes ?? null;

  await pg.exec(`
    INSERT INTO "CashShift" (id, "workstationId", "userId", state,
      "openedAt", "createdAt", "updatedAt",
      "openingBalance", "openingNotes")
    VALUES ('${shiftId}', '${seeds.workstationId}', '${seeds.userId}',
      'OPEN'::"ShiftState", '${now}', '${now}', '${now}',
      ${openingBalance}, ${openingNotes === null ? "NULL" : `'${openingNotes.replace(/'/g, "''")}'`});
  `);

  return shiftId;
}

/**
 * Create a ShiftCashCount record via SQL.
 * Returns the count id.
 */
async function insertCashCount(
  pg: PGlite,
  shiftId: string,
  paymentMethodId: string,
  createdById: string,
  overrides?: {
    countType?: string;
    expectedAmount?: string;
    declaredAmount?: string;
    isCash?: boolean;
    denominationsBreakdown?: Record<string, number> | null;
  },
): Promise<string> {
  const countId = crypto.randomUUID();
  const countType = overrides?.countType ?? "PARTIAL";
  const expectedAmount = overrides?.expectedAmount ?? "500000.00";
  const declaredAmount = overrides?.declaredAmount ?? "500000.00";
  const difference = (
    Number(declaredAmount) - Number(expectedAmount)
  ).toFixed(2);
  const isCash = overrides?.isCash ?? true;
  const now = new Date().toISOString();
  const denominationsBreakdown = overrides?.denominationsBreakdown ?? null;

  await pg.exec(`
    INSERT INTO "ShiftCashCount" (id, "cashShiftId", "countType",
      "paymentMethodId", "paymentMethodIsCash",
      "expectedAmount", "declaredAmount", difference,
      "denominationsBreakdown", "createdAt", "createdById")
    VALUES ('${countId}', '${shiftId}', '${countType}'::"CashCountType",
      '${paymentMethodId}', ${isCash},
      ${expectedAmount}, ${declaredAmount}, ${difference},
      ${denominationsBreakdown === null ? "NULL" : `'${JSON.stringify(denominationsBreakdown)}'`},
      '${now}', '${createdById}');
  `);

  return countId;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Cash shift — PGlite data layer", () => {
  let pg: PGlite;
  let seeds: Awaited<ReturnType<typeof seedCashShiftDependencies>>;

  beforeEach(async () => {
    pg = new PGlite("memory://");
    await pg.exec(LOCAL_SCHEMA_SQL);
    seeds = await seedCashShiftDependencies(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  // -----------------------------------------------------------------------
  // CashShift table
  // -----------------------------------------------------------------------
  describe("CashShift table", () => {
    it("creates a cash shift with OPEN state", async () => {
      const shiftId = await insertOpenShift(pg, seeds);

      const result = await pg.query(
        `SELECT state, "openingBalance" FROM "CashShift" WHERE id = $1`,
        [shiftId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(row.state).toBe("OPEN");
      // DECIMAL values are returned as strings from PGlite
      expect(Number(row.openingBalance)).toBe(500000);
    });

    it("enforces ShiftState enum — rejects invalid state values", async () => {
      const now = new Date().toISOString();
      const shiftId = crypto.randomUUID();

      await expect(
        pg.exec(`
          INSERT INTO "CashShift" (id, "workstationId", "userId", state,
            "openedAt", "createdAt", "updatedAt")
          VALUES ('${shiftId}', '${seeds.workstationId}', '${seeds.userId}',
            'BAD_STATE'::"ShiftState", '${now}', '${now}', '${now}');
        `),
      ).rejects.toThrow();
    });

    it("transitions state from OPEN to CLOSED", async () => {
      const shiftId = await insertOpenShift(pg, seeds);
      const now = new Date().toISOString();

      await pg.exec(`
        UPDATE "CashShift" SET state = 'CLOSED'::"ShiftState",
          "closedAt" = '${now}',
          "closedByUserId" = '${seeds.userId}',
          "expectedClosingAmount" = 500000.00,
          "actualClosingAmount" = 500000.00,
          "closingDifference" = 0.00,
          "updatedAt" = '${now}'
        WHERE id = '${shiftId}';
      `);

      const result = await pg.query(
        `SELECT state, "closedAt", "closedByUserId" FROM "CashShift" WHERE id = $1`,
        [shiftId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(row.state).toBe("CLOSED");
      expect(row.closedByUserId).toBe(seeds.userId);
    });

    it("transitions state from OPEN to FORCED_CLOSE", async () => {
      const shiftId = await insertOpenShift(pg, seeds);
      const now = new Date().toISOString();

      await pg.exec(`
        UPDATE "CashShift" SET state = 'FORCED_CLOSE'::"ShiftState",
          "closedAt" = '${now}',
          "closedByUserId" = '${seeds.userId}',
          "expectedClosingAmount" = 0.00,
          "actualClosingAmount" = 0.00,
          "closingDifference" = 0.00,
          "forcedClose" = true,
          "closingNotes" = 'System crash — forced close',
          "updatedAt" = '${now}'
        WHERE id = '${shiftId}';
      `);

      const result = await pg.query(
        `SELECT state, "forcedClose", "closingNotes" FROM "CashShift" WHERE id = $1`,
        [shiftId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(row.state).toBe("FORCED_CLOSE");
      expect(row.forcedClose).toBe(true);
      expect(row.closingNotes).toMatch(/forced close/i);
    });

    it("rejects transition to an invalid state value", async () => {
      const shiftId = await insertOpenShift(pg, seeds);

      await expect(
        pg.exec(`
          UPDATE "CashShift" SET state = 'BOGUS'::"ShiftState"
          WHERE id = '${shiftId}';
        `),
      ).rejects.toThrow();
    });

    it("stores Decimal amounts with correct precision", async () => {
      const shiftId = await insertOpenShift(pg, seeds, {
        openingBalance: "1234567.89",
      });

      const result = await pg.query(
        `SELECT "openingBalance" FROM "CashShift" WHERE id = $1`,
        [shiftId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      // DECIMAL(15,2) — PGlite returns as string
      expect(Number(row.openingBalance)).toBe(1234567.89);
    });

    it("stores and retrieves all closing fields after transition to CLOSED", async () => {
      const shiftId = await insertOpenShift(pg, seeds);
      const now = new Date().toISOString();

      await pg.exec(`
        UPDATE "CashShift" SET state = 'CLOSED'::"ShiftState",
          "closedAt" = '${now}',
          "closedByUserId" = 'user-manager-01',
          "openingBalance" = 500000.00,
          "expectedClosingAmount" = 650000.00,
          "actualClosingAmount" = 650500.00,
          "closingDifference" = 500.00,
          "closingNotes" = 'Cash excess of $500',
          "updatedAt" = '${now}'
        WHERE id = '${shiftId}';
      `);

      const result = await pg.query(
        `SELECT "openingBalance", "expectedClosingAmount",
                "actualClosingAmount", "closingDifference",
                "closingNotes", "closedByUserId"
         FROM "CashShift" WHERE id = $1`,
        [shiftId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(Number(row.openingBalance)).toBe(500000);
      expect(Number(row.expectedClosingAmount)).toBe(650000);
      expect(Number(row.actualClosingAmount)).toBe(650500);
      expect(Number(row.closingDifference)).toBe(500);
      expect(row.closingNotes).toBe("Cash excess of $500");
      expect(row.closedByUserId).toBe("user-manager-01");
    });

    it("supports multiple shifts for different workstations", async () => {
      const shift1 = await insertOpenShift(pg, seeds, {
        openingBalance: "100000.00",
      });

      // Second shift for same workstation — allowed at DB level
      // (business rule of "only one open shift" is app-enforced)
      const shift2Id = crypto.randomUUID();
      const now = new Date().toISOString();
      await pg.exec(`
        INSERT INTO "CashShift" (id, "workstationId", "userId", state,
          "openedAt", "createdAt", "updatedAt", "openingBalance")
        VALUES ('${shift2Id}', '${seeds.workstationId}', '${seeds.userId}',
          'OPEN'::"ShiftState", '${now}', '${now}', '${now}', 200000.00);
      `);

      const count = await pg.query(
        `SELECT COUNT(*) as cnt FROM "CashShift" WHERE "workstationId" = $1`,
        [seeds.workstationId],
      );
      expect(Number((count.rows[0] as Record<string, unknown>).cnt)).toBe(2);
    });

    it("queries by workstationId and state using the composite index", async () => {
      const shiftId = await insertOpenShift(pg, seeds);
      const now = new Date().toISOString();

      // Closed shift for same workstation
      const closedId = crypto.randomUUID();
      await pg.exec(`
        INSERT INTO "CashShift" (id, "workstationId", "userId", state,
          "openedAt", "closedAt", "createdAt", "updatedAt")
        VALUES ('${closedId}', '${seeds.workstationId}', '${seeds.userId}',
          'CLOSED'::"ShiftState", '${now}', '${now}', '${now}', '${now}');
      `);

      // Query by the indexed column pair
      const openShifts = await pg.query(
        `SELECT id, state FROM "CashShift"
         WHERE "workstationId" = $1 AND state = 'OPEN'`,
        [seeds.workstationId],
      );
      expect(openShifts.rows).toHaveLength(1);
      expect((openShifts.rows[0] as Record<string, unknown>).id).toBe(shiftId);
    });

    it("stores hasExtendedAlert and forcedClose boolean defaults", async () => {
      const shiftId = await insertOpenShift(pg, seeds);

      const result = await pg.query(
        `SELECT "forcedClose", "hasExtendedAlert" FROM "CashShift" WHERE id = $1`,
        [shiftId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(row.forcedClose).toBe(false);
      expect(row.hasExtendedAlert).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // ShiftCashCount table
  // -----------------------------------------------------------------------
  describe("ShiftCashCount table", () => {
    it("creates a PARTIAL cash count linked to a shift", async () => {
      const shiftId = await insertOpenShift(pg, seeds);

      const countId = await insertCashCount(pg, shiftId, seeds.paymentMethodId, seeds.userId, {
        countType: "PARTIAL",
        expectedAmount: "500000.00",
        declaredAmount: "500000.00",
      });

      const result = await pg.query(
        `SELECT "countType", "expectedAmount", "declaredAmount", difference,
                "paymentMethodId", "createdById"
         FROM "ShiftCashCount" WHERE id = $1`,
        [countId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(row.countType).toBe("PARTIAL");
      expect(Number(row.expectedAmount)).toBe(500000);
      expect(Number(row.declaredAmount)).toBe(500000);
      expect(Number(row.difference)).toBe(0);
      expect(row.paymentMethodId).toBe(seeds.paymentMethodId);
    });

    it("creates a CLOSING cash count", async () => {
      const shiftId = await insertOpenShift(pg, seeds);

      const countId = await insertCashCount(pg, shiftId, seeds.paymentMethodId, seeds.userId, {
        countType: "CLOSING",
        expectedAmount: "500000.00",
        declaredAmount: "502000.00",
      });

      const result = await pg.query(
        `SELECT "countType", difference FROM "ShiftCashCount" WHERE id = $1`,
        [countId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(row.countType).toBe("CLOSING");
      // difference = declared - expected = 502000 - 500000 = 2000
      expect(Number(row.difference)).toBe(2000);
    });

    it("enforces CashCountType enum — rejects invalid values", async () => {
      const shiftId = await insertOpenShift(pg, seeds);
      const countId = crypto.randomUUID();
      const now = new Date().toISOString();

      await expect(
        pg.exec(`
          INSERT INTO "ShiftCashCount" (id, "cashShiftId", "countType",
            "paymentMethodId", "paymentMethodIsCash",
            "expectedAmount", "declaredAmount", difference,
            "createdAt", "createdById")
          VALUES ('${countId}', '${shiftId}', 'BAD_TYPE'::"CashCountType",
            '${seeds.paymentMethodId}', true,
            100.00, 100.00, 0.00, '${now}', '${seeds.userId}');
        `),
      ).rejects.toThrow();
    });

    it("enforces foreign key to CashShift", async () => {
      const fakeShiftId = crypto.randomUUID();
      const countId = crypto.randomUUID();
      const now = new Date().toISOString();

      await expect(
        pg.exec(`
          INSERT INTO "ShiftCashCount" (id, "cashShiftId", "countType",
            "paymentMethodId", "paymentMethodIsCash",
            "expectedAmount", "declaredAmount", difference,
            "createdAt", "createdById")
          VALUES ('${countId}', '${fakeShiftId}', 'PARTIAL'::"CashCountType",
            '${seeds.paymentMethodId}', true,
            100.00, 100.00, 0.00, '${now}', '${seeds.userId}');
        `),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });

    it("enforces foreign key to PaymentMethod", async () => {
      const shiftId = await insertOpenShift(pg, seeds);
      const fakePmId = crypto.randomUUID();
      const countId = crypto.randomUUID();
      const now = new Date().toISOString();

      await expect(
        pg.exec(`
          INSERT INTO "ShiftCashCount" (id, "cashShiftId", "countType",
            "paymentMethodId", "paymentMethodIsCash",
            "expectedAmount", "declaredAmount", difference,
            "createdAt", "createdById")
          VALUES ('${countId}', '${shiftId}', 'PARTIAL'::"CashCountType",
            '${fakePmId}', true,
            100.00, 100.00, 0.00, '${now}', '${seeds.userId}');
        `),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });

    it("stores denominationsBreakdown as JSONB for cash payment methods", async () => {
      const shiftId = await insertOpenShift(pg, seeds);
      const denominations = {
        "50000": 5,
        "20000": 10,
        "10000": 15,
        "5000": 20,
        "1000": 30,
        "500": 10,
        "200": 25,
        "100": 50,
        "50": 20,
      };

      const countId = await insertCashCount(pg, shiftId, seeds.paymentMethodId, seeds.userId, {
        countType: "PARTIAL",
        expectedAmount: "500000.00",
        declaredAmount: "502000.00",
        denominationsBreakdown: denominations,
      });

      const result = await pg.query(
        `SELECT "denominationsBreakdown" FROM "ShiftCashCount" WHERE id = $1`,
        [countId],
      );
      // PGlite returns JSONB columns as pre-parsed objects, not strings
      const stored = (result.rows[0] as Record<string, unknown>)
        .denominationsBreakdown as Record<string, number>;

      expect(stored).toMatchObject(denominations);
      expect(stored["50000"]).toBe(5);
      expect(stored["1000"]).toBe(30);
    });

    it("stores null denominationsBreakdown for non-cash payment methods", async () => {
      // Add a non-cash payment method
      const now = new Date().toISOString();
      const cardPmId = crypto.randomUUID();
      await pg.exec(`
        INSERT INTO "PaymentMethod" (id, "internalCode", "name", "category",
          "isActive", "isCash", "createdAt", "updatedAt")
        VALUES ('${cardPmId}', 'DEBIT01', 'Tarjeta Débito', 'DEBIT_CARD',
          true, false, '${now}', '${now}');
      `);

      const shiftId = await insertOpenShift(pg, seeds);

      const countId = await insertCashCount(pg, shiftId, cardPmId, seeds.userId, {
        countType: "PARTIAL",
        expectedAmount: "100000.00",
        declaredAmount: "100000.00",
        isCash: false,
        denominationsBreakdown: null,
      });

      const result = await pg.query(
        `SELECT "denominationsBreakdown" FROM "ShiftCashCount" WHERE id = $1`,
        [countId],
      );
      expect(
        (result.rows[0] as Record<string, unknown>).denominationsBreakdown,
      ).toBeNull();
    });

    it("stores Decimal amounts with correct precision", async () => {
      const shiftId = await insertOpenShift(pg, seeds);

      const countId = await insertCashCount(pg, shiftId, seeds.paymentMethodId, seeds.userId, {
        countType: "PARTIAL",
        expectedAmount: "1234.56",
        declaredAmount: "1234.57",
      });

      const result = await pg.query(
        `SELECT "expectedAmount", "declaredAmount", difference
         FROM "ShiftCashCount" WHERE id = $1`,
        [countId],
      );
      const row = result.rows[0] as Record<string, unknown>;
      expect(Number(row.expectedAmount)).toBe(1234.56);
      expect(Number(row.declaredAmount)).toBe(1234.57);
      expect(Number(row.difference)).toBe(0.01);
    });

    it("supports multiple cash counts for the same shift", async () => {
      const shiftId = await insertOpenShift(pg, seeds);

      // Add another payment method
      const now = new Date().toISOString();
      const cardPmId = crypto.randomUUID();
      await pg.exec(`
        INSERT INTO "PaymentMethod" (id, "internalCode", "name", "category",
          "isActive", "isCash", "createdAt", "updatedAt")
        VALUES ('${cardPmId}', 'DEBIT02', 'Tarjeta Débito', 'DEBIT_CARD',
          true, false, '${now}', '${now}');
      `);

      await insertCashCount(pg, shiftId, seeds.paymentMethodId, seeds.userId, {
        countType: "CLOSING",
        expectedAmount: "500000.00",
        declaredAmount: "502000.00",
      });
      await insertCashCount(pg, shiftId, cardPmId, seeds.userId, {
        countType: "CLOSING",
        expectedAmount: "150000.00",
        declaredAmount: "150000.00",
        isCash: false,
      });

      const result = await pg.query(
        `SELECT COUNT(*) as cnt FROM "ShiftCashCount"
         WHERE "cashShiftId" = $1`,
        [shiftId],
      );
      expect(Number((result.rows[0] as Record<string, unknown>).cnt)).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // CashShift + ShiftCashCount integration
  // -----------------------------------------------------------------------
  describe("CashShift + ShiftCashCount integration", () => {
    it("queries cash counts for a specific shift", async () => {
      const shiftId = await insertOpenShift(pg, seeds);

      const count1Id = await insertCashCount(pg, shiftId, seeds.paymentMethodId, seeds.userId, {
        countType: "PARTIAL",
        expectedAmount: "500000.00",
        declaredAmount: "500000.00",
      });
      const count2Id = await insertCashCount(pg, shiftId, seeds.paymentMethodId, seeds.userId, {
        countType: "CLOSING",
        expectedAmount: "500000.00",
        declaredAmount: "502000.00",
      });

      const counts = await pg.query(
        `SELECT id, "countType" FROM "ShiftCashCount"
         WHERE "cashShiftId" = $1 ORDER BY "createdAt" ASC`,
        [shiftId],
      );
      expect(counts.rows).toHaveLength(2);
      expect((counts.rows[0] as Record<string, unknown>).id).toBe(count1Id);
      expect((counts.rows[1] as Record<string, unknown>).id).toBe(count2Id);
    });

    it("rejects deletion of a CashShift referenced by ShiftCashCount (RESTRICT)", async () => {
      const shiftId = await insertOpenShift(pg, seeds);
      await insertCashCount(pg, shiftId, seeds.paymentMethodId, seeds.userId);

      await expect(
        pg.exec(`DELETE FROM "CashShift" WHERE id = '${shiftId}'`),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });

    it("rejects deletion of a PaymentMethod referenced by ShiftCashCount (RESTRICT)", async () => {
      const shiftId = await insertOpenShift(pg, seeds);
      await insertCashCount(pg, shiftId, seeds.paymentMethodId, seeds.userId);

      await expect(
        pg.exec(`DELETE FROM "PaymentMethod" WHERE id = '${seeds.paymentMethodId}'`),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });

    it("queries by the indexed cashShiftId + countType column pair", async () => {
      const shiftId = await insertOpenShift(pg, seeds);

      // Add second payment method
      const now = new Date().toISOString();
      const cardPmId = crypto.randomUUID();
      await pg.exec(`
        INSERT INTO "PaymentMethod" (id, "internalCode", "name", "category",
          "isActive", "isCash", "createdAt", "updatedAt")
        VALUES ('${cardPmId}', 'DEBIT03', 'Tarjeta Débito', 'DEBIT_CARD',
          true, false, '${now}', '${now}');
      `);

      await insertCashCount(pg, shiftId, seeds.paymentMethodId, seeds.userId, {
        countType: "CLOSING",
        expectedAmount: "500000.00",
        declaredAmount: "502000.00",
      });
      await insertCashCount(pg, shiftId, cardPmId, seeds.userId, {
        countType: "CLOSING",
        expectedAmount: "150000.00",
        declaredAmount: "150000.00",
        isCash: false,
      });
      // Non-closing count should not appear in CLOSING query
      await insertCashCount(pg, shiftId, seeds.paymentMethodId, seeds.userId, {
        countType: "PARTIAL",
        expectedAmount: "500000.00",
        declaredAmount: "500000.00",
      });

      const closingCounts = await pg.query(
        `SELECT COUNT(*) as cnt FROM "ShiftCashCount"
         WHERE "cashShiftId" = $1 AND "countType" = 'CLOSING'`,
        [shiftId],
      );
      expect(Number((closingCounts.rows[0] as Record<string, unknown>).cnt)).toBe(2);
    });
  });
});
