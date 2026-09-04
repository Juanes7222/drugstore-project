/**
 * Tests for the sync-metadata localStorage helpers.
 *
 * Each test clears localStorage before running so state never leaks
 * between cases. The record key is scoped to the local database's
 * install id (`getLocalDatabaseInstallId`); that dependency is mocked
 * so every test controls which database "owns" the cursors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCatalogLastSyncedAt,
  getClassificationsLastSyncedAt,
  getClientsLastSyncedAt,
  getLotsLastSyncedAt,
  getPurchaseOrdersLastSyncedAt,
  getPurchaseReceptionsLastSyncedAt,
  getSalesLastSyncedAt,
  getSupplierReturnsLastSyncedAt,
  getSuppliersLastSyncedAt,
  getUsersLastSyncedAt,
  readSyncMetadata,
  setCatalogLastSyncedAt,
  setClassificationsLastSyncedAt,
  setClientsLastSyncedAt,
  setLotsLastSyncedAt,
  setPurchaseOrdersLastSyncedAt,
  setPurchaseReceptionsLastSyncedAt,
  setSalesLastSyncedAt,
  setSupplierReturnsLastSyncedAt,
  setSuppliersLastSyncedAt,
  setUsersLastSyncedAt,
} from "./sync-metadata";

const installIdRef = vi.hoisted(() => ({ current: null as string | null }));

vi.mock("../infrastructure/local-database", () => ({
  getLocalDatabaseInstallId: () => installIdRef.current,
}));

const STORAGE_KEY = "pharmacy_sync_metadata";
const UNINITIALIZED_SUFFIX = "uninitialized";

/** Build the exact storage key the production code derives for an install id. */
const scopedStorageKey = (installId: string | null): string =>
  `${STORAGE_KEY}__${installId ?? UNINITIALIZED_SUFFIX}`;

