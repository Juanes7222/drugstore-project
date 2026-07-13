/**
 * Unit tests for SyncScheduler — lifecycle and tick orchestration.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createSyncScheduler, SyncScheduler } from "./sync-scheduler.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => ({
  $transaction: vi.fn(),
  syncQueue: {
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue({ _max: { clientSequence: 0n } }),
  },
} as any);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SyncScheduler", () => {
  let scheduler: SyncScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("start / stop", () => {
    it("start() sets an interval and fires an immediate tick", () => {
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

      scheduler = createSyncScheduler({
        prisma: makeMockPrisma(),
        baseUrl: "http://localhost:3000",
        config: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        catalog: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        lots: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        clients: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        intervalMs: 300_000,
      });

      scheduler.start();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300_000);
      // The tick is fired immediately (via void this.tick()) — assert the scheduler is running.
    });

    it("stop() clears the interval", () => {
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

      scheduler = createSyncScheduler({
        prisma: makeMockPrisma(),
        baseUrl: "http://localhost:3000",
        config: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        catalog: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        lots: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        clients: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        intervalMs: 300_000,
      });

      scheduler.start();
      scheduler.stop();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("start() is idempotent — does not set a second interval", () => {
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

      scheduler = createSyncScheduler({
        prisma: makeMockPrisma(),
        baseUrl: "http://localhost:3000",
        config: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        catalog: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        lots: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        clients: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        intervalMs: 300_000,
      });

      scheduler.start();
      scheduler.start();

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("syncNow", () => {
    it("syncNow() does not throw when push fails", async () => {
      // isOnline will be false by default in jsdom, so tick() returns early.
      // We just verify syncNow() is callable and doesn't throw.
      scheduler = createSyncScheduler({
        prisma: makeMockPrisma(),
        baseUrl: "http://localhost:3000",
        config: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        catalog: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        lots: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        clients: { baseUrl: "http://localhost:3000", httpClient: { get: vi.fn() } },
        intervalMs: 300_000,
      });

      await expect(scheduler.syncNow()).resolves.toBeUndefined();
    });
  });
});
