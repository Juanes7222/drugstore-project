/**
 * Tests for the sync-metadata localStorage helpers.
 *
 * Each test clears localStorage before running so state never leaks
 * between cases.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getCatalogLastSyncedAt,
  getClientsLastSyncedAt,
  getLotsLastSyncedAt,
  readSyncMetadata,
  setCatalogLastSyncedAt,
  setClientsLastSyncedAt,
  setLotsLastSyncedAt,
} from "./sync-metadata";

describe("sync-metadata", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("readSyncMetadata", () => {
    it("returns defaults when localStorage is empty", () => {
      const meta = readSyncMetadata();

      expect(meta).toEqual({
        catalogLastSyncedAt: null,
        lotsLastSyncedAt: null,
        clientsLastSyncedAt: null,
      });
    });

    it("returns defaults when stored JSON is malformed", () => {
      localStorage.setItem("pharmacy_sync_metadata", "not-json");

      const meta = readSyncMetadata();

      expect(meta).toEqual({
        catalogLastSyncedAt: null,
        lotsLastSyncedAt: null,
        clientsLastSyncedAt: null,
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
        });
      } finally {
        (globalThis as any).localStorage = originalLocalStorage;
      }
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

  describe("multiple independent timestamps", () => {
    it("stores and retrieves each field without interference", () => {
      setCatalogLastSyncedAt("2026-07-09T00:00:00Z");
      setLotsLastSyncedAt("2026-07-08T12:00:00Z");
      setClientsLastSyncedAt("2026-07-07T08:30:00Z");

      expect(getCatalogLastSyncedAt()).toBe("2026-07-09T00:00:00Z");
      expect(getLotsLastSyncedAt()).toBe("2026-07-08T12:00:00Z");
      expect(getClientsLastSyncedAt()).toBe("2026-07-07T08:30:00Z");
    });
  });
});