describe("sync-metadata", () => {
  beforeEach(() => {
    localStorage.clear();
    installIdRef.current = null;
  });

  afterEach(() => {
    localStorage.clear();
    installIdRef.current = null;
  });

  describe("readSyncMetadata", () => {
    it("returns defaults when localStorage is empty", () => {
      const meta = readSyncMetadata();

      expect(meta).toEqual({
        catalogLastSyncedAt: null,
        lotsLastSyncedAt: null,
        clientsLastSyncedAt: null,
        classificationsLastSyncedAt: null,
        suppliersLastSyncedAt: null,
        purchaseOrdersLastSyncedAt: null,
        purchaseReceptionsLastSyncedAt: null,
        supplierReturnsLastSyncedAt: null,
        salesLastSyncedAt: null,
        invoicesLastSyncedAt: null,
        invoiceAdjustmentsLastSyncedAt: null,
        usersLastSyncedAt: null,
      });
    });

    it("returns defaults when stored JSON is malformed", () => {
      installIdRef.current = "install-A";
      localStorage.setItem(scopedStorageKey("install-A"), "not-json");

      const meta = readSyncMetadata();

      expect(meta).toEqual({
        catalogLastSyncedAt: null,
        lotsLastSyncedAt: null,
        clientsLastSyncedAt: null,
        classificationsLastSyncedAt: null,
        suppliersLastSyncedAt: null,
        purchaseOrdersLastSyncedAt: null,
        purchaseReceptionsLastSyncedAt: null,
        supplierReturnsLastSyncedAt: null,
        salesLastSyncedAt: null,
        invoicesLastSyncedAt: null,
        invoiceAdjustmentsLastSyncedAt: null,
        usersLastSyncedAt: null,
      });
    });

    it("returns defaults when localStorage is undefined", () => {
      const originalLocalStorage = (globalThis as any).localStorage;
      delete (globalThis as any).localStorage;
      try {
        const meta = readSyncMetadata();

        expect(meta).toEqual({
          catalogLastSyncedAt: null,
          lotsLastSyncedAt: null,
          clientsLastSyncedAt: null,
          classificationsLastSyncedAt: null,
          suppliersLastSyncedAt: null,
          purchaseOrdersLastSyncedAt: null,
          purchaseReceptionsLastSyncedAt: null,
          supplierReturnsLastSyncedAt: null,
          salesLastSyncedAt: null,
          invoicesLastSyncedAt: null,
          invoiceAdjustmentsLastSyncedAt: null,
          usersLastSyncedAt: null,
        });
      } finally {
        (globalThis as any).localStorage = originalLocalStorage;
      }
    });

    it("ignores a legacy record stored under the unscoped key", () => {
      // Regression guard: cursors from before install-id scoping must not
      // migrate into a fresh database's namespace.
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          catalogLastSyncedAt: "2026-01-01T00:00:00Z",
          lotsLastSyncedAt: "2026-01-02T00:00:00Z",
          clientsLastSyncedAt: "2026-01-03T00:00:00Z",
          classificationsLastSyncedAt: "2026-01-04T00:00:00Z",
        }),
      );
      installIdRef.current = "install-A";

      const meta = readSyncMetadata();

      expect(meta).toEqual({
        catalogLastSyncedAt: null,
        lotsLastSyncedAt: null,
        clientsLastSyncedAt: null,
        classificationsLastSyncedAt: null,
        suppliersLastSyncedAt: null,
        purchaseOrdersLastSyncedAt: null,
        purchaseReceptionsLastSyncedAt: null,
        supplierReturnsLastSyncedAt: null,
        salesLastSyncedAt: null,
        invoicesLastSyncedAt: null,
        invoiceAdjustmentsLastSyncedAt: null,
        usersLastSyncedAt: null,
      });
    });
  });

  describe("install-id scoping", () => {
    it("round-trips a value while the install id is unchanged", () => {
      installIdRef.current = "install-A";

      setCatalogLastSyncedAt("2026-07-09T00:00:00Z");

      expect(getCatalogLastSyncedAt()).toBe("2026-07-09T00:00:00Z");
    });

    it("returns null when the record was written under another install id", () => {
      installIdRef.current = "install-A";
      setCatalogLastSyncedAt("2026-07-09T00:00:00Z");

      installIdRef.current = "install-B";

      expect(getCatalogLastSyncedAt()).toBeNull();
    });

    it("restores the original value when switching back to its install id", () => {
      installIdRef.current = "install-A";
      setCatalogLastSyncedAt("2026-07-09T00:00:00Z");

      installIdRef.current = "install-B";
      expect(getCatalogLastSyncedAt()).toBeNull();

      installIdRef.current = "install-A";
      expect(getCatalogLastSyncedAt()).toBe("2026-07-09T00:00:00Z");
    });

    it("uses the 'uninitialized' bucket while the install id is null", () => {
      installIdRef.current = null;

      setLotsLastSyncedAt("2026-07-08T12:00:00Z");
      expect(getLotsLastSyncedAt()).toBe("2026-07-08T12:00:00Z");

      installIdRef.current = "install-A";
      expect(getLotsLastSyncedAt()).toBeNull();
    });

    it("writes each install id to its own physical localStorage record", () => {
      installIdRef.current = "install-A";
      setCatalogLastSyncedAt("2026-07-09T00:00:00Z");

      expect(localStorage.getItem(scopedStorageKey("install-A"))).toContain(
        "2026-07-09T00:00:00Z",
      );
      expect(
        localStorage.getItem(scopedStorageKey("install-B")),
      ).toBeNull();
    });
  });

  describe("getCatalogLastSyncedAt", () => {
    it("returns null when no sync has been performed", () => {
      expect(getCatalogLastSyncedAt()).toBeNull();
    });
  });

  describe("setCatalogLastSyncedAt + getCatalogLastSyncedAt", () => {
    it("does not throw when localStorage is undefined", () => {
      const originalLocalStorage = (globalThis as any).localStorage;
      delete (globalThis as any).localStorage;
      try {
        expect(() => {
          setCatalogLastSyncedAt("2026-07-10T12:00:00Z");
        }).not.toThrow();
      } finally {
        (globalThis as any).localStorage = originalLocalStorage;
      }
    });

    it("persists and retrieves a timestamp", () => {
      setCatalogLastSyncedAt("2026-07-09T00:00:00Z");

      expect(getCatalogLastSyncedAt()).toBe("2026-07-09T00:00:00Z");
    });

    it("overwrites a previously stored value", () => {
      setCatalogLastSyncedAt("2026-07-01T00:00:00Z");
      setCatalogLastSyncedAt("2026-07-09T00:00:00Z");

      expect(getCatalogLastSyncedAt()).toBe("2026-07-09T00:00:00Z");
    });

    it("returns the same value across consecutive reads", () => {
      setCatalogLastSyncedAt("2026-07-09T00:00:00Z");

      expect(getCatalogLastSyncedAt()).toBe("2026-07-09T00:00:00Z");
      expect(getCatalogLastSyncedAt()).toBe("2026-07-09T00:00:00Z");
    });
  });

  describe("getLotsLastSyncedAt", () => {
    it("returns null when no sync has been performed", () => {
      expect(getLotsLastSyncedAt()).toBeNull();
    });
  });

  describe("setLotsLastSyncedAt + getLotsLastSyncedAt", () => {
    it("persists and retrieves a timestamp", () => {
      setLotsLastSyncedAt("2026-07-08T12:00:00Z");

      expect(getLotsLastSyncedAt()).toBe("2026-07-08T12:00:00Z");
    });
  });

  describe("getClientsLastSyncedAt", () => {
    it("returns null when no sync has been performed", () => {
      expect(getClientsLastSyncedAt()).toBeNull();
    });
  });

  describe("setClientsLastSyncedAt + getClientsLastSyncedAt", () => {
    it("persists and retrieves a timestamp", () => {
      setClientsLastSyncedAt("2026-07-07T08:30:00Z");

      expect(getClientsLastSyncedAt()).toBe("2026-07-07T08:30:00Z");
    });
  });

  describe("getClassificationsLastSyncedAt", () => {
    it("returns null when no sync has been performed", () => {
      expect(getClassificationsLastSyncedAt()).toBeNull();
    });
  });

  describe("setClassificationsLastSyncedAt + getClassificationsLastSyncedAt", () => {
    it("persists and retrieves a timestamp", () => {
      setClassificationsLastSyncedAt("2026-07-06T10:15:00Z");

      expect(getClassificationsLastSyncedAt()).toBe("2026-07-06T10:15:00Z");
    });
  });

  describe("multiple independent timestamps", () => {
    it("stores and retrieves each field without interference", () => {
      setCatalogLastSyncedAt("2026-07-09T00:00:00Z");
      setLotsLastSyncedAt("2026-07-08T12:00:00Z");
      setClientsLastSyncedAt("2026-07-07T08:30:00Z");
      setClassificationsLastSyncedAt("2026-07-06T10:15:00Z");

      expect(getCatalogLastSyncedAt()).toBe("2026-07-09T00:00:00Z");
      expect(getLotsLastSyncedAt()).toBe("2026-07-08T12:00:00Z");
      expect(getClientsLastSyncedAt()).toBe("2026-07-07T08:30:00Z");
      expect(getClassificationsLastSyncedAt()).toBe("2026-07-06T10:15:00Z");
    });
  });

  describe("getSuppliersLastSyncedAt", () => {
    it("returns null when no sync has been performed", () => {
      expect(getSuppliersLastSyncedAt()).toBeNull();
    });
  });

  describe("setSuppliersLastSyncedAt + getSuppliersLastSyncedAt", () => {
    it("persists and retrieves a timestamp", () => {
      setSuppliersLastSyncedAt("2026-07-05T09:00:00Z");

      expect(getSuppliersLastSyncedAt()).toBe("2026-07-05T09:00:00Z");
    });

    it("is scoped by installId", () => {
      installIdRef.current = "install-A";
      setSuppliersLastSyncedAt("2026-07-05T09:00:00Z");

      installIdRef.current = "install-B";
      expect(getSuppliersLastSyncedAt()).toBeNull();

      installIdRef.current = "install-A";
      expect(getSuppliersLastSyncedAt()).toBe("2026-07-05T09:00:00Z");
    });
  });

  describe("getPurchaseOrdersLastSyncedAt", () => {
    it("returns null when no sync has been performed", () => {
      expect(getPurchaseOrdersLastSyncedAt()).toBeNull();
    });
  });

  describe("setPurchaseOrdersLastSyncedAt + getPurchaseOrdersLastSyncedAt", () => {
    it("persists and retrieves a timestamp", () => {
      setPurchaseOrdersLastSyncedAt("2026-07-04T10:00:00Z");

      expect(getPurchaseOrdersLastSyncedAt()).toBe("2026-07-04T10:00:00Z");
    });

    it("is scoped by installId", () => {
      installIdRef.current = "install-A";
      setPurchaseOrdersLastSyncedAt("2026-07-04T10:00:00Z");

      installIdRef.current = "install-B";
      expect(getPurchaseOrdersLastSyncedAt()).toBeNull();
    });
  });

  describe("getPurchaseReceptionsLastSyncedAt", () => {
    it("returns null when no sync has been performed", () => {
      expect(getPurchaseReceptionsLastSyncedAt()).toBeNull();
    });
  });

  describe("setPurchaseReceptionsLastSyncedAt + getPurchaseReceptionsLastSyncedAt", () => {
    it("persists and retrieves a timestamp", () => {
      setPurchaseReceptionsLastSyncedAt("2026-07-03T11:00:00Z");

      expect(getPurchaseReceptionsLastSyncedAt()).toBe("2026-07-03T11:00:00Z");
    });

    it("is scoped by installId", () => {
      installIdRef.current = "install-A";
      setPurchaseReceptionsLastSyncedAt("2026-07-03T11:00:00Z");

      installIdRef.current = "install-B";
      expect(getPurchaseReceptionsLastSyncedAt()).toBeNull();
    });
  });

  describe("getSupplierReturnsLastSyncedAt", () => {
    it("returns null when no sync has been performed", () => {
      expect(getSupplierReturnsLastSyncedAt()).toBeNull();
    });
  });

  describe("setSupplierReturnsLastSyncedAt + getSupplierReturnsLastSyncedAt", () => {
    it("persists and retrieves a timestamp", () => {
      setSupplierReturnsLastSyncedAt("2026-07-02T08:00:00Z");

      expect(getSupplierReturnsLastSyncedAt()).toBe("2026-07-02T08:00:00Z");
    });

    it("is scoped by installId", () => {
      installIdRef.current = "install-A";
      setSupplierReturnsLastSyncedAt("2026-07-02T08:00:00Z");

      installIdRef.current = "install-B";
      expect(getSupplierReturnsLastSyncedAt()).toBeNull();
    });
  });

  describe("getSalesLastSyncedAt", () => {
    it("returns null when no sync has been performed", () => {
      expect(getSalesLastSyncedAt()).toBeNull();
    });
  });

  describe("setSalesLastSyncedAt + getSalesLastSyncedAt", () => {
    it("persists and retrieves a timestamp", () => {
      setSalesLastSyncedAt("2026-07-01T07:00:00Z");

      expect(getSalesLastSyncedAt()).toBe("2026-07-01T07:00:00Z");
    });

    it("is scoped by installId", () => {
      installIdRef.current = "install-A";
      setSalesLastSyncedAt("2026-07-01T07:00:00Z");

      installIdRef.current = "install-B";
      expect(getSalesLastSyncedAt()).toBeNull();
    });
  });

  describe("getUsersLastSyncedAt", () => {
    it("returns null when no user pull has been performed", () => {
      expect(getUsersLastSyncedAt()).toBeNull();
    });
  });

  describe("setUsersLastSyncedAt + getUsersLastSyncedAt", () => {
    it("persists and retrieves a timestamp", () => {
      setUsersLastSyncedAt("2026-09-04T07:00:00Z");

      expect(getUsersLastSyncedAt()).toBe("2026-09-04T07:00:00Z");
    });

    it("is scoped by installId", () => {
      installIdRef.current = "install-A";
      setUsersLastSyncedAt("2026-09-04T07:00:00Z");

      installIdRef.current = "install-B";
      expect(getUsersLastSyncedAt()).toBeNull();
    });

    it("leaves the other cursors untouched", () => {
      setSalesLastSyncedAt("2026-07-01T07:00:00Z");

      setUsersLastSyncedAt("2026-09-04T07:00:00Z");

      expect(getUsersLastSyncedAt()).toBe("2026-09-04T07:00:00Z");
      expect(getSalesLastSyncedAt()).toBe("2026-07-01T07:00:00Z");
    });
  });

  describe("all nine sync-metadata fields co-exist without interference", () => {
    it("stores and retrieves each field independently across installIds", () => {
      installIdRef.current = "install-A";
      setSuppliersLastSyncedAt("2026-07-05T09:00:00Z");
      setPurchaseOrdersLastSyncedAt("2026-07-04T10:00:00Z");
      setPurchaseReceptionsLastSyncedAt("2026-07-03T11:00:00Z");
      setSupplierReturnsLastSyncedAt("2026-07-02T08:00:00Z");
      setSalesLastSyncedAt("2026-07-01T07:00:00Z");

      expect(getSuppliersLastSyncedAt()).toBe("2026-07-05T09:00:00Z");
      expect(getPurchaseOrdersLastSyncedAt()).toBe("2026-07-04T10:00:00Z");
      expect(getPurchaseReceptionsLastSyncedAt()).toBe("2026-07-03T11:00:00Z");
      expect(getSupplierReturnsLastSyncedAt()).toBe("2026-07-02T08:00:00Z");
      expect(getSalesLastSyncedAt()).toBe("2026-07-01T07:00:00Z");

      installIdRef.current = "install-B";
      expect(getSuppliersLastSyncedAt()).toBeNull();
      expect(getSalesLastSyncedAt()).toBeNull();
    });
  });
});
