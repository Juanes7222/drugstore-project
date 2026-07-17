/**
 * Unit tests for the typed HTTP client.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { HttpError, createHttpClient } from "./http-client";
import type { AuthTokenProvider } from "./auth-token-provider";

// ---------------------------------------------------------------------------
// HttpError
// ---------------------------------------------------------------------------

describe("HttpError", () => {
  it("sets status, responseText, message, and is instanceof Error", () => {
    const error = new HttpError(404, "Not Found", "HTTP 404: Not Found");

    expect(error.status).toBe(404);
    expect(error.responseText).toBe("Not Found");
    expect(error.message).toBe("HTTP 404: Not Found");
    expect(error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// createHttpClient
// ---------------------------------------------------------------------------

describe("createHttpClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const BASE_URL = "http://localhost:3000";

  const mockTokenProvider: AuthTokenProvider = {
    getAccessToken: vi.fn(),
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- URL construction ---------------------------------------------------

  it("builds correct URL from baseUrl and path", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const client = createHttpClient(BASE_URL);
    await client.get("/api/products");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestUrl).toBe("http://localhost:3000/api/products");
  });

  it("appends query string params", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const client = createHttpClient(BASE_URL);
    await client.get("/api/products", { page: 1, limit: 20 });

    const requestUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestUrl).toContain("page=1");
    expect(requestUrl).toContain("limit=20");
  });

  it("skips undefined, null, and empty params", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const client = createHttpClient(BASE_URL);
    await client.get("/api/products", {
      page: 1,
      query: undefined,
      sort: "",
    });

    const requestUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestUrl).toContain("page=1");
    expect(requestUrl).not.toContain("query");
    expect(requestUrl).not.toContain("filter");
    expect(requestUrl).not.toContain("sort");
  });

  it("handles baseUrl with trailing slash", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const client = createHttpClient("http://localhost:3000/");
    await client.get("/api/products");

    const requestUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestUrl).toBe("http://localhost:3000/api/products");
    expect(requestUrl).not.toContain("//api");
  });

  // -- Authorization ------------------------------------------------------

  it("attaches Authorization header from token provider", async () => {
    vi.mocked(mockTokenProvider.getAccessToken).mockResolvedValue("test-token");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const client = createHttpClient(BASE_URL, mockTokenProvider);
    await client.get("/api/protected");

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
  });

  it("works without auth token provider", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const client = createHttpClient(BASE_URL);
    await client.get("/api/public");

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  // -- Error handling -----------------------------------------------------

  it("throws HttpError on 404 response", async () => {
    fetchMock.mockResolvedValue(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    );

    const client = createHttpClient(BASE_URL);

    const error = await client.get("/api/missing").catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 404, responseText: "Not Found" });
  });

  it("throws HttpError on 500 response", async () => {
    fetchMock.mockResolvedValue(
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const client = createHttpClient(BASE_URL);

    const error = await client.get("/api/error").catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 500, responseText: "Internal Server Error" });
  });

  it("throws HttpError(0) on network error when fetch throws", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const client = createHttpClient(BASE_URL);

    await expect(client.get("/api/test")).rejects.toThrow(HttpError);
    await expect(client.get("/api/test")).rejects.toMatchObject({
      status: 0,
      responseText: "",
    });
  });

  // -- Success path -------------------------------------------------------

  it("returns parsed JSON on success", async () => {
    const data = { id: "p-001", name: "Paracetamol 500mg" };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(data), { status: 200 }),
    );

    const client = createHttpClient(BASE_URL);
    const result = await client.get<typeof data>("/api/products/p-001");

    expect(result).toEqual(data);
  });
});
