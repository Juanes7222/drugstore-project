/**
 * Tests for the fetchWithRetry() utility.
 *
 * fetch is stubbed on globalThis so no real network is touched; delays are
 * kept small (baseDelayMs ≤ 100) so tests stay fast without fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./fetch-with-retry";

const okResponse = (): Response => new Response("asset", { status: 200 });

describe("fetchWithRetry", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetch(impl: typeof fetch): ReturnType<typeof vi.fn> {
    const mock = vi.fn(impl);
    globalThis.fetch = mock as unknown as typeof fetch;
    return mock;
  }

  it("returns the response without retrying when the first attempt succeeds", async () => {
    const mock = stubFetch(vi.fn(async () => okResponse()));

    const response = await fetchWithRetry("/pglite/pglite.wasm");

    expect(response.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient TypeError and succeeds on a later attempt", async () => {
    const mock = stubFetch(
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(okResponse()),
    );
    const onRetry = vi.fn();

    const response = await fetchWithRetry("/pglite/pglite.wasm", {
      baseDelayMs: 1,
      onRetry,
    });

    expect(response.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({
      url: "/pglite/pglite.wasm",
      attempt: 1,
      attempts: 4,
    });
  });

  it("throws the last error after exhausting all attempts", async () => {
    const lastError = new TypeError("connection reset");
    stubFetch(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    // Make the final rejection distinguishable.
    globalThis.fetch = vi.fn(async () => {
      throw lastError;
    }) as unknown as typeof fetch;
    const onRetry = vi.fn();

    await expect(
      fetchWithRetry("/pglite/pglite.data", { attempts: 3, baseDelayMs: 1, onRetry }),
    ).rejects.toBe(lastError);
    expect(onRetry).toHaveBeenCalledTimes(2); // attempts - 1
  });

  it("does not retry non-transient (non-TypeError) errors", async () => {
    const abortError = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    const mock = stubFetch(vi.fn().mockRejectedValue(abortError));
    const onRetry = vi.fn();

    await expect(fetchWithRetry("/x", { baseDelayMs: 1, onRetry })).rejects.toBe(abortError);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("returns non-OK HTTP statuses as-is without retrying", async () => {
    const serverError = new Response("boom", { status: 500 });
    const mock = stubFetch(vi.fn(async () => serverError));
    const onRetry = vi.fn();

    const response = await fetchWithRetry("/x", { onRetry });

    expect(response.status).toBe(500);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("doubles the backoff delay and caps it at maxDelayMs", async () => {
    stubFetch(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const onRetry = vi.fn();

    await expect(
      fetchWithRetry("/x", {
        attempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 150,
        onRetry,
      }),
    ).rejects.toBeInstanceOf(TypeError);

    // attempt 1 fails → min(100 * 1, 150) = 100; attempt 2 → min(200, 150) = 150.
    expect(onRetry.mock.calls.map((call) => call[0].delayMs)).toEqual([100, 150]);
  });

  it("rejects without retrying when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    // Native fetch rejects immediately with an AbortError when the passed
    // signal is already aborted; that error is not a TypeError so it must
    // propagate without a retry.
    const mock = stubFetch(
      vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
        }
        return okResponse();
      }),
    );

    await expect(fetchWithRetry("/x", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when aborted during the backoff wait", async () => {
    const controller = new AbortController();
    const mock = stubFetch(
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue(okResponse()),
    );

    const pending = fetchWithRetry("/x", {
      baseDelayMs: 5_000,
      signal: controller.signal,
      onRetry: () => controller.abort(),
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
