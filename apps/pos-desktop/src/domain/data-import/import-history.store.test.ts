/**
 * Unit tests for the localStorage-backed import-history store: round-trips,
 * the 50-entry cap, corrupted-JSON recovery, and replacement by import id.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { ImportHistoryEntry } from "./import.types";
import {
  getImportHistory,
  listImportHistory,
  recordImportHistory,
} from "./import-history.store";

const makeEntry = (
  overrides: Partial<ImportHistoryEntry> = {},
): ImportHistoryEntry => ({
  importId: `import-${Math.random().toString(36).slice(2)}`,
  entityKey: "products",
  entityLabel: "Products",
  fileName: "productos.csv",
  format: "CSV",
  totalRows: 10,
  validRows: 9,
  errorRows: 1,
  createdAt: new Date().toISOString(),
  createdByUserId: "user-1",
  errors: [],
  ...overrides,
});

describe("import-history.store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips recorded entries, most recent first", () => {
    const first = makeEntry();
    const second = makeEntry();

    recordImportHistory(first);
    recordImportHistory(second);

    const history = listImportHistory();
    expect(history.map((entry) => entry.importId)).toEqual([
      second.importId,
      first.importId,
    ]);
  });

  it("returns a single entry by import id", () => {
    const entry = makeEntry();
    recordImportHistory(entry);

    expect(getImportHistory(entry.importId)).toEqual(entry);
    expect(getImportHistory("missing")).toBeNull();
  });

  it("caps history at 50 entries", () => {
    for (let i = 0; i < 55; i += 1) {
      recordImportHistory(makeEntry({ importId: `import-${i}` }));
    }

    const history = listImportHistory();
    expect(history).toHaveLength(50);
    expect(history[0].importId).toBe("import-54");
    expect(history[49].importId).toBe("import-5");
  });

  it("replaces an existing entry with the same import id instead of duplicating", () => {
    const original = makeEntry({ importId: "import-same", validRows: 1 });
    recordImportHistory(original);
    const replacement = makeEntry({ importId: "import-same", validRows: 8 });
    recordImportHistory(replacement);

    const history = listImportHistory();
    expect(history).toHaveLength(1);
    expect(history[0].validRows).toBe(8);
  });

  it("returns an empty list when the stored JSON is corrupt", () => {
    localStorage.setItem("pos-desktop.import-history.v1", "{ not json");
    expect(listImportHistory()).toEqual([]);
  });

  it("returns an empty list when the stored value is not an array", () => {
    localStorage.setItem("pos-desktop.import-history.v1", '{"nope": true}');
    expect(listImportHistory()).toEqual([]);
  });
});
