/**
 * Tests for the Telemetry Service.
 *
 * Covers enqueueing events, batched HTTP flush, start/stop lifecycle,
 * retry semantics, offline behaviour, and HMAC signature computation.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  createTelemetryService,
  type TelemetryService,
  type TelemetryServiceConfig,
  type TelemetryEvent,
} from "./telemetry.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../common/is-online", () => ({
  isOnline: vi.fn(() => true),
}));

vi.mock("../../infrastructure/config", () => ({
  API_BASE_URL: "http://localhost:3000",
}));

// ---------------------------------------------------------------------------
// Fake Prisma client (in-memory store)
// ---------------------------------------------------------------------------

function createFakePrisma() {
  const store: Array<Record<string, any>> = [];

  return {
    pendingTelemetry: {
      async create(data: { data: Record<string, any> }) {
        const entry = { ...data.data };
        store.push(entry);
        return entry;
      },
      findMany(opts: { orderBy: any; take: number }) {
        const sorted = [...store].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        return Promise.resolve(sorted.slice(0, opts.take));
      },
      deleteMany(opts: { where: { id: { in: string[] } } }) {
        const idSet = new Set(opts.where.id.in);
        for (let i = store.length - 1; i >= 0; i--) {
          if (idSet.has(store[i].id)) {
            store.splice(i, 1);
          }
        }
        return Promise.resolve({ count: opts.where.id.in.length });
      },
      updateMany(opts: { where: { id: { in: string[] } }; data: Record<string, any> }) {
        const idSet = new Set(opts.where.id.in);
        for (const entry of store) {
          if (idSet.has(entry.id)) {
            // Handle Prisma-style { increment: N }
            if (opts.data.retryCount && typeof opts.data.retryCount === 'object' && 'increment' in opts.data.retryCount) {
              entry.retryCount = (entry.retryCount ?? 0) + (opts.data.retryCount as { increment: number }).increment;
              if (opts.data.lastError !== undefined) {
                entry.lastError = opts.data.lastError;
              }
            } else {
              Object.assign(entry, opts.data);
            }
          }
        }
        return Promise.resolve({ count: opts.where.id.in.length });
      },
    },
    // Expose store for assertions
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// Fake crypto.subtle for HMAC signature
// ---------------------------------------------------------------------------

function mockCryptoSubtle() {
  const subtle = {
    importKey: vi.fn().mockResolvedValue("fake-key"),
    sign: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xab).buffer),
  };
  Object.defineProperty(globalThis, "crypto", {
    value: { subtle, randomUUID: () => "uuid-12345" },
    configurable: true,
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_EVENT: TelemetryEvent = {
  workstationId: "ws-1",
  licenseId: "lic-1",
  fromVersion: "1.0.0",
  toVersion: "1.2.3",
  attemptId: "attempt-001",
  outcome: "CHECK_OK" as any,
};

function makeConfig(overrides: Partial<TelemetryServiceConfig> = {}): TelemetryServiceConfig {
  return {
    prisma: createFakePrisma(),
    workstationId: "ws-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TelemetryService", () => {
  let service: TelemetryService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCryptoSubtle();
  });

  afterEach(() => {
    // Ensure periodic flush is stopped between tests
    service?.stop();
  });

  // -----------------------------------------------------------------------
  // Enqueue
  // -----------------------------------------------------------------------

  describe("enqueue", () => {
    it("writes a pending telemetry row to the local table", async () => {
      const config = makeConfig();
      service = createTelemetryService(config);

      await service.enqueue(BASE_EVENT);

      const store = (config.prisma as any)._store;
      expect(store).toHaveLength(1);
      expect(store[0].endpoint).toBe("/updates/telemetry");
      expect(store[0].retryCount).toBe(0);
      expect(store[0].lastError).toBeNull();
    });

    it("includes an HMAC signature in the serialised body", async () => {
      const config = makeConfig();
      service = createTelemetryService(config);

      await service.enqueue(BASE_EVENT);

      const store = (config.prisma as any)._store;
      const body = JSON.parse(store[0].body);
      expect(body.signature).toBeDefined();
      expect(body.signature).toMatch(/^[a-f0-9]{64}$/);
    });

    it("uses crypto.randomUUID for the row id", async () => {
      const randomUUID = globalThis.crypto.randomUUID;
      const uuidSpy = vi.fn(() => "custom-uuid");
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        value: uuidSpy,
        configurable: true,
      });

      const config = makeConfig();
      service = createTelemetryService(config);

      await service.enqueue(BASE_EVENT);

      expect(uuidSpy).toHaveBeenCalled();
      const store = (config.prisma as any)._store;
      expect(store[0].id).toBe("custom-uuid");
    });
  });

  // -----------------------------------------------------------------------
  // Flush
  // -----------------------------------------------------------------------

  describe("flush", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      fetchSpy = vi.spyOn(globalThis, "fetch");
      // Prior tests may have stubbed isOnline; ensure it returns true
      const { isOnline } = await import("../../common/is-online");
      (isOnline as any).mockReturnValue(true);
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("sends pending events to the server and deletes them on success", async () => {
      fetchSpy.mockResolvedValue({ ok: true });

      const config = makeConfig();
      service = createTelemetryService(config);

      await service.enqueue(BASE_EVENT);
      await service.enqueue({ ...BASE_EVENT, attemptId: "attempt-002" });

      await service.flush();

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/updates/telemetry",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: expect.stringContaining("attempt-001"),
        }),
      );

      // Events should be deleted after successful send
      const store = (config.prisma as any)._store;
      expect(store).toHaveLength(0);
    });

    it("includes the Authorization header when accessToken is provided", async () => {
      fetchSpy.mockResolvedValue({ ok: true });

      const config = makeConfig({
        accessToken: vi.fn().mockResolvedValue("test-token"),
      });
      service = createTelemetryService(config);

      await service.enqueue(BASE_EVENT);
      await service.flush();

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it("does nothing when there are no pending events", async () => {
      const config = makeConfig();
      service = createTelemetryService(config);

      await service.flush();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("does nothing when offline", async () => {
      const { isOnline } = await import("../../common/is-online");
      (isOnline as any).mockReturnValue(false);

      const config = makeConfig();
      service = createTelemetryService(config);

      await service.enqueue(BASE_EVENT);
      await service.flush();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("increments retryCount and stops flushing on server error", async () => {
      // Ensure online — prior tests may have stubbed isOnline to false
      const { isOnline } = await import("../../common/is-online");
      (isOnline as any).mockReturnValue(true);

      fetchSpy.mockResolvedValue({ ok: false, status: 500 });

      const config = makeConfig();
      service = createTelemetryService(config);

      await service.enqueue(BASE_EVENT);

      await service.flush();

      expect(fetchSpy).toHaveBeenCalled();

      const store = (config.prisma as any)._store;
      expect(store).toHaveLength(1);
      expect(store[0].retryCount).toBe(1);
      expect(store[0].lastError).toContain("Server returned 500");
    });

    it("does not flush while a flush is already in progress", async () => {
      const config = makeConfig();
      service = createTelemetryService(config);
      await service.enqueue(BASE_EVENT);

      // Set the internal flushing flag manually to simulate a concurrent flush
      (service as any).flushing = true;

      await service.flush();

      // flush should have returned immediately without calling fetch
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Start / Stop
  // -----------------------------------------------------------------------

  describe("start and stop", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("starts a periodic flush interval", () => {
      const config = makeConfig();
      service = createTelemetryService(config);
      const flushSpy = vi.spyOn(service, "flush");

      service.start();

      expect(flushSpy).not.toHaveBeenCalled();

      // Advance by 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(flushSpy).toHaveBeenCalledTimes(1);

      // Advance another 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(flushSpy).toHaveBeenCalledTimes(2);
    });

    it("does not start a second interval if already started", () => {
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const config = makeConfig();
      service = createTelemetryService(config);

      service.start();
      service.start();

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      setIntervalSpy.mockRestore();
    });

    it("stops the periodic flush interval", () => {
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
      const config = makeConfig();
      service = createTelemetryService(config);

      service.start();
      service.stop();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
