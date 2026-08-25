/**
 * Unit tests for the devtools database-reset guard (`local-database-devtools`).
 *
 * `resetLocalDatabase` wipes the entire offline POS database; its data-loss
 * gate refuses to run while `SyncQueue` still holds operations the server
 * never confirmed (PENDING / PROCESSING / FAILED / PERMANENT_FAILURE),
 * unless `{ force: true }` is passed. Those rows are the terminal's only
 * copy of offline sales, shifts, and adjustments, so a bug here silently
 * destroys unrecoverable data.
 *
 * The functions under test only need `client.query(sql)` returning rows,
 * so they are exercised against a tiny fake PGlite client that dispatches
 * on the SQL text instead of spinning up a real WASM database, mirroring
 * the direct-export testing approach used in `local-database.test.ts`.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  collectResetSafetyReport,
  deletePgliteIndexedDbStores,
  resetLocalDatabase,
  type ResetDependencies,
} from "./local-database-devtools";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Rows returned for the grouped SyncQueue status query. */
type StatusRow = { status: string; count: number };

type FakeClientConfig = {
  /** Grouped SyncQueue rows; empty by default (no unsynced operations). */
  statusRows?: StatusRow[];
  /** When set, the SyncQueue query rejects (e.g. relation does not exist). */
  syncQueueError?: Error;
  /** User tables reported by the information_schema listing. */
  tableNames?: string[];
  /** Row count per table name; unlisted tables fall back to `fallbackCount`. */
  rowCountByTable?: Record<string, number>;
  /** Row count used for any table not present in `rowCountByTable` (default 0). */
  fallbackCount?: number;
};

type FakeClient = Pick<PGlite, "query"> & {
  /** Every SQL string passed to `query`, in call order. */
  queries: string[];
};

function createFakeClient(config: FakeClientConfig = {}): FakeClient {
  const queries: string[] = [];

  const query = vi.fn(
    async (sql: string): Promise<{ rows: Record<string, unknown>[] }> => {
      queries.push(sql);

      if (sql.includes('FROM "SyncQueue"') && sql.includes("GROUP BY status")) {
        if (config.syncQueueError) throw config.syncQueueError;
        return { rows: config.statusRows ?? [] };
      }
      if (sql.includes("information_schema.tables")) {
        return { rows: (config.tableNames ?? []).map((tableName) => ({ tableName })) };
      }
      if (sql.includes("COUNT(*)")) {
        const match = /FROM "([^"]+)"/.exec(sql);
        const tableName = match?.[1] ?? "";
        const count = config.rowCountByTable?.[tableName] ?? config.fallbackCount ?? 0;
        return { rows: [{ count }] };
      }

      throw new Error(`[fake-client] unexpected SQL: ${sql}`);
    },
  );

  return Object.assign({ query }, { queries }) as unknown as FakeClient;
}

/** Reset side-effect spies plus a shared log recording their call order. */
function createResetDependencies(overrides: {
  closeDatabase?: (callLog: string[]) => Promise<void>;
} = {}): { deps: ResetDependencies; callLog: string[] } {
  const callLog: string[] = [];

  const deps: ResetDependencies = {
    closeDatabase: vi.fn(async () => {
      if (overrides.closeDatabase) {
        await overrides.closeDatabase(callLog);
        return;
      }
      callLog.push("closeDatabase");
    }),
    deletePersistentStore: vi.fn(async () => {
      callLog.push("deletePersistentStore");
    }),
    reloadPage: vi.fn(() => {
      callLog.push("reloadPage");
    }),
  };

  return { deps, callLog };
}

// ---------------------------------------------------------------------------
// Fake indexedDB
// ---------------------------------------------------------------------------

/** Shape of one entry of the array `indexedDB.databases()` resolves with. */
type FakeDatabaseInfo = { name: string | null };

/** Minimal delete-request shape `deleteIndexedDbDatabase` attaches handlers to. */
type FakeDeleteRequest = {
  onsuccess?: () => void;
  onerror?: () => void;
  onblocked?: () => void;
};

