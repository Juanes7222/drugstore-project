/**
 * Unit tests for startup health checking and integrity verification.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";

// Mock Tauri invoke before importing the module under test.
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const {
  getStartupHealth,
  acknowledgeCleanStartup,
  reportIntegrityFailure,
  runLocalDatabaseIntegrityCheck,
} = await import("./startup-health");
import type { StartupHealth } from "./startup-health";

// ---------------------------------------------------------------------------
// Tauri command wrappers
// ---------------------------------------------------------------------------

describe("getStartupHealth", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("calls invoke with the correct command name", async () => {
    mockInvoke.mockResolvedValue({
      status: "OK",
      message: "All systems nominal",
    });

    await getStartupHealth();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("get_startup_health");
  });

  it("returns the startup health object from Rust", async () => {
    const expected: StartupHealth = {
      status: "UNHEALTHY_SHUTDOWN",
      message: "Previous shutdown was not clean",
    };
    mockInvoke.mockResolvedValue(expected);

    const result = await getStartupHealth();

    expect(result).toEqual(expected);
  });
});

describe("acknowledgeCleanStartup", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("calls invoke with the correct command name", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await acknowledgeCleanStartup();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("acknowledge_clean_startup");
  });
});

describe("reportIntegrityFailure", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("calls invoke with the correct command name", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await reportIntegrityFailure();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("report_integrity_failure");
  });
});

// ---------------------------------------------------------------------------
// runLocalDatabaseIntegrityCheck
// ---------------------------------------------------------------------------

const createMockClient = (
  behaviour: Record<string, "ok" | "missing">,
): PGlite => {
  const query = vi.fn().mockImplementation(async (sql: string) => {
    // Extract the table name from the SQL: SELECT count(*) AS count FROM "X"
    const match = sql.match(/FROM "(\w+)"/);
    const tableName = match?.[1] ?? "Unknown";

    const expected = behaviour[tableName];
    if (expected === "missing") {
      throw new Error(`relation "${tableName}" does not exist`);
    }

    return { rows: [{ count: 5n }] };
  });

  return { query } as unknown as PGlite;
};

describe("runLocalDatabaseIntegrityCheck", () => {
  it("returns passed=true when all expected tables exist", async () => {
    const client = createMockClient({
      Client: "ok",
      CashShift: "ok",
      Sale: "ok",
      SaleItem: "ok",
      SaleItemLot: "ok",
      SyncQueue: "ok",
      SyncAttempt: "ok",
      SyncRecoveryLog: "ok",
      PaymentMethod: "ok",
      Product: "ok",
      ProductBarcode: "ok",
      Category: "ok",
      PharmaceuticalForm: "ok",
      Lot: "ok",
    });

    const report = await runLocalDatabaseIntegrityCheck(client);

    expect(report.passed).toBe(true);
    expect(report.missingTables).toHaveLength(0);
    expect(report.error).toBeUndefined();
  });

  it("returns passed=false with missingTables when one or more tables are absent", async () => {
    const client = createMockClient({
      Client: "ok",
      CashShift: "ok",
      Sale: "missing", // <-- this table is missing
      SaleItem: "ok",
      SaleItemLot: "ok",
      SyncQueue: "ok",
      SyncAttempt: "ok",
      SyncRecoveryLog: "ok",
      PaymentMethod: "ok",
      Product: "ok",
      ProductBarcode: "ok",
      Category: "ok",
      PharmaceuticalForm: "ok",
      Lot: "ok",
    });

    const report = await runLocalDatabaseIntegrityCheck(client);

    expect(report.passed).toBe(false);
    expect(report.missingTables).toContain("Sale");
    expect(report.actualCounts["Sale"]).toBe(0);
  });

  it("reports every table as missing when all queries fail", async () => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error("connection closed")),
    } as unknown as PGlite;

    const report = await runLocalDatabaseIntegrityCheck(client);

    expect(report.passed).toBe(false);
    // Each query failure is caught by the per-table catch block, so all
    // expected tables appear in missingTables.
    expect(report.missingTables.length).toBeGreaterThan(0);
    // Per-table errors do not propagate to the outer error field.
    expect(report.error).toBeUndefined();
  });

  it("reports correct actualCounts for existing tables", async () => {
    const client = createMockClient({
      Client: "ok",
      CashShift: "ok",
      Sale: "ok",
      SaleItem: "ok",
      SaleItemLot: "ok",
      SyncQueue: "ok",
      SyncAttempt: "ok",
      SyncRecoveryLog: "ok",
      PaymentMethod: "ok",
      Product: "ok",
      ProductBarcode: "ok",
      Category: "ok",
      PharmaceuticalForm: "ok",
      Lot: "ok",
    });

    const report = await runLocalDatabaseIntegrityCheck(client);

    expect(report.actualCounts["Client"]).toBe(5);
    expect(report.actualCounts["Sale"]).toBe(5);
  });
});
