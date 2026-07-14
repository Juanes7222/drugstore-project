/**
 * Unit tests for createCatalogService.
 *
 * Covers both branches of the factory: HTTP-backed service when
 * API_BASE_URL is set, mock service when it is empty/falsy.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted test doubles — mutable so we can flip API_BASE_URL between tests
// ---------------------------------------------------------------------------

const env = vi.hoisted(() => ({
  API_BASE_URL: "http://localhost:3000",
}));

const mockServiceImplementations = vi.hoisted(() => ({
  http: { search: vi.fn() },
  mock: { search: vi.fn() },
}));

const mockCreateHttpCatalogService = vi.hoisted(
  () => vi.fn(() => mockServiceImplementations.http),
);

const mockCreateMockCatalogService = vi.hoisted(
  () => vi.fn(() => mockServiceImplementations.mock),
);

const mockCreateHttpClient = vi.hoisted(
  () => vi.fn(() => ({ _mock: true })),
);

const mockCreateLocalStorageAuthTokenProvider = vi.hoisted(
  () => vi.fn(() => ({ _mock: true })),
);

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted by Vitest
// ---------------------------------------------------------------------------

vi.mock("./config", () => ({
  get API_BASE_URL() {
    return env.API_BASE_URL;
  },
}));

vi.mock("../renderer/services/catalog-service.http", () => ({
  createHttpCatalogService: mockCreateHttpCatalogService,
}));

vi.mock("../renderer/services/catalog-service.mock", () => ({
  createMockCatalogService: mockCreateMockCatalogService,
}));

vi.mock("./http-client", () => ({
  createHttpClient: mockCreateHttpClient,
}));

vi.mock("./auth-token-provider", () => ({
  createLocalStorageAuthTokenProvider: mockCreateLocalStorageAuthTokenProvider,
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("createCatalogService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.API_BASE_URL = "http://localhost:3000";
  });

  afterEach(() => {
    env.API_BASE_URL = "http://localhost:3000";
  });

  it("creates an HTTP catalog service when API_BASE_URL is set", async () => {
    const { createCatalogService } = await import("./catalog-service-factory");

    const service = createCatalogService();

    expect(mockCreateHttpCatalogService).toHaveBeenCalledTimes(1);
    expect(mockCreateHttpCatalogService).toHaveBeenCalledWith(
      expect.objectContaining({ httpClient: expect.any(Object) }),
    );
    expect(mockCreateMockCatalogService).not.toHaveBeenCalled();
    expect(service).toBe(mockServiceImplementations.http);
  });

  it("creates a mock catalog service when API_BASE_URL is empty", async () => {
    env.API_BASE_URL = "";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { createCatalogService } = await import("./catalog-service-factory");

    const service = createCatalogService();

    expect(mockCreateMockCatalogService).toHaveBeenCalledTimes(1);
    expect(mockCreateHttpCatalogService).not.toHaveBeenCalled();
    expect(service).toBe(mockServiceImplementations.mock);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("VITE_API_BASE_URL is not set"),
    );

    warnSpy.mockRestore();
  });

  it("creates a mock catalog service when API_BASE_URL is undefined", async () => {
    env.API_BASE_URL = undefined as unknown as string;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { createCatalogService } = await import("./catalog-service-factory");

    const service = createCatalogService();

    expect(mockCreateMockCatalogService).toHaveBeenCalledTimes(1);
    expect(mockCreateHttpCatalogService).not.toHaveBeenCalled();
    expect(service).toBe(mockServiceImplementations.mock);

    warnSpy.mockRestore();
  });

  it("passes API_BASE_URL to createHttpClient when creating HTTP service", async () => {
    env.API_BASE_URL = "https://api.pharmacy.example.com";
    const { createCatalogService } = await import("./catalog-service-factory");

    createCatalogService();

    expect(mockCreateHttpClient).toHaveBeenCalledWith(
      "https://api.pharmacy.example.com",
      expect.any(Object),
    );
  });
});
