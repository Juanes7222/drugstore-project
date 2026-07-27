/**
 * Unit tests for createCatalogService.
 *
 * The POS is local-first: the factory must always return the local catalog
 * service backed by the PGlite Prisma client. The HTTP service is reserved
 * for the catalog-sync pipeline, not the sales UI.
 */
import { describe, expect, it, vi } from "vitest";

const mockServiceImplementation = vi.hoisted(() => ({
  search: vi.fn(),
}));

const mockCreateLocalCatalogService = vi.hoisted(
  () => vi.fn(() => mockServiceImplementation),
);

const mockGetLocalDatabase = vi.hoisted(() => vi.fn());

vi.mock("../renderer/services/catalog-service.local", () => ({
  createLocalCatalogService: mockCreateLocalCatalogService,
}));

vi.mock("../renderer/services/catalog-service.mock", () => ({
  createMockCatalogService: vi.fn(() => ({ search: vi.fn() })),
}));

vi.mock("./local-database", () => ({
  getLocalDatabase: mockGetLocalDatabase,
}));

describe("createCatalogService", () => {
  it("returns a local-first service backed by the PGlite Prisma client", async () => {
    mockGetLocalDatabase.mockResolvedValue({ prisma: { _prisma: true } });

    const { createCatalogService } = await import("./catalog-service-factory");

    const service = createCatalogService();

    expect(mockCreateLocalCatalogService).toHaveBeenCalledTimes(1);
    expect(mockCreateLocalCatalogService).toHaveBeenCalledWith(
      expect.objectContaining({
        prismaResolver: expect.any(Function),
      }),
    );
    expect(service).toBe(mockServiceImplementation);
  });

  it("builds a mock catalog service when explicitly requested", async () => {
    const { createMockCatalogServiceInstance } = await import(
      "./catalog-service-factory"
    );

    const service = createMockCatalogServiceInstance();

    expect(service).toBeDefined();
    expect(typeof service.search).toBe("function");
  });
});