/**
 * Install a fake `indexedDB` on globalThis via `vi.stubGlobal` (jsdom ships
 * no real IndexedDB; afterEach calls `vi.unstubAllGlobals()`).
 *
 * `databases()` returns one list per call from `databaseLists`; the LAST
 * list repeats for any further enumeration, which models how the code
 * under test re-scans after deleting. Omit `databaseLists` entirely to get
 * a fake with no `databases` property, exercising the enumeration-
 * unavailable fallback.
 *
 * `deleteDatabase` records its argument and settles through a queued
 * microtask because the code under test only assigns `onsuccess` after the
 * call has returned.
 */
function installFakeIndexedDb(
  databaseLists?: string[][],
): { deletedDatabases: string[] } {
  const deletedDatabases: string[] = [];

  const fake: {
    databases?: () => Promise<FakeDatabaseInfo[]>;
    deleteDatabase: (name: string) => FakeDeleteRequest;
  } = {
    deleteDatabase: vi.fn((name: string): FakeDeleteRequest => {
      deletedDatabases.push(name);
      const request: FakeDeleteRequest = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }),
  };

  if (databaseLists) {
    let callIndex = 0;
    fake.databases = vi.fn(async (): Promise<FakeDatabaseInfo[]> => {
      const names =
        databaseLists[Math.min(callIndex, databaseLists.length - 1)] ?? [];
      callIndex += 1;
      return names.map((name) => ({ name }));
    });
  }

  vi.stubGlobal("indexedDB", fake);

  return { deletedDatabases };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("collectResetSafetyReport", () => {
  it("aggregates unsynced sync-queue operations by status and sums them", async () => {
    const client = createFakeClient({
      statusRows: [
        { status: "PENDING", count: 3 },
        { status: "FAILED", count: 2 },
      ],
    });

    const report = await collectResetSafetyReport(client);

    expect(report.byStatus).toEqual({ PENDING: 3, FAILED: 2 });
    expect(report.unsyncedOperations).toBe(5);
  });

  it("computes totalRows as the sum over all listed tables and reports tableCount", async () => {
    const client = createFakeClient({
      tableNames: ["Product", "Sale"],
      rowCountByTable: { Product: 120, Sale: 45 },
    });

    const report = await collectResetSafetyReport(client);

    expect(report.totalRows).toBe(165);
    expect(report.tableCount).toBe(2);
  });

  it("treats a rejected SyncQueue query as zero unsynced work but still counts tables", async () => {
    const client = createFakeClient({
      syncQueueError: new Error('relation "SyncQueue" does not exist'),
      tableNames: ["Product", "Sale"],
      rowCountByTable: { Product: 7, Sale: 1 },
    });

    const report = await collectResetSafetyReport(client);

    expect(report.byStatus).toEqual({});
    expect(report.unsyncedOperations).toBe(0);
    expect(report.tableCount).toBe(2);
    expect(report.totalRows).toBe(8);
  });

  it("reports all zeros on an empty database with two tables", async () => {
    const client = createFakeClient({
      statusRows: [],
      tableNames: ["Product", "Sale"],
      fallbackCount: 0,
    });

    const report = await collectResetSafetyReport(client);

    expect(report.unsyncedOperations).toBe(0);
    expect(report.byStatus).toEqual({});
    expect(report.totalRows).toBe(0);
    expect(report.tableCount).toBe(2);
  });
});

describe("resetLocalDatabase", () => {
  it("rejects without force while unsynced operations exist and calls no dependency", async () => {
    const client = createFakeClient({
      statusRows: [{ status: "PENDING", count: 5 }],
    });
    const { deps, callLog } = createResetDependencies();

    await expect(resetLocalDatabase(client, undefined, deps)).rejects.toThrow(
      "[devtools] reset aborted — 5 sync operation(s)",
    );

    expect(deps.closeDatabase).not.toHaveBeenCalled();
    expect(deps.deletePersistentStore).not.toHaveBeenCalled();
    expect(deps.reloadPage).not.toHaveBeenCalled();
    expect(callLog).toEqual([]);
  });

  it("proceeds when forced despite unsynced operations, calling dependencies in order", async () => {
    const client = createFakeClient({
      statusRows: [
        { status: "PROCESSING", count: 1 },
        { status: "PERMANENT_FAILURE", count: 4 },
      ],
    });
    const { deps, callLog } = createResetDependencies();

    await expect(resetLocalDatabase(client, { force: true }, deps)).resolves.toBeUndefined();

    expect(deps.closeDatabase).toHaveBeenCalledTimes(1);
    expect(deps.deletePersistentStore).toHaveBeenCalledTimes(1);
    expect(deps.reloadPage).toHaveBeenCalledTimes(1);
    expect(callLog).toEqual(["closeDatabase", "deletePersistentStore", "reloadPage"]);
  });

  it("proceeds without force when nothing is unsynced, calling dependencies in order", async () => {
    const client = createFakeClient({
      statusRows: [],
      tableNames: ["Product", "Sale"],
    });
    const { deps, callLog } = createResetDependencies();

    await expect(resetLocalDatabase(client, undefined, deps)).resolves.toBeUndefined();

    expect(deps.closeDatabase).toHaveBeenCalledTimes(1);
    expect(deps.deletePersistentStore).toHaveBeenCalledTimes(1);
    expect(deps.reloadPage).toHaveBeenCalledTimes(1);
    expect(callLog).toEqual(["closeDatabase", "deletePersistentStore", "reloadPage"]);
  });

  it("propagates a closeDatabase failure without deleting the store or reloading", async () => {
    const client = createFakeClient({ statusRows: [] });
    const { deps, callLog } = createResetDependencies({
      closeDatabase: async () => {
        throw new Error("database is busy");
      },
    });

    await expect(resetLocalDatabase(client, undefined, deps)).rejects.toThrow(
      "database is busy",
    );

    expect(deps.deletePersistentStore).not.toHaveBeenCalled();
    expect(deps.reloadPage).not.toHaveBeenCalled();
    // Only the failed close was attempted; nothing after it ran.
    expect(callLog).toEqual([]);
  });
});

describe("deletePgliteIndexedDbStores", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    // The function console.logs every deleted database name.
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("deletes only pglite-matching databases when enumeration works", async () => {
    const { deletedDatabases } = installFakeIndexedDb([
      ["/pglite/pglite-data", "workstation-cache", "other-db"],
      ["workstation-cache", "other-db"],
    ]);

    await expect(deletePgliteIndexedDbStores()).resolves.toBeUndefined();

    expect(deletedDatabases).toEqual(["/pglite/pglite-data"]);
  });

  it("matches pglite databases case-insensitively", async () => {
    const { deletedDatabases } = installFakeIndexedDb([
      ["/PGlite/pglite-data"],
      [],
    ]);

    await expect(deletePgliteIndexedDbStores()).resolves.toBeUndefined();

    expect(deletedDatabases).toEqual(["/PGlite/pglite-data"]);
  });

  it("falls back to both known candidate names when databases() is unavailable", async () => {
    const { deletedDatabases } = installFakeIndexedDb();

    await expect(deletePgliteIndexedDbStores()).resolves.toBeUndefined();

    expect(deletedDatabases).toEqual(["/pglite/pglite-data", "pglite-data"]);
  });

  it("falls back to both known candidate names when databases() resolves empty", async () => {
    const { deletedDatabases } = installFakeIndexedDb([[], []]);

    await expect(deletePgliteIndexedDbStores()).resolves.toBeUndefined();

    expect(deletedDatabases).toEqual(["/pglite/pglite-data", "pglite-data"]);
  });

  it("throws when a pglite-named database still exists after deletion", async () => {
    const { deletedDatabases } = installFakeIndexedDb([
      ["/pglite/pglite-data"],
      ["/pglite/pglite-data"],
    ]);

    await expect(deletePgliteIndexedDbStores()).rejects.toThrow(/still contains/);

    expect(deletedDatabases).toEqual(["/pglite/pglite-data"]);
  });

  it("resolves without deleting anything when only unrelated databases exist", async () => {
    const { deletedDatabases } = installFakeIndexedDb([
      ["workstation-cache", "other-db"],
      ["workstation-cache", "other-db"],
    ]);

    await expect(deletePgliteIndexedDbStores()).resolves.toBeUndefined();

    expect(deletedDatabases).toEqual([]);
  });
});
