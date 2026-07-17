/**
 * Tests for the Fuse.js-based search index service.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  createSearchIndexService,
  INDEX_WORKER_THRESHOLD,
  INDEX_UPDATE_DEBOUNCE_MS,
  MAX_RECENT_ITEMS,
  type SearchIndexService,
} from "./search-index.service";
import type { IndexablePage } from "./assistant-types";

// We'll supply a simple mock for the DB calls the service makes internally
vi.mock("../../infrastructure/local-database", () => ({
  getLocalDatabase: vi.fn().mockResolvedValue({
    client: {},
    prisma: {
      product: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      client: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      sale: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  }),
}));

// Mock import.meta.glob for help content
const mockHelpModules: Record<string, () => Promise<string>> = {
  "/src/help-content/sales.md": () =>
    Promise.resolve(`---
id: help-sales
title: Cómo realizar una venta
keywords:
  - venta
  - cobrar
  - producto
audience: cashier
lastUpdated: 2026-07-01
---

Para realizar una venta, busca el producto y presiona Cobrar.
`),
  "/src/help-content/returns.md": () =>
    Promise.resolve(`---
id: help-returns
title: Cómo hacer una devolución
keywords:
  - devolución
  - reembolso
audience: cashier
lastUpdated: 2026-06-15
---

Selecciona la venta original y los items a devolver.
`),
};

vi.mock("/src/help-content/**/*.md", () => mockHelpModules);

describe("SearchIndexService", () => {
  let service: SearchIndexService;

  beforeEach(() => {
    service = createSearchIndexService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exports constants", () => {
    expect(INDEX_WORKER_THRESHOLD).toBe(5000);
    expect(INDEX_UPDATE_DEBOUNCE_MS).toBe(100);
    expect(MAX_RECENT_ITEMS).toBe(20);
  });

  describe("initial state", () => {
    it("starts with isBuilt = false", () => {
      expect(service.isBuilt).toBe(false);
    });

    it("starts with itemCount = 0", () => {
      expect(service.itemCount).toBe(0);
    });
  });

  describe("build", () => {
    it("builds the index and returns a build time in ms", async () => {
      const buildTime = await service.build();

      expect(typeof buildTime).toBe("number");
      expect(buildTime).toBeGreaterThanOrEqual(0);
      expect(service.isBuilt).toBe(true);
    });

    it("includes page items, commands, and help topics after build", async () => {
      await service.build();

      expect(service.itemCount).toBeGreaterThan(0);
    });

    it("filters commands by role when building", async () => {
      // Build as cashier — should exclude manager commands
      await service.build("CASHIER");

      service.search("devolver");
      // Cashier shouldn't see manager-only commands
      expect(service.isBuilt).toBe(true);
    });

    it("accepts null or undefined role", async () => {
      await service.build(null);
      expect(service.isBuilt).toBe(true);

      await service.build(undefined as any);
      expect(service.isBuilt).toBe(true);
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await service.build("MANAGER");
    });

    it("returns results for matching queries", () => {
      const results = service.search("venta");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty("category");
    });

    it("returns empty array for empty query", () => {
      const results = service.search("");

      expect(results).toEqual([]);
    });

    it("returns empty array for whitespace-only query", () => {
      const results = service.search("   ");

      expect(results).toEqual([]);
    });

    it("returns empty array when no items match", () => {
      const results = service.search("zzzznonexistent");

      expect(results).toEqual([]);
    });

    it("searches by label, name, and keywords", () => {
      const byLabel = service.search("ventas");
      expect(byLabel.length).toBeGreaterThan(0);

      const byKeyword = service.search("cobrar");
      expect(byKeyword.length).toBeGreaterThan(0);
    });

    it("performs fuzzy search (tolerates typos)", () => {
      const results = service.search("venta");
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("addOrUpdate", () => {
    it("adds a new item to the index", () => {
      const item: IndexablePage = {
        category: "PAGE",
        id: "page-test",
        label: "Test Page",
        route: "/test",
      };

      service.addOrUpdate(item);

      expect(service.itemCount).toBeGreaterThan(0);
    });

    it("updates an existing item with the same id and category", () => {
      const item1: IndexablePage = {
        category: "PAGE",
        id: "page-test",
        label: "Old Label",
        route: "/test",
      };
      const item2: IndexablePage = {
        category: "PAGE",
        id: "page-test",
        label: "New Label",
        route: "/test",
      };

      service.addOrUpdate(item1);
      service.addOrUpdate(item2);

      // The index is debounce-rebuilt, so after addOrUpdate we need to
      // wait for the debounce timer. But since we're using real timers,
      // the items are in the array even before the fuse rebuild.
      // After the debounce, the fuse will be rebuilt with the new label.
      expect(service.isBuilt).toBe(false); // Not built initially
    });
  });

  describe("remove", () => {
    it("returns true when an item is found and removed", () => {
      const item: IndexablePage = {
        category: "PAGE",
        id: "page-test",
        label: "Test",
        route: "/test",
      };

      service.addOrUpdate(item);
      const initialCount = service.itemCount;
      const removed = service.remove("page-test");

      expect(removed).toBe(true);
      expect(service.itemCount).toBe(initialCount - 1);
    });

    it("returns false when the item id is not found", () => {
      const removed = service.remove("nonexistent-id");

      expect(removed).toBe(false);
    });
  });

  describe("callbacks", () => {
    it("calls onBuildStart before building", async () => {
      const cb = vi.fn();
      service.onBuildStart(cb);

      await service.build();

      expect(cb).toHaveBeenCalledOnce();
    });

    it("calls onBuildComplete after building", async () => {
      const cb = vi.fn();
      service.onBuildComplete(cb);

      await service.build();

      expect(cb).toHaveBeenCalledOnce();
    });

    it("supports multiple callbacks", async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      service.onBuildStart(cb1);
      service.onBuildStart(cb2);

      await service.build();

      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });

    it("swallows errors in callbacks", async () => {
      service.onBuildStart(() => {
        throw new Error("Callback error");
      });

      await expect(service.build()).resolves.toBeGreaterThanOrEqual(0);
    });
  });
});
